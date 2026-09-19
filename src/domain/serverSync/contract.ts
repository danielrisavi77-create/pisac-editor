/**
 * The wire contract between the client and `public.pisac_commit_document`
 * (supabase/migrations/2026091905_f1_documents.sql).
 *
 * Pure TypeScript: no Supabase, Next.js or React imports, so every branch is
 * unit-testable without a database. The RPC answers with a jsonb object; the
 * network, a proxy or a future migration can all hand us something else, so
 * nothing here trusts the shape it is given.
 *
 * INVARIANT (constitution) — no silent last-write-wins. `stale_base` is a
 * first-class outcome, not an error to be retried by overwriting: it carries
 * the server's current revision so the caller can rebase or discard
 * explicitly (F1-5a).
 *
 * INVARIANT (dossier §7) — the idempotency key is
 * `(document_id, actor_id, client_transaction_id)`. The actor is taken from
 * the session by the RPC itself and is deliberately absent from the request:
 * a client that could name the actor could replay someone else's key.
 */

import type { CanonicalDocument, DocumentTransaction } from "../document";

/** Every status `pisac_commit_document` can return, and nothing else. */
export const COMMIT_STATUSES = [
  "committed",
  "duplicate",
  "stale_base",
  "not_found",
  "unauthenticated",
  "invalid_document",
  "invalid_client_transaction_id",
] as const;

export type CommitStatus = (typeof COMMIT_STATUSES)[number];

/**
 * A parsed answer from the RPC.
 *
 * `committed` and `duplicate` both carry the revision the payload occupies —
 * a replay of a lost response is indistinguishable from the original commit
 * on purpose, and the caller may treat both as an ACK for that revision.
 */
export type CommitOutcome =
  | { status: "committed"; revision: number }
  | { status: "duplicate"; revision: number }
  | { status: "stale_base"; currentRevision: number }
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "invalid_document" }
  | { status: "invalid_client_transaction_id" };

/** Returned when the payload is not a recognisable outcome at all. */
export type InvalidCommitOutcome = { status: "invalid" };

/** Arguments of the RPC, named exactly as the SQL function declares them. */
export type CommitRequest = {
  p_document_id: string;
  p_base_revision: number;
  p_document: CanonicalDocument;
  p_client_transaction_id: string;
};

/**
 * Codes for the failures the server action reports back, with one Croatian
 * message each — the same shape as `ACTION_ERROR_MESSAGES` in
 * `@/domain/workspace/types`.
 *
 * There is deliberately no code for a successful commit: durability is stated
 * by the sync state chip (`@/domain/sync/labels`), and the constitution
 * forbids a generic "Saved" label. `stale_base` is likewise absent — it is an
 * outcome the caller resolves explicitly, not an error message.
 */
export type ServerSyncErrorCode =
  | "zapis-neispravan"
  | "rad-nepoznat"
  | "citanje"
  | "slanje"
  | "odgovor-neispravan";

export const SERVER_SYNC_ERROR_MESSAGES: Record<ServerSyncErrorCode, string> = {
  "zapis-neispravan": "Zapis rada nije u ispravnom obliku, pa nije poslan.",
  "rad-nepoznat": "Rad nije pronađen na poslužitelju.",
  citanje: "Rad trenutačno nije moguće dohvatiti s poslužitelja.",
  slanje: "Promjena nije poslana na poslužitelj. Pokušat ćemo ponovno.",
  "odgovor-neispravan": "Poslužitelj je vratio odgovor koji nije moguće pročitati.",
};

/**
 * Narrows an untrusted code (a query parameter, a serialised error) to a
 * known one. `in` would walk the prototype chain, so only own keys count.
 */
export function parseServerSyncErrorCode(raw: unknown): ServerSyncErrorCode | null {
  if (typeof raw !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(SERVER_SYNC_ERROR_MESSAGES, raw)
    ? (raw as ServerSyncErrorCode)
    : null;
}

/**
 * Own, non-inherited property. `in` and a bare index would both walk the
 * prototype chain, so `{"__proto__": ...}` or a `status` of `"constructor"`
 * would otherwise sail through.
 */
function ownProperty(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

/**
 * Rejects arrays and anything with a surprising prototype. A `JSON.parse`d
 * response is a plain object; a class instance or an array is not the RPC
 * answering, it is something else pretending.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A revision as Postgres `bigint` is serialised by PostgREST: a JSON number.
 * Anything fractional, negative, non-finite or beyond `Number.MAX_SAFE_INTEGER`
 * is refused rather than rounded — a silently rounded revision would make the
 * next compare-and-set lie.
 */
function isRevision(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  );
}

/**
 * Narrows an untrusted RPC payload to a `CommitOutcome`.
 *
 * Strict by design: an unknown status, a missing revision or an extra field
 * all yield `{ status: 'invalid' }`. Guessing here would mean guessing about
 * an author's document.
 */
export function parseCommitOutcome(raw: unknown): CommitOutcome | InvalidCommitOutcome {
  if (!isPlainObject(raw)) {
    return { status: "invalid" };
  }

  const status = ownProperty(raw, "status");
  if (typeof status !== "string") {
    return { status: "invalid" };
  }

  switch (status) {
    case "committed":
    case "duplicate": {
      const revision = ownProperty(raw, "revision");
      // A commit always advances past 0, so revision 0 is not an ACK.
      if (!isRevision(revision, 1)) {
        return { status: "invalid" };
      }
      return { status, revision };
    }
    case "stale_base": {
      const currentRevision = ownProperty(raw, "currentRevision");
      // 0 is legitimate here: the document exists and holds no commit yet.
      if (!isRevision(currentRevision, 0)) {
        return { status: "invalid" };
      }
      return { status: "stale_base", currentRevision };
    }
    case "not_found":
    case "unauthenticated":
    case "invalid_document":
    case "invalid_client_transaction_id":
      return { status };
    default:
      return { status: "invalid" };
  }
}

/**
 * Builds the RPC arguments from a queued transaction.
 *
 * Only `REPLACE_DOCUMENT` exists in F1 (dossier §5); a transaction of any
 * other kind is refused rather than sent as if it were a replacement, because
 * the server would store its document wholesale.
 */
export function commitRequestFromTransaction(
  documentId: string,
  tx: DocumentTransaction,
): CommitRequest | null {
  if (tx.kind !== "REPLACE_DOCUMENT") {
    return null;
  }
  if (typeof documentId !== "string" || documentId === "") {
    return null;
  }
  if (typeof tx.clientTransactionId !== "string" || tx.clientTransactionId === "") {
    return null;
  }
  if (!isRevision(tx.baseRevision, 0)) {
    return null;
  }

  return {
    p_document_id: documentId,
    p_base_revision: tx.baseRevision,
    p_document: tx.document,
    p_client_transaction_id: tx.clientTransactionId,
  };
}
