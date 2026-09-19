"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  validateDocument,
  type CanonicalDocument,
  type DocumentTransaction,
} from "@/domain/document";
import {
  SERVER_SYNC_ERROR_MESSAGES,
  commitRequestFromTransaction,
  exceedsDocumentSizeLimit,
  parseCommitOutcome,
  parseEnsureOutcome,
  type CommitOutcome,
  type ServerSyncErrorCode,
} from "@/domain/serverSync/contract";

/**
 * Server actions for the canonical server document (F1-4a).
 *
 * The canonical revision lives in Postgres and nowhere else: the local
 * journal holds a *base* revision, never one it minted itself.
 *
 * Neither table is writable by `authenticated` — see the revokes in
 * supabase/migrations/2026091905_f1_documents.sql. Both writes go through a
 * security definer function that checks ownership itself, so there is no
 * read-modify-write in this file at all; a `.update()` here would be
 * last-write-wins by another name, and the database would now refuse it.
 *
 * Like the workspace actions, expected failures are returned as typed error
 * objects with a Croatian message; the only control-flow exception is
 * `redirect`, for "no session" and "Supabase not configured".
 *
 * A `stale_base` answer is NOT an error here: it is a legitimate outcome that
 * the caller has to resolve explicitly (rebase or discard, F1-5a). Draining
 * the pending queue and turning an ACK into SYNCED is F1-4b; this step only
 * provides the single round trip.
 */
export type ServerSyncError = {
  ok: false;
  code: ServerSyncErrorCode;
  message: string;
};

export type ServerSyncResult<T> = { ok: true; value: T } | ServerSyncError;

export type LoadedDocument = {
  /** The server-side document row id, which the commit RPC takes. */
  documentId: string;
  document: CanonicalDocument;
  revision: number;
};

function fail(code: ServerSyncErrorCode): ServerSyncError {
  return { ok: false, code, message: SERVER_SYNC_ERROR_MESSAGES[code] };
}

/** Authenticated Supabase client. Redirects when there is no session. */
async function requireSession(): Promise<SupabaseClient> {
  const supabase = await createClient();
  if (!supabase) {
    redirect("/postavljanje");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/prijava");
  }

  return supabase;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Get-or-create the single F1 document of a project, through
 * `pisac_ensure_document`.
 *
 * The function proves ownership against `auth.uid()` in its own body, so a
 * project that is not the caller's comes back as `not_found` — the same
 * answer as one that does not exist, which is what the page already relies on
 * so the id cannot be probed.
 *
 * What comes back is untrusted too: it may have been written by an older
 * client or a future schema version. An unreadable canonical document is
 * reported rather than repaired or silently replaced by an empty one.
 */
async function ensureDocumentRow(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ServerSyncResult<LoadedDocument>> {
  if (typeof projectId !== "string" || projectId === "") {
    return fail("rad-nepoznat");
  }

  const { data, error } = await supabase.rpc("pisac_ensure_document", {
    p_project_id: projectId,
  });

  if (error) {
    return fail("citanje");
  }

  const outcome = parseEnsureOutcome(data);

  if (outcome.status === "invalid") {
    return fail("odgovor-neispravan");
  }
  if (outcome.status === "unauthenticated") {
    redirect("/prijava");
  }
  if (outcome.status === "not_found") {
    return fail("rad-nepoznat");
  }

  const validated = validateDocument(outcome.document);
  if (!validated.ok) {
    return fail("zapis-neispravan");
  }

  return {
    ok: true,
    value: {
      documentId: outcome.documentId,
      document: validated.doc,
      revision: outcome.revision,
    },
  };
}

/** Get-or-create, for the page so a first visit already has a document row. */
export async function ensureDocument(
  projectId: string,
): Promise<ServerSyncResult<LoadedDocument>> {
  return ensureDocumentRow(await requireSession(), projectId);
}

/** The canonical document and its revision, for page load. */
export async function loadDocument(
  projectId: string,
): Promise<ServerSyncResult<LoadedDocument>> {
  return ensureDocumentRow(await requireSession(), projectId);
}

/**
 * Narrows an untrusted payload to a `DocumentTransaction`.
 *
 * Own properties only: a posted `{"__proto__": ...}` must not be able to
 * supply a `kind` or a `baseRevision`.
 */
function parseCommitPayload(raw: unknown): DocumentTransaction | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const own = (key: string): unknown =>
    Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;

  const kind = own("kind");
  const clientTransactionId = own("clientTransactionId");
  const baseRevision = own("baseRevision");
  const createdAt = own("createdAt");

  if (kind !== "REPLACE_DOCUMENT") {
    return null;
  }
  if (
    typeof clientTransactionId !== "string" ||
    clientTransactionId.length === 0 ||
    clientTransactionId.length > 128
  ) {
    return null;
  }
  if (
    typeof baseRevision !== "number" ||
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0
  ) {
    return null;
  }
  if (typeof createdAt !== "string") {
    return null;
  }

  // The authoritative structural check. It runs before any database call, so
  // a malformed document never reaches the revision log at all.
  const validated = validateDocument(own("document"));
  if (!validated.ok) {
    return null;
  }

  return {
    kind: "REPLACE_DOCUMENT",
    clientTransactionId,
    baseRevision,
    document: validated.doc,
    createdAt,
  };
}

/**
 * One compare-and-set round trip.
 *
 * Order matters: the payload is validated and measured, then the document row
 * is ensured, then the RPC runs — all on one session. Nothing is written on a
 * payload the canonical model cannot express, and an oversized document never
 * leaves this process.
 */
export async function commitDocument(
  projectId: string,
  payload: unknown,
): Promise<ServerSyncResult<CommitOutcome>> {
  const tx = parseCommitPayload(payload);
  if (!tx) {
    return fail("zapis-neispravan");
  }

  if (exceedsDocumentSizeLimit(tx.document)) {
    return fail("prevelik");
  }

  const supabase = await requireSession();

  const row = await ensureDocumentRow(supabase, projectId);
  if (!row.ok) {
    return row;
  }

  const request = commitRequestFromTransaction(row.value.documentId, tx);
  if (!request) {
    return fail("zapis-neispravan");
  }

  const { data, error } = await supabase.rpc("pisac_commit_document", request);

  if (error) {
    return fail("slanje");
  }

  const outcome = parseCommitOutcome(data);
  if (outcome.status === "invalid") {
    return fail("odgovor-neispravan");
  }

  return { ok: true, value: outcome };
}
