import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Cheap tripwires over the prepared F1-5b migration — the same approach, and
 * the same helper shapes, as src/domain/serverSync/migration.test.ts.
 * `docker` is unavailable here, so this guards the properties that would be
 * expensive to get wrong in a file that is applied by hand: RLS on, a table
 * that is append-only in privilege as well as in policy, the write path closed
 * to everything but one definer function, content that comes from the server
 * row rather than from the caller, and no anonymous access.
 *
 * Each check is a pure function over SQL text, and the negative fixtures at
 * the bottom prove the tripwires actually fire.
 */
const MIGRATION_FILENAME = "2026091906_f1_checkpoints.sql";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = path.join(repoRoot, "supabase/migrations", MIGRATION_FILENAME);
const sql = readFileSync(migrationPath, "utf8");
const lower = sql.toLowerCase();

const TABLE = "pisac_checkpoints";
const CREATE_FN = "pisac_create_checkpoint";
const CREATE_SIGNATURE = `public.${CREATE_FN}(uuid, text)`;

/** Strips comments and dollar-quoted bodies, then splits on `;`. */
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

/** Statements that mention `anon` other than to revoke from it. */
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

/** The plpgsql body of one function, lower-cased but otherwise verbatim. */
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

/**
 * The parameter list of a function's header — what a caller can supply.
 * A `p_document`-shaped parameter here would mean client-supplied content.
 */
function functionParameters(source: string, name: string): string | null {
  const text = source.toLowerCase();
  const start = text.indexOf(`create or replace function public.${name}(`);
  if (start < 0) {
    return null;
  }
  const open = text.indexOf("(", start);
  const close = text.indexOf(")", open);
  if (open < 0 || close < 0) {
    return null;
  }
  return text.slice(open + 1, close).replace(/\s+/g, " ").trim();
}

/** True when the body reads the document row before it inserts anything. */
function readsBeforeInsert(body: string): boolean {
  const read = body.indexOf("from public.pisac_documents");
  const insert = body.indexOf("insert into public.pisac_checkpoints");
  return read >= 0 && insert >= 0 && read < insert;
}

const statements = splitStatements(sql);
const createBody = functionBody(sql, CREATE_FN) ?? "";

describe("2026091906_f1_checkpoints.sql", () => {
  it("lives under supabase/migrations with the planned filename", () => {
    expect(path.basename(migrationPath)).toBe(MIGRATION_FILENAME);
    expect(
      migrationPath.endsWith(path.join("supabase", "migrations", MIGRATION_FILENAME)),
    ).toBe(true);
  });

  it("creates the checkpoint table and turns RLS on", () => {
    expect(lower).toContain(`create table if not exists public.${TABLE}`);
    expect(lower).toContain(`alter table public.${TABLE} enable row level security`);
  });

  it("cascades from the document it belongs to", () => {
    expect(lower).toContain("references public.pisac_documents(id) on delete cascade");
  });

  it("keeps one checkpoint per document, revision and name", () => {
    expect(lower).toContain("unique (document_id, revision, name)");
  });

  it("constrains the name in the schema, not only in the RPC", () => {
    expect(lower).toContain("char_length(name) between 1 and 120");
  });

  it("stores the document and its digest alongside the revision", () => {
    expect(lower).toContain("document jsonb not null");
    expect(lower).toContain("document_digest text not null");
    expect(lower).toContain("char_length(document_digest) = 32");
    expect(lower).toContain("revision bigint not null");
  });

  it("records who made it, against auth.users", () => {
    expect(lower).toContain("created_by uuid not null references auth.users(id)");
  });

  it("marks itself as prepared, not auto-applied", () => {
    expect(lower).toContain("do not auto-apply to production");
    expect(lower).toContain("cxwxxcwrgushfkisfpxz");
  });

  it("states the isolation level it was written for", () => {
    expect(lower).toContain("read committed");
  });

  it("says restoring is out of scope, so no one adds it here by accident", () => {
    expect(lower).toContain("restoring a checkpoint is not part of f1");
  });
});

describe("a checkpoint cannot be rewritten or erased", () => {
  it("declares a select policy and nothing else", () => {
    const commands = policies(sql).map((policy) => policy.command);

    expect(commands.length).toBeGreaterThanOrEqual(1);
    expect(new Set(commands)).toEqual(new Set(["select"]));
  });

  it("targets only the checkpoint table in every create policy", () => {
    for (const policy of policies(sql)) {
      expect(policy.table).toBe(TABLE);
    }
  });

  it("declares no insert, update or delete policy anywhere in the file", () => {
    for (const clause of ["for insert", "for delete", "for update", "for all"]) {
      expect(statements.some((statement) => statement.includes(clause))).toBe(false);
    }
  });

  it("revokes insert, update and delete from authenticated", () => {
    expect(statements).toContain(
      `revoke insert, update, delete on table public.${TABLE} from authenticated`,
    );
  });

  it("never updates or deletes a checkpoint in the function body either", () => {
    expect(createBody).not.toContain(`update public.${TABLE}`);
    expect(createBody).not.toContain(`delete from public.${TABLE}`);
  });

  it("never mentions the service role", () => {
    expect(lower).not.toContain("service_role");
  });
});

describe("the write path is the one definer function", () => {
  it("declares it security definer with an empty search_path", () => {
    const definition = statements.find((statement) =>
      statement.startsWith(`create or replace function public.${CREATE_FN}(`),
    );

    expect(definition).toBeDefined();
    expect(definition).toContain("security definer");
    expect(definition).toContain("set search_path = ''");
    expect(definition).not.toContain("security invoker");
  });

  it("checks auth.uid() for null before it touches a table", () => {
    expect(createBody).toContain("v_actor := auth.uid()");
    expect(createBody).toContain("if v_actor is null then");
    expect(createBody).toContain("'status', 'unauthenticated'");
    expect(createBody.indexOf("if v_actor is null then")).toBeLessThan(
      createBody.indexOf("public.pisac_documents"),
    );
  });

  it("proves ownership inside the body, because definer skips RLS", () => {
    expect(createBody).toContain("join public.pisac_projects p on p.id = d.project_id");
    expect(createBody).toContain("join public.pisac_workspaces w on w.id = p.workspace_id");
    expect(createBody).toContain("w.owner_id = v_actor");
    expect(createBody).toContain("'status', 'not_found'");
  });

  it("takes only a document id and a name — never the content", () => {
    const parameters = functionParameters(sql, CREATE_FN);
    expect(parameters).toBe("p_document_id uuid, p_name text");
    expect(parameters).not.toContain("jsonb");
  });

  it("snapshots what the server holds, reading the row before it inserts", () => {
    expect(createBody).toContain("d.current_revision");
    expect(createBody).toContain("d.current_document");
    expect(readsBeforeInsert(createBody)).toBe(true);
  });

  it("holds the document row while it copies it, without a write lock", () => {
    expect(createBody).toContain("for share of d");
    expect(createBody).not.toContain("for update");
  });

  it("trims the name and bounds it, as the client contract does", () => {
    expect(createBody).toContain("btrim");
    expect(createBody).toContain("'status', 'invalid_name'");
  });

  it("computes the digest itself rather than taking one", () => {
    expect(createBody).toContain("md5(v_document::text)");
  });

  it("returns exactly the statuses the client contract parses", () => {
    for (const status of ["created", "not_found", "unauthenticated", "invalid_name"]) {
      expect(createBody).toContain(`'status', '${status}'`);
    }
  });

  it("revokes execute from public and anon, granting it to authenticated only", () => {
    expect(statements).toContain(`revoke all on function ${CREATE_SIGNATURE} from public`);
    expect(statements).toContain(`revoke all on function ${CREATE_SIGNATURE} from anon`);
    expect(statements).toContain(
      `grant execute on function ${CREATE_SIGNATURE} to authenticated`,
    );
  });

  it("names the anon role only to revoke from it", () => {
    expect(anonStatements(sql)).toEqual([]);
  });

  it("revokes all privileges from anon on the table", () => {
    expect(statements).toContain(`revoke all on table public.${TABLE} from anon`);
  });
});

describe("migration tripwires fire on bad SQL", () => {
  it("flags a grant to anon, however it is hidden", () => {
    expect(anonStatements("grant execute on function public.f() to anon;")).toHaveLength(1);
    expect(
      anonStatements("-- nothing for anon\ngrant select on public.pisac_checkpoints to anon;"),
    ).toHaveLength(1);
    expect(anonStatements("revoke all on table public.pisac_checkpoints from anon;")).toEqual(
      [],
    );
  });

  it("reads the policy target and command from the create policy clause", () => {
    const bad = "create policy p on public.pisac_checkpoints for delete using (true);";
    expect(policies(bad)).toEqual([{ table: "pisac_checkpoints", command: "delete" }]);
  });

  it("extracts a function body, and reports a missing one instead of passing", () => {
    const source = "create or replace function public.f(x int) returns int as $$ BODY $$;";
    expect(functionBody(source, "f")).toBe(" body ");
    expect(functionBody(source, "g")).toBeNull();
  });

  it("reads a parameter list, and catches one that would take content", () => {
    const bad =
      "create or replace function public.pisac_create_checkpoint(p_document_id uuid, p_name text, p_document jsonb) returns jsonb as $$ begin end; $$;";
    expect(functionParameters(bad, CREATE_FN)).toContain("jsonb");
    expect(functionParameters("create or replace function public.g()", CREATE_FN)).toBeNull();
  });

  it("catches a body that inserts before it has read the server's row", () => {
    const doctored = `
      insert into public.pisac_checkpoints (document_id) values (p_document_id);
      select d.current_document from public.pisac_documents d where d.id = p_document_id;
    `;
    expect(readsBeforeInsert(doctored)).toBe(false);
    expect(readsBeforeInsert("select 1;")).toBe(false);
  });

  it("accepts a body that reads first and inserts after", () => {
    const good = `
      select d.current_document from public.pisac_documents d where d.id = p_document_id for share of d;
      insert into public.pisac_checkpoints (document_id) values (p_document_id);
    `;
    expect(readsBeforeInsert(good)).toBe(true);
  });
});
