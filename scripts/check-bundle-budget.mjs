#!/usr/bin/env node
/**
 * Bundle budget gate (F1-11).
 *
 * Measures First Load JS per route and fails when a route crosses its ceiling.
 *
 * WHY THIS METHOD. Three were on the table:
 *
 *   1. Parse the `Route (app)` table out of `next build` stdout. Cheap, but it
 *      reads a human-facing table that Next is free to re-format, and it needs
 *      the build's stdout captured to a file — one more moving part in CI.
 *   2. Ask Next for machine-readable sizes. There is no supported flag for it
 *      in 15.x; `.next/trace` and the diagnostics files are internal.
 *   3. Recompute the number from the build manifest. `.next/app-build-manifest.json`
 *      lists exactly the JS files a route's first load pulls in, and First Load
 *      JS is the sum of their gzipped sizes. That is what this script does.
 *
 * (3) wins because it is the same arithmetic Next prints, done from a file
 * whose shape is stable, with no dependency on stdout formatting. Verified
 * against `next build` output for this project: every route matched the
 * printed figure to the kilobyte.
 *
 * Sizes are reported in kB = 1000 bytes, which is the unit Next prints.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const NEXT_DIR = path.resolve(process.cwd(), ".next");
const MANIFEST = path.join(NEXT_DIR, "app-build-manifest.json");

/**
 * Ceilings in kB of First Load JS. Raise one only with a written reason: a
 * budget that moves whenever it is crossed is not a budget.
 *
 * `/` is the public landing page and must stay near the shared baseline.
 * `/d/[id]` and `/demo` carry the whole editor (Tiptap + ProseMirror), which
 * is the one heavy dependency F1 accepts; their ceiling leaves room for the
 * remaining F1 work without leaving room for a second editor-sized library.
 */
const CEILINGS_KB = {
  "/": 110,
  "/d/[id]": 270,
  "/demo": 270,
};
const DEFAULT_CEILING_KB = 130;

/** Manifest keys that are not routes of their own. */
const NOT_A_ROUTE = new Set(["/layout"]);

function fail(message) {
  console.error(`check:bundle — ${message}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) {
  fail(`no ${path.relative(process.cwd(), MANIFEST)}. Run \`npm run build\` first.`);
}

/** `/d/[id]/page` → `/d/[id]`, `/auth/callback/route` → `/auth/callback`, `/page` → `/`. */
function toRoute(key) {
  const trimmed = key.replace(/\/(page|route)$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const pages = manifest.pages ?? {};

const rows = [];
for (const [key, files] of Object.entries(pages)) {
  if (NOT_A_ROUTE.has(key)) continue;

  let bytes = 0;
  for (const file of new Set(files)) {
    if (!file.endsWith(".js")) continue;
    const abs = path.join(NEXT_DIR, file);
    if (!existsSync(abs)) {
      fail(`manifest names a chunk that is not on disk: ${file}`);
    }
    bytes += gzipSync(readFileSync(abs), { level: 9 }).length;
  }

  const route = toRoute(key);
  rows.push({
    route,
    kb: bytes / 1000,
    ceiling: CEILINGS_KB[route] ?? DEFAULT_CEILING_KB,
  });
}

if (rows.length === 0) {
  fail("the build manifest lists no routes — is this a complete build?");
}

rows.sort((a, b) => b.kb - a.kb);

const width = Math.max(...rows.map((r) => r.route.length), 5);
console.log(`${"Route".padEnd(width)}  First Load JS   Ceiling  Status`);
const over = [];
for (const row of rows) {
  const ok = row.kb <= row.ceiling;
  if (!ok) over.push(row);
  console.log(
    `${row.route.padEnd(width)}  ${`${row.kb.toFixed(1)} kB`.padStart(12)}  ` +
      `${`${row.ceiling} kB`.padStart(7)}  ${ok ? "ok" : "OVER"}`,
  );
}

if (over.length > 0) {
  console.error("");
  for (const row of over) {
    console.error(
      `check:bundle — ${row.route} is ${row.kb.toFixed(1)} kB, over its ` +
        `${row.ceiling} kB ceiling by ${(row.kb - row.ceiling).toFixed(1)} kB.`,
    );
  }
  console.error(
    "Shrink the route (lazy-load what renders rarely) or raise the ceiling in " +
      "scripts/check-bundle-budget.mjs and docs/PERF_BUDGET.md with a reason.",
  );
  process.exit(1);
}

console.log("\ncheck:bundle — every route is inside its budget.");
