import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { formatDateHr, projectsHr } from "@/lib/i18n/hr";
import { loadWorkspaceOverview } from "@/lib/workspace/queries";
import {
  ACTION_ERROR_MESSAGES,
  parseActionErrorCode,
  sanitizeProjectTitleParam,
} from "@/domain/workspace/types";

import { createProject } from "./actions";

// Auth state must never be cached at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Radni prostor — Pisač" };

const notice = {
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "1rem",
  margin: "0 0 1.5rem",
} as const;

const listItem = {
  listStyle: "none",
  margin: "0 0 0.75rem",
} as const;

async function signOut() {
  "use server";

  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/prijava");
}

async function submitProject(formData: FormData) {
  "use server";

  const result = await createProject(formData);
  if (result.ok) {
    redirect("/workspace");
  }

  // A failed attempt must not cost the author their title: it travels back on
  // the redirect so the form can be re-rendered with what they typed.
  const params = new URLSearchParams({ greska: result.code });
  const submitted = formData.get("naziv");
  const kept = sanitizeProjectTitleParam(
    typeof submitted === "string" ? submitted : undefined,
  );
  if (kept !== "") {
    params.set("naziv", kept);
  }

  redirect(`/workspace?${params.toString()}`);
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ greska?: string | string[]; naziv?: string | string[] }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  if (!supabase) {
    redirect("/postavljanje");
  }

  // The one and only session round trip of this request: the queries below
  // take this client and this user id rather than resolving them again.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/prijava");
  }

  const { workspace, projects } = await loadWorkspaceOverview(supabase, user.id);
  const errorCode = parseActionErrorCode(params.greska);
  const submittedTitle = sanitizeProjectTitleParam(params.naziv);
  const loadError = !workspace.ok ? workspace : !projects.ok ? projects : null;

  return (
    <main className="page">
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>
        {workspace.ok ? workspace.value.name : "Radni prostor"}
      </h1>
      <p
        style={{
          color: "var(--muted)",
          margin: "0 0 2rem",
          overflowWrap: "anywhere",
        }}
      >
        Prijavljen/a kao <strong style={{ color: "var(--fg)" }}>{user.email}</strong>
      </p>

      {errorCode ? (
        <div style={notice}>
          <p style={{ margin: 0 }}>{ACTION_ERROR_MESSAGES[errorCode]}</p>
        </div>
      ) : null}

      {loadError ? (
        <div style={notice}>
          <p style={{ margin: 0 }}>{loadError.message}</p>
        </div>
      ) : null}

      <h2 style={{ fontSize: "1.25rem", margin: "0 0 1rem" }}>
        Radovi
        {projects.ok && projects.value.length > 0 ? (
          <span
            style={{
              color: "var(--muted)",
              fontSize: "0.9rem",
              fontWeight: 400,
              marginLeft: "0.5rem",
            }}
          >
            ({projectsHr(projects.value.length)})
          </span>
        ) : null}
      </h2>

      {projects.ok && projects.value.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: "0 0 1.5rem" }}>
          Još nemaš nijedan rad.
        </p>
      ) : null}

      {projects.ok && projects.value.length > 0 ? (
        <ul style={{ padding: 0, margin: "0 0 2rem" }}>
          {projects.value.map((project) => (
            <li key={project.id} style={listItem}>
              <Link
                href={`/d/${project.id}`}
                className="card"
                style={{ display: "block" }}
              >
                <span className="project-title">{project.title}</span>
                <small className="project-meta" style={{ display: "block", color: "var(--muted)" }}>
                  Stvoreno {formatDateHr(project.createdAt)}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={submitProject} style={{ margin: "0 0 2rem" }}>
        <label htmlFor="naziv">Naziv rada</label>
        <input
          id="naziv"
          name="naziv"
          type="text"
          maxLength={200}
          required
          // Plain text, escaped by React on render; the value was already
          // capped and stripped of control characters above.
          defaultValue={submittedTitle}
          className="input"
          style={{ margin: "0.5rem 0 0.5rem" }}
        />
        {/*
          The empty state says there is nothing yet; this says what to do about
          it, next to the field that does it. One short sentence, and only
          while there is in fact nothing.
        */}
        {projects.ok && projects.value.length === 0 ? (
          <p className="hint" style={{ margin: "0 0 0.75rem" }}>
            Upiši naziv i stvori prvi rad.
          </p>
        ) : (
          <div style={{ height: "0.75rem" }} />
        )}
        <button type="submit" className="btn btn-primary">
          Novi rad
        </button>
      </form>

      <form action={signOut}>
        <button type="submit" className="btn">
          Odjava
        </button>
      </form>
    </main>
  );
}
