import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MIGRATION_FILENAME = "20261002185020_gate1_least_privilege.sql";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = path.join(repoRoot, "supabase/migrations", MIGRATION_FILENAME);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();

function splitStatements(source: string): string[] {
  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

const statements = splitStatements(sql);

const CRUD = ["pisac_workspaces", "pisac_projects"] as const;
const READ_ONLY = [
  "pisac_documents",
  "pisac_document_revisions",
  "pisac_checkpoints",
] as const;
const ALL_TABLES = [...CRUD, ...READ_ONLY];

describe(MIGRATION_FILENAME, () => {
  it("is a forward-only privilege migration over exactly the five F1 tables", () => {
    expect(sql).toContain("forward-only");
    for (const table of ALL_TABLES) expect(sql).toContain(`public.${table}`);
    expect(sql).not.toMatch(/\b(create|drop|alter)\s+(table|function|policy)\b/);
    expect(sql).not.toContain("service_role");
  });

  it("removes every inherited/default table privilege from anon and authenticated", () => {
    for (const table of ALL_TABLES) {
      expect(statements).toContain(
        `revoke all on table public.${table} from anon, authenticated`,
      );
    }
  });

  it("re-grants only owner-scoped CRUD for workspace/project tables", () => {
    for (const table of CRUD) {
      expect(statements).toContain(
        `grant select, insert, update, delete on table public.${table} to authenticated`,
      );
    }
  });

  it("re-grants only SELECT on canonical server-state tables", () => {
    for (const table of READ_ONLY) {
      expect(statements).toContain(
        `grant select on table public.${table} to authenticated`,
      );
    }
    expect(sql).not.toMatch(/grant\s+[^;]*(insert|update|delete|truncate|references|trigger|maintain)[^;]*pisac_(documents|document_revisions|checkpoints)/);
  });

  it("parses the same revoke contract from Windows CRLF input", () => {
    const windowsSql =
      "-- least privilege\r\n" +
      "revoke all on table public.pisac_workspaces from anon, authenticated;\r\n" +
      "grant select, insert, update, delete on table public.pisac_workspaces to authenticated;\r\n";
    expect(splitStatements(windowsSql)).toEqual([
      "revoke all on table public.pisac_workspaces from anon, authenticated",
      "grant select, insert, update, delete on table public.pisac_workspaces to authenticated",
    ]);
  });

  it("does not modify the canonical RPC execute contract", () => {
    expect(sql).not.toMatch(/\b(grant|revoke)\s+execute\b/);
    expect(sql).not.toMatch(/\bfunction\s+public\.pisac_/);
  });
});
