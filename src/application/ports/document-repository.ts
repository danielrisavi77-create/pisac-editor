import type { CanonicalDocument, DocumentTransaction } from "@/domain/document";
import type { DocumentRevision } from "./revisions";

export type CanonicalDocumentSnapshot = {
  documentId: string;
  document: CanonicalDocument;
  documentRevision: DocumentRevision;
};

export type DocumentCommitOutcome =
  | { status: "committed"; documentRevision: DocumentRevision }
  | { status: "duplicate"; documentRevision: DocumentRevision }
  | { status: "stale_base"; currentDocumentRevision: DocumentRevision }
  | { status: "txid_reused" }
  | { status: "too_large" }
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "invalid_document" }
  | { status: "invalid_client_transaction_id" };

export type DocumentRepositoryErrorCode =
  | "invalid-input"
  | "transport"
  | "invalid-response"
  | "invalid-document"
  | "unauthenticated"
  | "not-found";

export type DocumentRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: DocumentRepositoryErrorCode };

/**
 * Application port for canonical document persistence.
 *
 * Domain/application code depends on this interface, not on Supabase, Azure,
 * PostgREST or any other storage vendor.
 */
export interface DocumentRepository {
  loadOrCreate(projectId: string): Promise<DocumentRepositoryResult<CanonicalDocumentSnapshot>>;
  commit(
    documentId: string,
    transaction: DocumentTransaction,
  ): Promise<DocumentRepositoryResult<DocumentCommitOutcome>>;
}
