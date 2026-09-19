import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Cheap tripwires over the prepared F1 migration — not a SQL parser.
 * `docker` is unavailable here, so this guards the properties that would be
 * expensive to get wrong: RLS on, owner-scoped policies, and no anonymous
 * access smuggled into a file that is applied by hand.
 *
 * Each check is a pure function over SQL text, so the negative fixtures below
 * prove the tripwire actually fires instead of silently passing everything.
 */
const MIGRATION_FILENAME = "2026091904_f1_workspace.sql";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = path.join(repoRoot, "supabase/migrations", MIGRATION_FILENAME);
const sql = readFileSync(migrationPath, "utf8");
const lower = sql.toLowerCase();

const TABLES = ["pisac_workspaces", "pisac_projects"] as const;
type TableName = (typeof TABLES)[number];

/** Strips `--` line comments and `/* *\/` block comments, then splits on `;`. */
function splitStatements(source: string): string[] {
  return source
    .toLowerCase()
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter((statement) => statement !== "");
}

/**
 * Statements that mention the `anon` role anywhere. A `revoke` is the one
 * shape allowed to name it, so grants and `alter default privileges` are
 * caught even when they never use the word "grant".
 */
function anonStatements(source: string): string[] {
  return splitStatements(source).filter(
    (statement) => /\banon\b/.test(statement) && !statement.startsWith("revoke"),
  );
}

/** The table named directly after `create policy <name> on`, per policy statement. */
function policyTargets(source: string): (string | null)[] {
  return splitStatements(source)
    .filter((statement) => statement.startsWith("create policy"))
    .map((statement) => statement.match(/^create policy \S+ on (?:public\.)?(\w+)\b/)?.[1] ?? null);
}

const statements = splitStatements(sql);

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

  it("names the anon role only to revoke from it", () => {
    expect(anonStatements(sql)).toEqual([]);
  });

  it("revokes all privileges from anon on both tables", () => {
    for (const table of TABLES) {
      expect(statements).toContain(`revoke all on table public.${table} from anon`);
    }
  });

  it("never mentions the service role", () => {
    expect(lower).not.toContain("service_role");
  });

  it("keeps updated_at maintained by a before-update trigger", () => {
    expect(lower).toContain("create or replace function public.pisac_set_updated_at()");
    expect(lower).toContain("new.updated_at = pg_catalog.now()");
    expect(statements.some((s) => s.startsWith("create trigger pisac_projects_set_updated_at")))
      .toBe(true);
    expect(lower).toContain("before update on public.pisac_projects");
  });

  it("targets only the two workspace tables in every create policy", () => {
    const targets = policyTargets(sql);

    expect(targets.length).toBeGreaterThanOrEqual(8);
    for (const target of targets) {
      expect(TABLES).toContain(target as TableName);
    }
  });

  it("marks itself as prepared, not auto-applied", () => {
    expect(lower).toContain("do not auto-apply to production");
    expect(lower).toContain("cxwxxcwrgushfkisfpxz");
  });
});

describe("migration tripwires fire on bad SQL", () => {
  it("flags a grant to anon", () => {
    expect(anonStatements("grant select on table public.pisac_projects to anon;")).toHaveLength(1);
  });

  it("flags a default privilege for anon that never says 'grant'", () => {
    const bad = "alter default privileges in schema public for role anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("accepts a revoke naming anon", () => {
    expect(anonStatements("revoke all on table public.pisac_projects from anon;")).toEqual([]);
  });

  it("does not let a line comment hide a grant to anon", () => {
    const bad = "-- no access for anon\ngrant select on public.pisac_projects to anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("ignores the anon role when it appears only inside a block comment", () => {
    expect(anonStatements("/* nothing is granted to anon */\nselect 1;")).toEqual([]);
  });

  it("does not let a block comment hide a grant to anon", () => {
    const bad = "/* safety\n note */ grant select on public.pisac_projects to anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("reads the policy target from the create policy clause, not a later reference", () => {
    const bad =
      "create policy p on public.some_other_table for select using (id in (select id from public.pisac_projects));";
    expect(policyTargets(bad)).toEqual(["some_other_table"]);
  });

  it("reports a policy whose target cannot be read", () => {
    expect(policyTargets("create policy p for select using (true);")).toEqual([null]);
  });
});
