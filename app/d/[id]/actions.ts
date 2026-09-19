"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  ensureDocumentRow,
  fail,
  type LoadedDocument,
  type ServerSyncError,
  type ServerSyncResult,
} from "@/lib/document/queries";
import { validateDocument, type DocumentTransaction } from "@/domain/document";
import {
  CHECKPOINT_ERROR_MESSAGES,
  checkpointNameErrorCode,
  parseCheckpointList,
  parseCheckpointOutcome,
  validateCheckpointName,
  type CheckpointErrorCode,
  type CheckpointOutcome,
  type CheckpointSummary,
} from "@/domain/serverSync/checkpoints";
import {
  commitRequestFromTransaction,
  exceedsDocumentSizeLimit,
  parseCommitOutcome,
  type CommitOutcome,
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
export type { LoadedDocument, ServerSyncError, ServerSyncResult };

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
 * The canonical document and its revision, for the editor client.
 *
 * Get-or-create: a first visit already has a row at revision 0 to
 * compare-and-set against (F1-4a). The page does not call this — it holds an
 * authenticated client already and calls `ensureDocumentRow` directly, so a
 * page load does one `getUser()` instead of two. An action is a POST endpoint
 * anyone can invoke, so this one authenticates itself.
 */
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

/* ----------------------------------------------------- checkpoints (F1-5b) */

export type CheckpointError = {
  ok: false;
  code: CheckpointErrorCode;
  message: string;
};

export type CheckpointResult<T> = { ok: true; value: T } | CheckpointError;

/**
 * The only outcome a successful `createCheckpoint` can carry. The other three
 * statuses are failures with a Croatian message, so the caller never has to
 * narrow a union to find the revision it must show the author.
 */
export type CreatedCheckpoint = Extract<CheckpointOutcome, { status: "created" }>;

function checkpointFail(code: CheckpointErrorCode): CheckpointError {
  return { ok: false, code, message: CHECKPOINT_ERROR_MESSAGES[code] };
}

/**
 * Names the CURRENT server revision of this project's document.
 *
 * What is checkpointed is SERVER truth and only server truth: no document is
 * sent from here, and `pisac_create_checkpoint` reads the content from
 * `pisac_documents` itself. Anything still sitting in the local pending queue
 * is therefore not in the checkpoint — the caller shows
 * `UNSYNCED_CHANGES_NOTE` when that is the case, because a checkpoint the
 * author believes covers unsent work would be exactly the false claim of
 * durability the eight sync states exist to prevent.
 *
 * The name is validated by the same pure rule the RPC applies, before the
 * round trip, so an empty or over-long name never becomes a call that can
 * only fail.
 */
export async function createCheckpoint(
  projectId: string,
  name: string,
): Promise<CheckpointResult<CreatedCheckpoint>> {
  const validated = validateCheckpointName(name);
  if (!validated.ok) {
    return checkpointFail(checkpointNameErrorCode(validated.reason));
  }

  const supabase = await requireSession();

  // The checkpoint is of the server's document row, so that row has to exist
  // (and be the caller's) before there is anything to name.
  const row = await ensureDocumentRow(supabase, projectId);
  if (!row.ok) {
    return checkpointFail(row.code === "rad-nepoznat" ? "rad-nepoznat" : "citanje");
  }

  const { data, error } = await supabase.rpc("pisac_create_checkpoint", {
    p_document_id: row.value.documentId,
    p_name: validated.value,
  });

  if (error) {
    return checkpointFail("spremanje");
  }

  const outcome = parseCheckpointOutcome(data);
  if (outcome.status === "invalid") {
    return checkpointFail("odgovor-neispravan");
  }
  if (outcome.status === "unauthenticated") {
    redirect("/prijava");
  }
  if (outcome.status === "not_found") {
    return checkpointFail("rad-nepoznat");
  }
  if (outcome.status === "invalid_name") {
    // The RPC applies the same rule, so this is a belt-and-braces path rather
    // than an expected one.
    return checkpointFail("naziv-prazan");
  }

  return { ok: true, value: outcome };
}

/**
 * The checkpoints of this project's document, newest first.
 *
 * Read through RLS with a plain select — there is no definer function here
 * because there is nothing to protect beyond the owner-only select policy,
 * and the documents themselves are deliberately NOT selected: the list is a
 * list of bookmarks, and shipping a copy of every checkpointed document to
 * render four lines of text would be a lot of an author's work on the wire
 * for no reason. Restoring one is F2+, and has no client here to feed.
 */
export async function listCheckpoints(
  projectId: string,
): Promise<CheckpointResult<CheckpointSummary[]>> {
  const supabase = await requireSession();

  const row = await ensureDocumentRow(supabase, projectId);
  if (!row.ok) {
    return checkpointFail(row.code === "rad-nepoznat" ? "rad-nepoznat" : "citanje");
  }

  const { data, error } = await supabase
    .from("pisac_checkpoints")
    .select("id, name, revision, created_at")
    .eq("document_id", row.value.documentId)
    .order("created_at", { ascending: false });

  if (error) {
    return checkpointFail("citanje");
  }

  return { ok: true, value: parseCheckpointList(data) };
}
