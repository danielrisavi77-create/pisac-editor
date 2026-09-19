import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { emptyDocument } from "@/domain/document";
import { createClient } from "@/lib/supabase/server";

import { ensureDocument } from "./actions";
import EditorClient from "./editor-client";

// Auth state must never be cached at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Rad — Pisač" };

const page = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "3rem 1rem",
} as const;

type ProjectRow = { id: string; title: string };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  // RLS scopes this to the signed-in owner, so "not yours" and "does not
  // exist" are the same 404 — the page must not leak that the id is real.
  // A malformed id makes Postgres reject the uuid cast, which lands here too.
  const { data, error } = await supabase
    .from("pisac_projects")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const project = data as ProjectRow;

  // Get-or-create the canonical server document, so a first visit already has
  // a row at revision 0 to compare-and-set against (F1-4a).
  const server = await ensureDocument(project.id);

  return (
    <main style={page}>
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link href="/workspace" style={{ color: "var(--muted)" }}>
          ← Radni prostor
        </Link>
      </p>
      <h1 style={{ fontSize: "1.75rem", margin: "0 0 1.5rem" }}>{project.title}</h1>

      {/*
        Three sources, in order of authority for *starting* the editor:
        the local journal snapshot (read in the client, see editor-client),
        then the canonical server document, then an empty document.

        `server` being unreadable is not fatal: the page stays editable and
        simply makes no claim about a server revision. Passing the empty
        document at `serverRevision` 0 instead would invite the author to
        commit over canonical text this request failed to read.
      */}
      <EditorClient
        documentId={project.id}
        projectId={project.id}
        initialDocument={emptyDocument()}
        initialServerDocument={server.ok ? server.value.document : null}
        serverRevision={server.ok ? server.value.revision : null}
      />
    </main>
  );
}
