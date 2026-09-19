import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { validateDocument, type CanonicalDocument } from "@/domain/document";
import {
  SERVER_SYNC_ERROR_MESSAGES,
  parseEnsureOutcome,
  type ServerSyncErrorCode,
} from "@/domain/serverSync/contract";

/**
 * Canonical-document reads, as plain functions over an already authenticated
 * Supabase client.
 *
 * Deliberately NOT a `"use server"` module (see `@/lib/workspace/queries`):
 * the document page resolves the session once and calls this directly, while
 * the server actions in `app/d/[id]/actions.ts` keep authenticating
 * themselves before calling the very same function.
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

export function fail(code: ServerSyncErrorCode): ServerSyncError {
  return { ok: false, code, message: SERVER_SYNC_ERROR_MESSAGES[code] };
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
export async function ensureDocumentRow(
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
