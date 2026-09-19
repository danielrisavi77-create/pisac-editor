import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Cheap tripwires over the prepared F1 migration — not a SQL parser.
 * `docker` is unavailable here, so this guards the properties that would be
 * expensive to get wrong: RLS on, owner-scoped policies, no anon/service-role
 * grants smuggled into a file that is applied by hand.
 */
const MIGRATION_FILENAME = "2026091904_f1_workspace.sql";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = path.join(repoRoot, "supabase/migrations", MIGRATION_FILENAME);
const sql = readFileSync(migrationPath, "utf8");
const lower = sql.toLowerCase();
/** Statement text with `--` line comments stripped, so splitting on `;` is reliable. */
const statements = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .split(";")
  .map((statement) => statement.trim().replace(/\s+/g, " "))
  .filter((statement) => statement !== "");

const TABLES = ["pisac_workspaces", "pisac_projects"] as const;

describe("2026091904_f1_workspace.sql", () => {
  it("lives under supabase/migrations with the planned filename", () => {
    expect(path.basename(migrationPath)).toBe("2026091904_f1_workspace.sql");
    expect(migrationPath.endsWith(path.join("supabase", "migrations", MIGRATION_FILENAME))).toBe(
      true,
    );
  });

  it("creates both tables", () => {
    for (const table of TABLES) {
      expect(lower).toContain(`create table if not exists public.${table}`);
    }
  });

  it("enables row level security on both tables", () => {
    for (const table of TABLES) {
      expect(lower).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("scopes access with auth.uid()", () => {
    expect(lower).toContain("auth.uid()");
  });

  it("grants nothing to anon", () => {
    const grants = lower.match(/^\s*grant\b[^;]*;/gm) ?? [];
    expect(grants.filter((statement) => statement.includes("anon"))).toEqual([]);
  });

  it("never mentions the service role", () => {
    expect(lower).not.toContain("service_role");
  });

  it("targets only the two workspace tables in every create policy", () => {
    const policies = statements.filter((statement) => statement.startsWith("create policy"));

    expect(policies.length).toBeGreaterThanOrEqual(8);
    for (const statement of policies) {
      const target = statement.match(/\bon\s+public\.(\w+)/)?.[1];
      expect(TABLES).toContain(target as (typeof TABLES)[number]);
    }
  });

  it("marks itself as prepared, not auto-applied", () => {
    expect(lower).toContain("do not auto-apply to production");
    expect(lower).toContain("cxwxxcwrgushfkisfpxz");
  });
});
