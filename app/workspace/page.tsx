import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ACTION_ERROR_MESSAGES, parseActionErrorCode } from "@/domain/workspace/types";

import { createProject, ensureWorkspace, listProjects } from "./actions";

// Auth state must never be cached at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Radni prostor — Pisač" };

const page = {
  maxWidth: "36rem",
  margin: "0 auto",
  padding: "4rem 1rem",
} as const;

const button = {
  padding: "0.6rem 1.1rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--fg)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
} as const;

const primaryButton = {
  ...button,
  background: "var(--fg)",
  color: "var(--bg)",
} as const;

const field = {
  display: "block",
  width: "100%",
  padding: "0.6rem 0.75rem",
  margin: "0.5rem 0 1rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--muted)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
} as const;

const notice = {
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "1rem",
  margin: "0 0 1.5rem",
} as const;

const listItem = {
  listStyle: "none",
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "0.75rem 1rem",
  margin: "0 0 0.75rem",
} as const;

const dateFormatter = new Intl.DateTimeFormat("hr-HR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : dateFormatter.format(parsed);
}

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
  redirect(result.ok ? "/workspace" : `/workspace?greska=${result.code}`);
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ greska?: string | string[] }>;
}) {
  const params = await searchParams;
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

  const workspace = await ensureWorkspace();
  const projects = await listProjects();
  const errorCode = parseActionErrorCode(params.greska);
  const loadError = !workspace.ok ? workspace : !projects.ok ? projects : null;

  return (
    <main style={page}>
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>
        {workspace.ok ? workspace.value.name : "Radni prostor"}
      </h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
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

      <h2 style={{ fontSize: "1.25rem", margin: "0 0 1rem" }}>Radovi</h2>

      {projects.ok && projects.value.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>Još nemaš nijedan rad.</p>
      ) : null}

      {projects.ok && projects.value.length > 0 ? (
        <ul style={{ padding: 0, margin: "0 0 2rem" }}>
          {projects.value.map((project) => (
            <li key={project.id} style={listItem}>
              <Link href={`/d/${project.id}`} style={{ display: "block" }}>
                {project.title}
              </Link>
              <small style={{ color: "var(--muted)" }}>
                Stvoreno {formatDate(project.createdAt)}
              </small>
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
          style={field}
        />
        <button type="submit" style={primaryButton}>
          Novi rad
        </button>
      </form>

      <form action={signOut}>
        <button type="submit" style={button}>
          Odjava
        </button>
      </form>
    </main>
  );
}
