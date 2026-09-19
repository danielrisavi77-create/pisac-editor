import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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

async function signOut() {
  "use server";

  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/prijava");
}

export default async function WorkspacePage() {
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

  return (
    <main style={page}>
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>Radni prostor</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
        Prijavljen/a kao <strong style={{ color: "var(--fg)" }}>{user.email}</strong>
      </p>
      <form action={signOut}>
        <button type="submit" style={button}>
          Odjava
        </button>
      </form>
    </main>
  );
}
