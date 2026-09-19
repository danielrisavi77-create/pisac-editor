"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  ACTION_ERROR_MESSAGES,
  DEFAULT_WORKSPACE_NAME,
  type ActionErrorCode,
  type Project,
  type Workspace,
  validateProjectTitle,
} from "@/domain/workspace/types";

/**
 * Server actions for the personal workspace.
 *
 * They never throw for expected failures: callers get a typed error object
 * with a Croatian message. The only control-flow exception is `redirect`,
 * used when there is no session at all (`/prijava`) or no Supabase project
 * configured yet (`/postavljanje`).
 */
export type ActionError = {
  ok: false;
  code: ActionErrorCode;
  message: string;
};

export type ActionResult<T> = { ok: true; value: T } | ActionError;

function fail(code: ActionErrorCode): ActionError {
  return { ok: false, code, message: ACTION_ERROR_MESSAGES[code] };
}

type WorkspaceRow = { id: string; owner_id: string; name: string; created_at: string };
type ProjectRow = {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Authenticated Supabase client plus the current user id. Redirects otherwise. */
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

  return { supabase, userId: user.id };
}

/**
 * Get-or-create the user's single personal workspace.
 *
 * F1 allows exactly one workspace per user (unique owner_id), so a lost race
 * on insert is resolved by re-reading the existing row.
 */
export async function ensureWorkspace(): Promise<ActionResult<Workspace>> {
  const { supabase, userId } = await requireSession();

  const existing = await supabase
    .from("pisac_workspaces")
    .select("id, owner_id, name, created_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (existing.error) {
    return fail("citanje");
  }
  if (existing.data) {
    return { ok: true, value: toWorkspace(existing.data as WorkspaceRow) };
  }

  const created = await supabase
    .from("pisac_workspaces")
    .insert({ owner_id: userId, name: DEFAULT_WORKSPACE_NAME })
    .select("id, owner_id, name, created_at")
    .single();

  if (created.error) {
    // Another request won the race: the unique owner_id rejected this insert.
    const retry = await supabase
      .from("pisac_workspaces")
      .select("id, owner_id, name, created_at")
      .eq("owner_id", userId)
      .maybeSingle();

    if (retry.error || !retry.data) {
      return fail("spremanje");
    }
    return { ok: true, value: toWorkspace(retry.data as WorkspaceRow) };
  }

  return { ok: true, value: toWorkspace(created.data as WorkspaceRow) };
}

/** Projects of the user's workspace, newest first. */
export async function listProjects(): Promise<ActionResult<Project[]>> {
  const workspace = await ensureWorkspace();
  if (!workspace.ok) {
    return workspace;
  }

  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("pisac_projects")
    .select("id, workspace_id, title, created_at, updated_at")
    .eq("workspace_id", workspace.value.id)
    .order("created_at", { ascending: false });

  if (error) {
    return fail("citanje");
  }

  return { ok: true, value: ((data ?? []) as ProjectRow[]).map(toProject) };
}

/** Create one project from the workspace form. */
export async function createProject(formData: FormData): Promise<ActionResult<Project>> {
  // `FormData.get` yields a File for a file input, so a forged multipart body
  // must never be coerced to a string like "[object File]".
  const raw = formData.get("naziv");
  if (typeof raw !== "string") {
    return fail("naziv-neispravan");
  }

  const title = validateProjectTitle(raw);
  if (!title.ok) {
    return fail(title.reason === "empty" ? "naziv-prazan" : "naziv-dug");
  }

  const workspace = await ensureWorkspace();
  if (!workspace.ok) {
    return workspace;
  }

  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("pisac_projects")
    .insert({ workspace_id: workspace.value.id, title: title.value })
    .select("id, workspace_id, title, created_at, updated_at")
    .single();

  if (error || !data) {
    return fail("spremanje");
  }

  revalidatePath("/workspace");
  return { ok: true, value: toProject(data as ProjectRow) };
}
