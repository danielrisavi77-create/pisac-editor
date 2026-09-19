import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_WORKSPACE_NAME } from "@/domain/workspace/types";

import {
  countProjectsIn,
  ensureWorkspaceFor,
  insertProject,
  listProjectsIn,
  loadWorkspaceOverview,
} from "./queries";

/** `count` is only set by the head-count replies; the rest carry rows. */
type Reply = { data: unknown; error: unknown; count?: unknown };

type Recorded = {
  table: string;
  select?: string;
  selectOptions?: unknown;
  filters: Record<string, unknown>;
  insert?: unknown;
  order?: { column: string; ascending?: boolean };
  terminal: string;
};

/**
 * A Supabase stand-in that answers with a queued reply per terminal call and
 * records what it was asked. Every function under test takes the client, so
 * nothing here needs a network, an env var or a session.
 */
function fakeClient(replies: Reply[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const next = (): Reply =>
    replies[index++] ?? { data: null, error: { message: "no reply queued" } };

  const client = {
    from(table: string) {
      const recorded: Recorded = { table, filters: {}, terminal: "" };
      const finish = (terminal: string) => {
        recorded.terminal = terminal;
        calls.push(recorded);
        return Promise.resolve(next());
      };
      const chain = {
        select(columns: string, options?: unknown) {
          recorded.select = columns;
          if (options !== undefined) {
            recorded.selectOptions = options;
          }
          return chain;
        },
        /**
         * A head count has no terminal call: the builder itself is awaited.
         * Making the chain thenable is what lets `countProjectsIn` be tested
         * through the same stand-in as everything else.
         */
        then(
          resolve: (reply: Reply) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return finish("await").then(resolve, reject);
        },
        eq(column: string, value: unknown) {
          recorded.filters[column] = value;
          return chain;
        },
        insert(payload: unknown) {
          recorded.insert = payload;
          return chain;
        },
        order(column: string, options?: { ascending?: boolean }) {
          recorded.order = { column, ...options };
          return finish("order");
        },
        maybeSingle: () => finish("maybeSingle"),
        single: () => finish("single"),
      };
      return chain;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const workspaceRow = {
  id: "w1",
  owner_id: "u1",
  name: "Moj radni prostor",
  created_at: "2026-09-19T10:00:00Z",
};

const projectRow = {
  id: "p1",
  workspace_id: "w1",
  title: "Diplomski",
  created_at: "2026-09-19T11:00:00Z",
  updated_at: "2026-09-19T12:00:00Z",
};

describe("ensureWorkspaceFor", () => {
  it("returns the existing workspace without inserting", async () => {
    const { client, calls } = fakeClient([{ data: workspaceRow, error: null }]);

    const result = await ensureWorkspaceFor(client, "u1");

    expect(result).toEqual({
      ok: true,
      value: {
        id: "w1",
        ownerId: "u1",
        name: "Moj radni prostor",
        createdAt: "2026-09-19T10:00:00Z",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toEqual({ owner_id: "u1" });
    expect(calls[0].insert).toBeUndefined();
  });

  it("creates the personal workspace on first sign-in", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: null },
      { data: workspaceRow, error: null },
    ]);

    const result = await ensureWorkspaceFor(client, "u1");

    expect(result.ok).toBe(true);
    expect(calls[1].insert).toEqual({
      owner_id: "u1",
      name: DEFAULT_WORKSPACE_NAME,
    });
  });

  it("re-reads the row when a concurrent request won the insert race", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: null },
      { data: null, error: { message: "duplicate key" } },
      { data: workspaceRow, error: null },
    ]);

    const result = await ensureWorkspaceFor(client, "u1");

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ id: "w1" }) });
    expect(calls).toHaveLength(3);
  });

  it("reports a save failure when the retry finds nothing either", async () => {
    const { client } = fakeClient([
      { data: null, error: null },
      { data: null, error: { message: "duplicate key" } },
      { data: null, error: null },
    ]);

    expect(await ensureWorkspaceFor(client, "u1")).toEqual({
      ok: false,
      code: "spremanje",
      message: expect.any(String),
    });
  });

  it("reports a read failure without attempting an insert", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: { message: "permission denied" } },
    ]);

    expect(await ensureWorkspaceFor(client, "u1")).toEqual({
      ok: false,
      code: "citanje",
      message: expect.any(String),
    });
    expect(calls).toHaveLength(1);
  });

  it("scopes the read to the given user id", async () => {
    const { client, calls } = fakeClient([{ data: workspaceRow, error: null }]);
    await ensureWorkspaceFor(client, "someone-else");
    expect(calls[0].filters).toEqual({ owner_id: "someone-else" });
    expect(calls[0].table).toBe("pisac_workspaces");
  });
});

describe("listProjectsIn", () => {
  it("maps rows to the domain shape, newest first", async () => {
    const { client, calls } = fakeClient([{ data: [projectRow], error: null }]);

    const result = await listProjectsIn(client, "w1");

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "p1",
          workspaceId: "w1",
          title: "Diplomski",
          createdAt: "2026-09-19T11:00:00Z",
          updatedAt: "2026-09-19T12:00:00Z",
        },
      ],
    });
    expect(calls[0].filters).toEqual({ workspace_id: "w1" });
    expect(calls[0].order).toEqual({ column: "created_at", ascending: false });
  });

  it("treats a missing payload as an empty list", async () => {
    const { client } = fakeClient([{ data: null, error: null }]);
    expect(await listProjectsIn(client, "w1")).toEqual({ ok: true, value: [] });
  });

  it("reports a read failure", async () => {
    const { client } = fakeClient([{ data: null, error: { message: "boom" } }]);
    expect(await listProjectsIn(client, "w1")).toEqual({
      ok: false,
      code: "citanje",
      message: expect.any(String),
    });
  });
});

describe("insertProject", () => {
  it("inserts the validated title into the given workspace", async () => {
    const { client, calls } = fakeClient([{ data: projectRow, error: null }]);

    const result = await insertProject(client, "w1", "Diplomski");

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ id: "p1" }) });
    expect(calls[0].table).toBe("pisac_projects");
    expect(calls[0].insert).toEqual({ workspace_id: "w1", title: "Diplomski" });
  });

  it("reports a save failure on an error or an empty row", async () => {
    const onError = fakeClient([{ data: null, error: { message: "boom" } }]);
    expect(await insertProject(onError.client, "w1", "x")).toEqual({
      ok: false,
      code: "spremanje",
      message: expect.any(String),
    });

    const onEmpty = fakeClient([{ data: null, error: null }]);
    expect(await insertProject(onEmpty.client, "w1", "x")).toEqual({
      ok: false,
      code: "spremanje",
      message: expect.any(String),
    });
  });
});

describe("loadWorkspaceOverview", () => {
  it("reads the workspace and its projects in one pass", async () => {
    const { client, calls } = fakeClient([
      { data: workspaceRow, error: null },
      { data: [projectRow], error: null },
    ]);

    const { workspace, projects } = await loadWorkspaceOverview(client, "u1");

    expect(workspace.ok).toBe(true);
    expect(projects.ok && projects.value).toHaveLength(1);
    // Exactly two queries for a page that renders two things.
    expect(calls.map((call) => call.table)).toEqual([
      "pisac_workspaces",
      "pisac_projects",
    ]);
  });

  it("does not query for projects when the workspace could not be read", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: { message: "permission denied" } },
    ]);

    const { workspace, projects } = await loadWorkspaceOverview(client, "u1");

    expect(workspace).toEqual(projects);
    expect(workspace.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("countProjectsIn", () => {
  it("asks for a head count, not for the rows", async () => {
    const { client, calls } = fakeClient([{ data: null, error: null, count: 7 }]);

    expect(await countProjectsIn(client, "w1")).toEqual({ ok: true, value: 7 });
    expect(calls[0]).toMatchObject({
      table: "pisac_projects",
      selectOptions: { count: "exact", head: true },
      filters: { workspace_id: "w1" },
    });
  });

  it("reports zero for an empty workspace", async () => {
    const { client } = fakeClient([{ data: null, error: null, count: 0 }]);

    expect(await countProjectsIn(client, "w1")).toEqual({ ok: true, value: 0 });
  });

  it("fails on a read error rather than reporting a count of nothing", async () => {
    const { client } = fakeClient([
      { data: null, error: { message: "permission denied" }, count: null },
    ]);

    expect(await countProjectsIn(client, "w1")).toEqual({
      ok: false,
      code: "citanje",
      message: expect.any(String),
    });
  });

  it("fails when the answer carried no count at all", async () => {
    const { client } = fakeClient([{ data: null, error: null }]);

    expect(await countProjectsIn(client, "w1")).toEqual({
      ok: false,
      code: "citanje",
      message: expect.any(String),
    });
  });
});
