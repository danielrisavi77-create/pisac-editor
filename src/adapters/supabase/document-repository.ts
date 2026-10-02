import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DocumentCommitOutcome,
  DocumentRepository,
  DocumentRepositoryResult,
} from "@/application/ports/document-repository";
import { asDocumentRevision } from "@/application/ports/revisions";
import { validateDocument, type DocumentTransaction } from "@/domain/document";
import {
  commitRequestFromTransaction,
  parseCommitOutcome,
  parseEnsureOutcome,
} from "@/domain/serverSync/contract";

/**
 * Current F1 adapter for the provider-neutral DocumentRepository port.
 *
 * It deliberately contains every Supabase-specific RPC name. Application
 * contracts above this file remain portable to another Postgres/API adapter.
 */
export class SupabaseDocumentRepository implements DocumentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadOrCreate(projectId: string) {
    if (typeof projectId !== "string" || projectId.trim() === "") {
      return { ok: false, code: "invalid-input" } as const;
    }

    const { data, error } = await this.supabase.rpc("pisac_ensure_document", {
      p_project_id: projectId,
    });
    if (error) {
      return { ok: false, code: "transport" } as const;
    }

    const outcome = parseEnsureOutcome(data);
    if (outcome.status === "invalid") {
      return { ok: false, code: "invalid-response" } as const;
    }
    if (outcome.status === "unauthenticated") {
      return { ok: false, code: "unauthenticated" } as const;
    }
    if (outcome.status === "not_found") {
      return { ok: false, code: "not-found" } as const;
    }

    const validated = validateDocument(outcome.document);
    if (!validated.ok) {
      return { ok: false, code: "invalid-document" } as const;
    }

    return {
      ok: true,
      value: {
        documentId: outcome.documentId,
        document: validated.doc,
        documentRevision: asDocumentRevision(outcome.revision),
      },
    } as const;
  }

  async commit(
    documentId: string,
    transaction: DocumentTransaction,
  ): Promise<DocumentRepositoryResult<DocumentCommitOutcome>> {
    const request = commitRequestFromTransaction(documentId, transaction);
    if (!request) {
      return { ok: false, code: "invalid-input" };
    }

    const { data, error } = await this.supabase.rpc("pisac_commit_document", request);
    if (error) {
      return { ok: false, code: "transport" };
    }

    const outcome = parseCommitOutcome(data);
    switch (outcome.status) {
      case "invalid":
        return { ok: false, code: "invalid-response" };
      case "committed":
      case "duplicate":
        return {
          ok: true,
          value: {
            status: outcome.status,
            documentRevision: asDocumentRevision(outcome.revision),
          },
        };
      case "stale_base":
        return {
          ok: true,
          value: {
            status: "stale_base",
            currentDocumentRevision: asDocumentRevision(outcome.currentRevision),
          },
        };
      case "txid_reused":
      case "too_large":
      case "not_found":
      case "unauthenticated":
      case "invalid_document":
      case "invalid_client_transaction_id":
        return { ok: true, value: { status: outcome.status } };
    }
  }
}
