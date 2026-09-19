import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Cheap tripwires over the prepared F1-4a migration — not a SQL parser, and
 * the same approach as src/domain/workspace/migration.test.ts.
 * `docker` is unavailable here, so this guards the properties that would be
 * expensive to get wrong in a file that is applied by hand: RLS on, an
 * append-only revision log, the idempotency key, the write path closed to
 * everything but the two definer functions, and no anonymous access.
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

const COMMIT_FN = "pisac_commit_document";
const ENSURE_FN = "pisac_ensure_document";
const COMMIT_SIGNATURE = `public.${COMMIT_FN}(uuid, bigint, jsonb, text)`;
const ENSURE_SIGNATURE = `public.${ENSURE_FN}(uuid)`;

/**
 * Strips `--` line comments, block comments and dollar-quoted function
 * bodies, then splits on `;`. The body has to go before the split: a plpgsql
 * body is full of semicolons that are not statement ends, and the
 * function header (`security definer`, `set search_path`) is what matters
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

/**
 * The plpgsql body of one function: everything between the `$$` markers that
 * follow its `create or replace`. Lower-cased but otherwise verbatim, because
 * the order of statements inside it is exactly what the lock tripwire checks.
 */
function functionBody(source: string, name: string): string | null {
  const text = source.toLowerCase();
  const start = text.indexOf(`create or replace function public.${name}(`);
  if (start < 0) {
    return null;
  }
  const open = text.indexOf("$$", start);
  if (open < 0) {
    return null;
  }
  const close = text.indexOf("$$", open + 2);
  if (close < 0) {
    return null;
  }
  return text.slice(open + 2, close);
}

const DUPLICATE_LOOKUP = "and r.client_transaction_id = p_client_transaction_id";

/**
 * Where the commit body locks, where it compares the base revision, and every
 * place it looks the idempotency key up. Character offsets, so "before" and
 * "after" are decidable rather than assumed.
 */
function commitBodyOrder(body: string): {
  lock: number;
  cas: number;
  duplicateLookups: number[];
} {
  const duplicateLookups: number[] = [];
  let at = body.indexOf(DUPLICATE_LOOKUP);
  while (at >= 0) {
    duplicateLookups.push(at);
    at = body.indexOf(DUPLICATE_LOOKUP, at + DUPLICATE_LOOKUP.length);
  }

  return {
    lock: body.indexOf("for update"),
    cas: body.indexOf("is distinct from p_base_revision"),
    duplicateLookups,
  };
}

/** True when the row is locked before the base revision is ever compared. */
function locksBeforeCompare(body: string): boolean {
  const { lock, cas } = commitBodyOrder(body);
  return lock >= 0 && cas >= 0 && lock < cas;
}

/** True when the idempotency key is looked up again after the lock is taken. */
function rechecksUnderLock(body: string): boolean {
  const { lock, duplicateLookups } = commitBodyOrder(body);
  return lock >= 0 && duplicateLookups.some((at) => at > lock);
}

const statements = splitStatements(sql);
const commitBody = functionBody(sql, COMMIT_FN) ?? "";
const ensureBody = functionBody(sql, ENSURE_FN) ?? "";

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

  it("stores a content digest so a reused idempotency key can be told apart", () => {
    expect(lower).toContain("document_digest text not null");
    expect(lower).toContain("char_length(document_digest) = 32");
    expect(commitBody).toContain("md5(p_document::text)");
    expect(commitBody).toContain("'status', 'txid_reused'");
  });

  it("guards the client transaction id length in the schema, not only in the RPC", () => {
    expect(lower).toContain("char_length(client_transaction_id) between 1 and 128");
  });

  it("caps the document at 1 MiB in the database as well as the client", () => {
    expect(commitBody).toContain("pg_column_size(p_document) > 1048576");
    expect(commitBody).toContain("'status', 'too_large'");
  });
});

describe("the write path is the two definer functions and nothing else", () => {
  it("declares both functions security definer with an empty search_path", () => {
    for (const name of [COMMIT_FN, ENSURE_FN]) {
      const definition = statements.find((statement) =>
        statement.startsWith(`create or replace function public.${name}(`),
      );

      expect(definition, name).toBeDefined();
      expect(definition, name).toContain("security definer");
      expect(definition, name).toContain("set search_path = ''");
      expect(definition, name).not.toContain("security invoker");
    }
  });

  it("checks auth.uid() for null in both bodies before anything else", () => {
    for (const body of [commitBody, ensureBody]) {
      expect(body).toContain("v_actor := auth.uid()");
      expect(body).toContain("if v_actor is null then");
      expect(body).toContain("'status', 'unauthenticated'");
      expect(body.indexOf("if v_actor is null then")).toBeLessThan(
        body.indexOf("public.pisac_documents"),
      );
    }
  });

  it("proves ownership inside each body, because definer skips RLS", () => {
    // document -> project -> workspace -> owner, against the session's actor.
    expect(commitBody).toContain("join public.pisac_projects p on p.id = d.project_id");
    expect(commitBody).toContain("join public.pisac_workspaces w on w.id = p.workspace_id");
    expect(commitBody).toContain("w.owner_id = v_actor");
    expect(commitBody).toContain("'status', 'not_found'");

    expect(ensureBody).toContain("join public.pisac_workspaces w on w.id = p.workspace_id");
    expect(ensureBody).toContain("w.owner_id = v_actor");
    expect(ensureBody).toContain("'status', 'not_found'");
  });

  it("revokes insert, update and delete on both tables from authenticated", () => {
    for (const table of TABLES) {
      expect(statements).toContain(
        `revoke insert, update, delete on table public.${table} from authenticated`,
      );
    }
  });

  it("leaves authenticated with select policies only", () => {
    const commands = policies(sql).map((policy) => policy.command);

    expect(commands.length).toBeGreaterThanOrEqual(2);
    expect(new Set(commands)).toEqual(new Set(["select"]));
  });

  it("declares no insert, update or delete policy anywhere in the file", () => {
    // `for update of d` inside the commit body is a row lock, not a policy,
    // so the check runs over statements with the bodies already stripped.
    for (const clause of ["for insert", "for delete"]) {
      expect(statements.some((statement) => statement.includes(clause))).toBe(false);
    }
    expect(
      statements.some(
        (statement) => statement.startsWith("create policy") && statement.includes("for update"),
      ),
    ).toBe(false);
  });

  it("targets only the two document tables in every create policy", () => {
    const targets = policies(sql).map((policy) => policy.table);

    expect(targets.length).toBeGreaterThanOrEqual(2);
    for (const target of targets) {
      expect(TABLES).toContain(target as TableName);
    }
  });

  it("revokes execute from public and anon, granting it to authenticated only", () => {
    for (const signature of [COMMIT_SIGNATURE, ENSURE_SIGNATURE]) {
      expect(statements).toContain(`revoke all on function ${signature} from public`);
      expect(statements).toContain(`revoke all on function ${signature} from anon`);
      expect(statements).toContain(`grant execute on function ${signature} to authenticated`);
    }
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
});

describe("the commit body locks before it decides", () => {
  it("has a readable body for both functions", () => {
    expect(commitBody.length).toBeGreaterThan(200);
    expect(ensureBody.length).toBeGreaterThan(200);
  });

  it("takes the row lock before comparing the base revision", () => {
    expect(locksBeforeCompare(commitBody)).toBe(true);
  });

  it("looks the idempotency key up before the lock, as the fast path", () => {
    const { lock, duplicateLookups } = commitBodyOrder(commitBody);
    expect(duplicateLookups.length).toBeGreaterThanOrEqual(2);
    expect(duplicateLookups[0]).toBeLessThan(lock);
  });

  it("re-checks the idempotency key under the lock", () => {
    expect(rechecksUnderLock(commitBody)).toBe(true);
  });

  it("returns the commit statuses the client contract parses", () => {
    for (const status of [
      "committed",
      "duplicate",
      "txid_reused",
      "stale_base",
      "too_large",
      "not_found",
      "unauthenticated",
      "invalid_document",
      "invalid_client_transaction_id",
    ]) {
      expect(commitBody).toContain(`'status', '${status}'`);
    }
  });

  it("writes the revision and the pointer only after the compare-and-set", () => {
    const { cas } = commitBodyOrder(commitBody);
    expect(commitBody.indexOf("insert into public.pisac_document_revisions")).toBeGreaterThan(cas);
    expect(commitBody.indexOf("update public.pisac_documents")).toBeGreaterThan(cas);
  });

  it("states the isolation level it was written for", () => {
    expect(lower).toContain("read committed");
  });
});

describe("2026091905 housekeeping", () => {
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

  it("extracts a function body, and reports a missing one instead of passing", () => {
    const source = "create or replace function public.f(x int) returns int as $$ BODY $$;";
    expect(functionBody(source, "f")).toBe(" body ");
    expect(functionBody(source, "g")).toBeNull();
    expect(functionBody("create or replace function public.f(x int)", "f")).toBeNull();
  });

  it("catches a body that compares the base revision before taking the lock", () => {
    const doctored = `
      if v_current is distinct from p_base_revision then return null; end if;
      select d.current_revision into v_current from public.pisac_documents d
        where d.id = p_document_id for update;
    `;
    expect(locksBeforeCompare(doctored)).toBe(false);
  });

  it("catches a body that never locks at all", () => {
    const doctored = "if v_current is distinct from p_base_revision then return null; end if;";
    expect(locksBeforeCompare(doctored)).toBe(false);
    expect(rechecksUnderLock(doctored)).toBe(false);
  });

  it("catches a body that checks the idempotency key only before the lock", () => {
    const doctored = `
      select r.revision from public.pisac_document_revisions r
        where r.document_id = p_document_id ${DUPLICATE_LOOKUP};
      select d.current_revision into v_current from public.pisac_documents d for update;
      if v_current is distinct from p_base_revision then return null; end if;
    `;
    expect(locksBeforeCompare(doctored)).toBe(true);
    expect(commitBodyOrder(doctored).duplicateLookups).toHaveLength(1);
    expect(rechecksUnderLock(doctored)).toBe(false);
  });

  it("accepts a body that locks first and re-checks after", () => {
    const good = `
      select r.revision from public.pisac_document_revisions r where 1 ${DUPLICATE_LOOKUP};
      select d.current_revision into v_current from public.pisac_documents d for update;
      select r.revision from public.pisac_document_revisions r where 1 ${DUPLICATE_LOOKUP};
      if v_current is distinct from p_base_revision then return null; end if;
    `;
    expect(locksBeforeCompare(good)).toBe(true);
    expect(rechecksUnderLock(good)).toBe(true);
  });
});
