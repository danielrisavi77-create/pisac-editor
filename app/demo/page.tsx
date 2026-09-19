import Link from "next/link";

import DemoClient from "./demo-client";

/**
 * `/demo` — the F1 editor with no account and no server.
 *
 * There is no auth guard here, and there is nothing to guard: the route reads
 * no session, touches no Supabase client and renders nothing that belongs to
 * anyone. It is deliberately left out of the middleware matcher
 * (`/workspace`, `/d`, `/prijava`), which is why this file does not have to
 * opt out of anything.
 *
 * The banner is the whole contract with the visitor: their text lives in this
 * browser and nowhere else. Saying it above the editor — before they type —
 * is the only place where it is still a choice rather than a surprise.
 */

export const metadata = { title: "Demo — Pisač" };

const banner = {
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "0.75rem 1rem",
  margin: "0 0 1.25rem",
} as const;

export default function DemoPage() {
  return (
    <main className="page page--document">
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link href="/" style={{ color: "var(--muted)" }}>
          ← Pisač
        </Link>
      </p>
      <h1 style={{ fontSize: "1.75rem", margin: "0 0 1rem" }}>Demo</h1>

      <div style={banner} data-demo-banner="">
        <p style={{ margin: 0 }}>
          Demo bez prijave. Sadržaj se sprema samo u ovaj preglednik.
        </p>
        <p className="hint" style={{ margin: "0.5rem 0 0" }}>
          <Link href="/prijava">Prijava</Link>
        </p>
      </div>

      <DemoClient />
    </main>
  );
}
