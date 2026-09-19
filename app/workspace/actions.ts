"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  ensureWorkspaceFor,
  fail,
  insertProject,
  listProjectsIn,
  type ActionError,
  type ActionResult,
} from "@/lib/workspace/queries";
import {
  type Project,
  type Workspace,
  validateProjectTitle,
} from "@/domain/workspace/types";

/**
 * Server actions for the personal workspace.
 *
 * Each action authenticates itself, because a server action is a POST
 * endpoint that anyone can invoke directly — the page having checked already
 * is not a guard. The queries themselves live in `@/lib/workspace/queries`,
 * so the page can resolve the session ONCE and call them with that client
 * instead of paying a `getUser()` round trip per helper.
 *
 * They never throw for expected failures: callers get a typed error object
 * with a Croatian message. The only control-flow exception is `redirect`,
 * used when there is no session at all (`/prijava`) or no Supabase project
 * configured yet (`/postavljanje`).
 */
export type { ActionError, ActionResult };

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

/** Get-or-create the caller's single personal workspace. */
export async function ensureWorkspace(): Promise<ActionResult<Workspace>> {
  const { supabase, userId } = await requireSession();
  return ensureWorkspaceFor(supabase, userId);
}

/** Projects of the caller's workspace, newest first. */
export async function listProjects(): Promise<ActionResult<Project[]>> {
  const { supabase, userId } = await requireSession();

  const workspace = await ensureWorkspaceFor(supabase, userId);
  if (!workspace.ok) {
    return workspace;
  }

  return listProjectsIn(supabase, workspace.value.id);
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

  const { supabase, userId } = await requireSession();

  const workspace = await ensureWorkspaceFor(supabase, userId);
  if (!workspace.ok) {
    return workspace;
  }

  const created = await insertProject(supabase, workspace.value.id, title.value);
  if (!created.ok) {
    return created;
  }

  revalidatePath("/workspace");
  return created;
}
