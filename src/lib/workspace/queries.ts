import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ACTION_ERROR_MESSAGES,
  DEFAULT_WORKSPACE_NAME,
  type ActionErrorCode,
  type Project,
  type Workspace,
} from "@/domain/workspace/types";

/**
 * Workspace reads and writes, as plain functions over an already
 * authenticated Supabase client.
 *
 * Deliberately NOT a `"use server"` module: every function here takes the
 * client (and the ids) it works with, so one request can resolve the session
 * once and then read everything it needs. The server actions in
 * `app/workspace/actions.ts` stay the entry point for form submissions and
 * keep authenticating themselves — this module is the shared body they and
 * the page both call, not a second way in.
 *
 * Expected failures are returned as typed error objects with a Croatian
 * message; nothing here throws or redirects.
 */
export type ActionError = {
  ok: false;
  code: ActionErrorCode;
  message: string;
};

export type ActionResult<T> = { ok: true; value: T } | ActionError;

export function fail(code: ActionErrorCode): ActionError {
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

const WORKSPACE_COLUMNS = "id, owner_id, name, created_at";
const PROJECT_COLUMNS = "id, workspace_id, title, created_at, updated_at";

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

/**
 * Get-or-create the user's single personal workspace.
 *
 * F1 allows exactly one workspace per user (unique owner_id), so a lost race
 * on insert is resolved by re-reading the existing row.
 */
export async function ensureWorkspaceFor(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActionResult<Workspace>> {
  const existing = await supabase
    .from("pisac_workspaces")
    .select(WORKSPACE_COLUMNS)
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
    .select(WORKSPACE_COLUMNS)
    .single();

  if (created.error) {
    // Another request won the race: the unique owner_id rejected this insert.
    const retry = await supabase
      .from("pisac_workspaces")
      .select(WORKSPACE_COLUMNS)
      .eq("owner_id", userId)
      .maybeSingle();

    if (retry.error || !retry.data) {
      return fail("spremanje");
    }
    return { ok: true, value: toWorkspace(retry.data as WorkspaceRow) };
  }

  return { ok: true, value: toWorkspace(created.data as WorkspaceRow) };
}

/** Projects of one workspace, newest first. */
export async function listProjectsIn(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ActionResult<Project[]>> {
  const { data, error } = await supabase
    .from("pisac_projects")
    .select(PROJECT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    return fail("citanje");
  }

  return { ok: true, value: ((data ?? []) as ProjectRow[]).map(toProject) };
}

/**
 * Insert one project into a workspace.
 *
 * The title must already be validated: this is the storage half of
 * `createProject`, not its rule.
 */
export async function insertProject(
  supabase: SupabaseClient,
  workspaceId: string,
  title: string,
): Promise<ActionResult<Project>> {
  const { data, error } = await supabase
    .from("pisac_projects")
    .insert({ workspace_id: workspaceId, title })
    .select(PROJECT_COLUMNS)
    .single();

  if (error || !data) {
    return fail("spremanje");
  }

  return { ok: true, value: toProject(data as ProjectRow) };
}

/**
 * The whole workspace page in one pass: the workspace, then its projects.
 *
 * One call so the page does a single `getUser()` and then exactly the two
 * queries it renders — rather than each helper re-authenticating.
 */
export async function loadWorkspaceOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  workspace: ActionResult<Workspace>;
  projects: ActionResult<Project[]>;
}> {
  const workspace = await ensureWorkspaceFor(supabase, userId);
  if (!workspace.ok) {
    // No workspace, no project list: the same failure, reported once.
    return { workspace, projects: workspace };
  }
  return {
    workspace,
    projects: await listProjectsIn(supabase, workspace.value.id),
  };
}
