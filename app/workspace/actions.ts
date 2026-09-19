"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/supabase/session";
import {
  countProjectsIn,
  ensureWorkspaceFor,
  fail,
  insertProject,
  type ActionResult,
} from "@/lib/workspace/queries";
import {
  exceedsProjectLimit,
  type Project,
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
 * raised inside `requireSession` when there is no session at all
 * (`/prijava`) or no Supabase project configured yet (`/postavljanje`).
 */

/**
 * Create one project from the workspace form.
 *
 * Session first (F1-10): the form parsing and the title rules below are work
 * this process should only do for a caller it has already identified.
 */
export async function createProject(formData: FormData): Promise<ActionResult<Project>> {
  const { supabase, user } = await requireSession();

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

  const workspace = await ensureWorkspaceFor(supabase, user.id);
  if (!workspace.ok) {
    return workspace;
  }

  // Server-side cap (F1-10). The form cannot enforce it — the action is the
  // endpoint, and a count that could not be read refuses rather than guesses.
  const count = await countProjectsIn(supabase, workspace.value.id);
  if (!count.ok) {
    return count;
  }
  if (exceedsProjectLimit(count.value)) {
    return fail("previse-radova");
  }

  const created = await insertProject(supabase, workspace.value.id, title.value);
  if (!created.ok) {
    return created;
  }

  revalidatePath("/workspace");
  return created;
}
