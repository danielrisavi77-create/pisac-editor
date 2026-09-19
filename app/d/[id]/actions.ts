"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  emptyDocument,
  validateDocument,
  type CanonicalDocument,
  type DocumentTransaction,
} from "@/domain/document";
import {
  SERVER_SYNC_ERROR_MESSAGES,
  commitRequestFromTransaction,
  parseCommitOutcome,
  type CommitOutcome,
  type ServerSyncErrorCode,
} from "@/domain/serverSync/contract";

/**
 * Server actions for the canonical server document (F1-4a).
 *
 * The canonical revision lives in Postgres and nowhere else: the local
 * journal holds a *base* revision, never one it minted itself. Everything
 * here goes through `pisac_commit_document`, which does the compare-and-set
 * under a row lock — this file must never write `pisac_documents` directly
 * from a read-modify-write, because that is last-write-wins by another name.
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
  document: CanonicalDocument;
  revision: number;
};

type DocumentRow = {
  id: string;
  current_revision: number;
  current_document: unknown;
};

function fail(code: ServerSyncErrorCode): ServerSyncError {
  return { ok: false, code, message: SERVER_SYNC_ERROR_MESSAGES[code] };
}

/** Authenticated Supabase client. Redirects when there is no session. */
async function requireSession() {
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
 * Get-or-create the single F1 document of a project.
 *
 * RLS scopes the read to the owner, so a project that is not the caller's is
 * indistinguishable from one that does not exist — and the insert would be
 * refused by the policy anyway. A lost race on the unique `project_id` is
 * resolved by re-reading, exactly like `ensureWorkspace`.
 */
async function ensureDocumentRow(projectId: string): Promise<ServerSyncResult<DocumentRow>> {
  if (typeof projectId !== "string" || projectId === "") {
    return fail("rad-nepoznat");
  }

  const supabase = await requireSession();
  const columns = "id, current_revision, current_document";

  const existing = await supabase
    .from("pisac_documents")
    .select(columns)
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing.error) {
    return fail("citanje");
  }
  if (existing.data) {
    return { ok: true, value: existing.data as DocumentRow };
  }

  // Revision 0 with one empty paragraph: the document exists, and nothing has
  // been committed to it yet. That is not the same as "saved".
  const created = await supabase
    .from("pisac_documents")
    .insert({
      project_id: projectId,
      current_revision: 0,
      current_document: emptyDocument(),
    })
    .select(columns)
    .single();

  if (created.error) {
    const retry = await supabase
      .from("pisac_documents")
      .select(columns)
      .eq("project_id", projectId)
      .maybeSingle();

    if (retry.error || !retry.data) {
      return fail("rad-nepoznat");
    }
    return { ok: true, value: retry.data as DocumentRow };
  }

  return { ok: true, value: created.data as DocumentRow };
}

/** Get-or-create, exposed for the page so a first visit has a document row. */
export async function ensureDocument(projectId: string): Promise<ServerSyncResult<LoadedDocument>> {
  const row = await ensureDocumentRow(projectId);
  if (!row.ok) {
    return row;
  }
  return toLoadedDocument(row.value);
}

/**
 * The canonical document and its revision, for page load.
 *
 * What comes back from the database is untrusted too: it may have been
 * written by an older client or a future schema version. An unreadable
 * canonical document is reported rather than repaired or silently replaced by
 * an empty one, because a caller that showed an empty document at the stored
 * revision would invite the author to overwrite their own text.
 */
function toLoadedDocument(row: DocumentRow): ServerSyncResult<LoadedDocument> {
  const revision = row.current_revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    return fail("citanje");
  }

  const validated = validateDocument(row.current_document);
  if (!validated.ok) {
    return fail("zapis-neispravan");
  }

  return { ok: true, value: { document: validated.doc, revision } };
}

export async function loadDocument(projectId: string): Promise<ServerSyncResult<LoadedDocument>> {
  const row = await ensureDocumentRow(projectId);
  if (!row.ok) {
    return row;
  }
  return toLoadedDocument(row.value);
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
 * Order matters: the payload is validated, then the document row is ensured,
 * then the RPC runs. Nothing is written on a payload the canonical model
 * cannot express.
 */
export async function commitDocument(
  projectId: string,
  payload: unknown,
): Promise<ServerSyncResult<CommitOutcome>> {
  const tx = parseCommitPayload(payload);
  if (!tx) {
    return fail("zapis-neispravan");
  }

  const row = await ensureDocumentRow(projectId);
  if (!row.ok) {
    return row;
  }

  const request = commitRequestFromTransaction(row.value.id, tx);
  if (!request) {
    return fail("zapis-neispravan");
  }

  const supabase = await requireSession();
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
