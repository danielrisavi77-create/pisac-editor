import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Cheap tripwires over the prepared F1-4a migration — not a SQL parser, and
 * the same approach as src/domain/workspace/migration.test.ts.
 * `docker` is unavailable here, so this guards the properties that would be
 * expensive to get wrong in a file that is applied by hand: RLS on, an
 * append-only revision log, the idempotency key, a security *invoker* RPC
 * with an empty search_path, and no anonymous access.
 *
 * Each check is a pure function over SQL text, and the negative fixtures at
 * the bottom prove the tripwires actually fire.
 */
const MIGRATION_FILENAME = "2026091905_f1_documents.sql";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = path.join(repoRoot, "supabase/migrations", MIGRATION_FILENAME);
const sql = readFileSync(migrationPath, "utf8");
const lower = sql.toLowerCase();

const TABLES = ["pisac_documents", "pisac_document_revisions"] as const;
type TableName = (typeof TABLES)[number];

const RPC = "pisac_commit_document";
const RPC_SIGNATURE = `public.${RPC}(uuid, bigint, jsonb, text)`;

/**
 * Strips `--` line comments, block comments and dollar-quoted function
 * bodies, then splits on `;`. The body has to go before the split: a plpgsql
 * body is full of semicolons that are not statement ends, and the
 * function header (`security invoker`, `set search_path`) is what matters
 * here anyway.
 */
function splitStatements(source: string): string[] {
  return source
    .toLowerCase()
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " $body$ ")
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

/** `[table, command]` for every `create policy`, read from its own clause. */
function policies(source: string): { table: string | null; command: string | null }[] {
  return splitStatements(source)
    .filter((statement) => statement.startsWith("create policy"))
    .map((statement) => ({
      table: statement.match(/^create policy \S+ on (?:public\.)?(\w+)\b/)?.[1] ?? null,
      command:
        statement.match(
          /^create policy \S+ on \S+ for (select|insert|update|delete|all)\b/,
        )?.[1] ?? null,
    }));
}

const statements = splitStatements(sql);

describe("2026091905_f1_documents.sql", () => {
  it("lives under supabase/migrations with the planned filename", () => {
    expect(path.basename(migrationPath)).toBe(MIGRATION_FILENAME);
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

  it("keeps F1's one-document-per-project rule and cascades from the project", () => {
    expect(lower).toContain("references public.pisac_projects(id) on delete cascade");
    expect(lower).toContain("unique (project_id)");
  });

  it("carries the idempotency key as a unique constraint", () => {
    expect(lower).toContain("unique (document_id, actor_id, client_transaction_id)");
    expect(lower).toContain("pisac_document_revisions_idempotency_key");
  });

  it("keeps one row per revision of a document", () => {
    expect(lower).toContain("unique (document_id, revision)");
  });

  it("guards the client transaction id length in the schema, not only in the RPC", () => {
    expect(lower).toContain("char_length(client_transaction_id) between 1 and 128");
  });

  it("gives the revision log select and insert policies only", () => {
    const commands = policies(sql)
      .filter((policy) => policy.table === "pisac_document_revisions")
      .map((policy) => policy.command);

    expect(commands.length).toBeGreaterThanOrEqual(2);
    expect(new Set(commands)).toEqual(new Set(["select", "insert"]));
  });

  it("revokes update and delete on the revision log from authenticated too", () => {
    expect(statements).toContain(
      "revoke update, delete on table public.pisac_document_revisions from authenticated",
    );
  });

  it("never lets the revision log be deleted from, policy or not", () => {
    expect(lower).not.toContain("for delete");
  });

  it("scopes every policy through project -> workspace ownership", () => {
    expect(lower).toContain("auth.uid()");
    expect(lower).toContain("join public.pisac_workspaces w on w.id = p.workspace_id");
  });

  it("targets only the two document tables in every create policy", () => {
    const targets = policies(sql).map((policy) => policy.table);

    expect(targets.length).toBeGreaterThanOrEqual(5);
    for (const target of targets) {
      expect(TABLES).toContain(target as TableName);
    }
  });

  it("declares the RPC as security invoker with an empty search_path", () => {
    const definition = statements.find((statement) =>
      statement.startsWith(`create or replace function public.${RPC}(`),
    );

    expect(definition).toBeDefined();
    expect(definition).toContain("security invoker");
    expect(definition).toContain("set search_path = ''");
    expect(definition).not.toContain("security definer");
  });

  it("returns the four commit statuses the client contract parses", () => {
    for (const status of ["committed", "duplicate", "stale_base", "not_found"]) {
      expect(lower).toContain(`'status', '${status}'`);
    }
  });

  it("locks the document row and compares the base revision before writing", () => {
    expect(lower).toContain("for update");
    expect(lower).toContain("if v_current is distinct from p_base_revision then");
  });

  it("revokes execute from public and anon, granting it to authenticated only", () => {
    expect(statements).toContain(`revoke all on function ${RPC_SIGNATURE} from public`);
    expect(statements).toContain(`revoke all on function ${RPC_SIGNATURE} from anon`);
    expect(statements).toContain(`grant execute on function ${RPC_SIGNATURE} to authenticated`);
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

  it("reuses the updated_at trigger function from the workspace migration", () => {
    expect(statements.some((s) => s.startsWith("create trigger pisac_documents_set_updated_at")))
      .toBe(true);
    expect(lower).toContain("execute function public.pisac_set_updated_at()");
    expect(lower).not.toContain("create or replace function public.pisac_set_updated_at");
  });

  it("marks itself as prepared, not auto-applied", () => {
    expect(lower).toContain("do not auto-apply to production");
    expect(lower).toContain("cxwxxcwrgushfkisfpxz");
  });
});

describe("migration tripwires fire on bad SQL", () => {
  it("flags a grant to anon", () => {
    expect(anonStatements("grant execute on function public.f() to anon;")).toHaveLength(1);
  });

  it("flags a default privilege for anon that never says 'grant'", () => {
    const bad = "alter default privileges in schema public for role anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("accepts a revoke naming anon", () => {
    expect(anonStatements("revoke all on table public.pisac_documents from anon;")).toEqual([]);
  });

  it("does not let a line comment hide a grant to anon", () => {
    const bad = "-- no access for anon\ngrant select on public.pisac_documents to anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("does not let a block comment hide a grant to anon", () => {
    const bad = "/* safety\n note */ grant select on public.pisac_documents to anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("does not let a function body hide a grant to anon", () => {
    const bad = "create function f() as $$ begin end; $$;\ngrant select on public.t to anon;";
    expect(anonStatements(bad)).toHaveLength(1);
  });

  it("keeps a plpgsql body from being split into fake statements", () => {
    const body = "create function f() as $$ begin select 1; select 2; end; $$;";
    expect(splitStatements(body)).toEqual(["create function f() as $body$"]);
  });

  it("reads the policy target and command from the create policy clause", () => {
    const bad =
      "create policy p on public.some_other_table for delete using (id in (select id from public.pisac_documents));";
    expect(policies(bad)).toEqual([{ table: "some_other_table", command: "delete" }]);
  });

  it("reports a policy whose target cannot be read", () => {
    expect(policies("create policy p for select using (true);")).toEqual([
      { table: null, command: null },
    ]);
  });
});
