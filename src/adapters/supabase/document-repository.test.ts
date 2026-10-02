import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import { SupabaseDocumentRepository } from "./document-repository";

function clientWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe("SupabaseDocumentRepository", () => {
  it("maps the Supabase wire revision to an explicit documentRevision", async () => {
    const document = emptyDocument(() => "11111111-1111-4111-8111-111111111111");
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "ok", documentId: "doc-1", revision: 4, document },
      error: null,
    });
    const repository = new SupabaseDocumentRepository(clientWithRpc(rpc));

    await expect(repository.loadOrCreate("project-1")).resolves.toMatchObject({
      ok: true,
      value: { documentId: "doc-1", documentRevision: 4 },
    });
    expect(rpc).toHaveBeenCalledWith("pisac_ensure_document", {
      p_project_id: "project-1",
    });
  });

  it("preserves stale-base semantics with an explicit currentDocumentRevision", async () => {
    const document = emptyDocument(() => "22222222-2222-4222-8222-222222222222");
    const transaction: DocumentTransaction = {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: "tx-1",
      baseRevision: 4,
      document,
      createdAt: "2026-10-02T19:00:00Z",
    };
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "stale_base", currentRevision: 5 },
      error: null,
    });
    const repository = new SupabaseDocumentRepository(clientWithRpc(rpc));

    await expect(repository.commit("doc-1", transaction)).resolves.toEqual({
      ok: true,
      value: { status: "stale_base", currentDocumentRevision: 5 },
    });
  });

  it("turns malformed provider responses into a repository error instead of guessing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "surprise" }, error: null });
    const repository = new SupabaseDocumentRepository(clientWithRpc(rpc));

    await expect(repository.loadOrCreate("project-1")).resolves.toEqual({
      ok: false,
      code: "invalid-response",
    });
  });
});
