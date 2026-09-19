import Link from "next/link";
import { notFound } from "next/navigation";

import { ensureDocumentRow } from "@/lib/document/queries";
import { requireSession } from "@/lib/supabase/session";

import EditorClient from "./editor-client";

// Auth state must never be cached at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Rad — Pisač" };

type ProjectRow = { id: string; title: string };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The one and only session round trip of this request: both queries below
  // take this client, rather than each resolving the session again.
  const { supabase } = await requireSession();

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
    <main className="page page--document">
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
