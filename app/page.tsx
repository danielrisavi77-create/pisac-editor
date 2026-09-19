export default function Home() {
  return (
    <main
      style={{
        maxWidth: "36rem",
        margin: "0 auto",
        padding: "4rem 1rem",
      }}
    >
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>Pisač</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
        F1 Authoring Kernel — u izradi
      </p>
      <a href="/legacy/">Otvori prototip</a>
    </main>
  );
}
