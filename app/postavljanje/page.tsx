import Link from "next/link";

export const metadata = { title: "Postavljanje — Pisač" };

const code = {
  display: "block",
  padding: "0.4rem 0.6rem",
  margin: "0.25rem 0 1rem",
  border: "1px solid var(--muted)",
  borderRadius: "0.375rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  // The names are long and unbreakable; at 360px they wrap rather than widen
  // the page.
  overflowWrap: "anywhere",
} as const;

export default function PostavljanjePage() {
  return (
    <main className="page">
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>Postavljanje</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
        Supabase još nije konfiguriran. Prijava radi tek kad su postavljene ove
        dvije varijable okoline:
      </p>

      <code style={code}>NEXT_PUBLIC_SUPABASE_URL</code>
      <code style={code}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>

      <p style={{ color: "var(--muted)" }}>
        Vrijednosti se nikad ne zapisuju u repozitorij. Predložak je u
        datoteci <code>.env.example</code>.
      </p>

      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Natrag na početnu</Link>
      </p>
    </main>
  );
}
