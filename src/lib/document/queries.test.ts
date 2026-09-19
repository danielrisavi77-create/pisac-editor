import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// `redirect` throws in Next; here it is a recognisable sentinel so the
// "unauthenticated" branch can be asserted without a Next runtime.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import { emptyDocument } from "@/domain/document";

import { ensureDocumentRow } from "./queries";

type Reply = { data: unknown; error: unknown };

type RpcCall = { fn: string; args: unknown };

function fakeClient(reply: Reply) {
  const calls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return Promise.resolve(reply);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const document = emptyDocument(() => "33333333-3333-4333-8333-333333333333");

function okReply(overrides: Record<string, unknown> = {}): Reply {
  return {
    data: { status: "ok", documentId: "d1", revision: 3, document, ...overrides },
    error: null,
  };
}

describe("ensureDocumentRow", () => {
  it("returns the canonical document and its revision", async () => {
    const { client, calls } = fakeClient(okReply());

    const result = await ensureDocumentRow(client, "p1");

    expect(result).toEqual({
      ok: true,
      value: { documentId: "d1", document, revision: 3 },
    });
    expect(calls).toEqual([
      { fn: "pisac_ensure_document", args: { p_project_id: "p1" } },
    ]);
  });

  it("refuses an empty or non-string project id without a round trip", async () => {
    const { client, calls } = fakeClient(okReply());

    expect(await ensureDocumentRow(client, "")).toEqual({
      ok: false,
      code: "rad-nepoznat",
      message: expect.any(String),
    });
    expect(
      await ensureDocumentRow(client, undefined as unknown as string),
    ).toEqual({ ok: false, code: "rad-nepoznat", message: expect.any(String) });
    expect(calls).toHaveLength(0);
  });

  it("reports a transport error as a read failure", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });

    expect(await ensureDocumentRow(client, "p1")).toEqual({
      ok: false,
      code: "citanje",
      message: expect.any(String),
    });
  });

  it("reports an unparseable answer rather than guessing", async () => {
    const { client } = fakeClient({ data: { status: "ok" }, error: null });

    expect(await ensureDocumentRow(client, "p1")).toEqual({
      ok: false,
      code: "odgovor-neispravan",
      message: expect.any(String),
    });
  });

  it("maps not_found to the same answer for a foreign and a missing project", async () => {
    const { client } = fakeClient({ data: { status: "not_found" }, error: null });

    expect(await ensureDocumentRow(client, "p1")).toEqual({
      ok: false,
      code: "rad-nepoznat",
      message: expect.any(String),
    });
  });

  it("redirects to /prijava when the RPC reports no session", async () => {
    const { client } = fakeClient({ data: { status: "unauthenticated" }, error: null });

    await expect(ensureDocumentRow(client, "p1")).rejects.toThrow("REDIRECT:/prijava");
  });

  it("reports a stored document the canonical model cannot read", async () => {
    const { client } = fakeClient(okReply({ document: { nodes: "not an array" } }));

    expect(await ensureDocumentRow(client, "p1")).toEqual({
      ok: false,
      code: "zapis-neispravan",
      message: expect.any(String),
    });
  });

  it("accepts revision 0, the revision of a document with no commit yet", async () => {
    const { client } = fakeClient(okReply({ revision: 0 }));

    const result = await ensureDocumentRow(client, "p1");
    expect(result.ok && result.value.revision).toBe(0);
  });
});
