import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>Pisač</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
        F1 Authoring Kernel — u izradi
      </p>
      {/*
        The demo comes first and looks like the primary action: it is the only
        entry point that works without an account, so it is what a visitor who
        has never seen Pisač should reach for.
      */}
      <p style={{ margin: "0 0 1.5rem" }}>
        <Link className="btn btn-primary" href="/demo">
          Isprobaj editor (demo)
        </Link>
      </p>
      <p style={{ margin: "0 0 0.75rem" }}>
        <Link href="/prijava">Prijava</Link>
      </p>
      <a href="/legacy/">Otvori prototip</a>
    </main>
  );
}
