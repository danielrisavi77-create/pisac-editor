import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { emptyDocument } from "@/domain/document";
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

  return (
    <main style={page}>
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link href="/workspace" style={{ color: "var(--muted)" }}>
          ← Radni prostor
        </Link>
      </p>
      <h1 style={{ fontSize: "1.75rem", margin: "0 0 1.5rem" }}>{project.title}</h1>

      {/*
        F1-2b has no persistence yet: every visit starts from the canonical
        empty document. F1-3a loads the journalled snapshot here instead.
      */}
      <EditorClient initialDocument={emptyDocument()} />
    </main>
  );
}
