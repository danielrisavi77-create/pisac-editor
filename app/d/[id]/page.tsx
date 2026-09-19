import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ensureDocumentRow } from "@/lib/document/queries";
import { createClient } from "@/lib/supabase/server";

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

  // The one and only session round trip of this request: both queries below
  // take this client, rather than each resolving the session again.
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
  const server = await ensureDocumentRow(supabase, project.id);

  return (
    <main style={page}>
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link href="/workspace" style={{ color: "var(--muted)" }}>
          ← Radni prostor
        </Link>
      </p>
      <h1 style={{ fontSize: "1.75rem", margin: "0 0 1.5rem" }}>{project.title}</h1>

      {/*
        Two sources for *starting* the editor: the local journal snapshot
        (read in the client, see editor-client) and the canonical server
        document. There is deliberately no third, empty one — when `server`
        could not be read and the journal is empty, the client says so
        instead of opening blank content that the author would then commit
        over canonical text this request simply failed to fetch.

        The journal is client-side, so which of the two wins can only be
        decided there; the page's job is to pass the server side honestly,
        `null` and all.
      */}
      <EditorClient
        documentId={project.id}
        projectId={project.id}
        projectTitle={project.title}
        initialServerDocument={server.ok ? server.value.document : null}
        serverRevision={server.ok ? server.value.revision : null}
      />
    </main>
  );
}
