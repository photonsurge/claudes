import Link from "next/link";

/** Minimal launcher. The ping demo (PingPanel + /api/ping) stays on disk but is
 * no longer linked from here. */
export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: "#0a0e16",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 32 }}>Live Weather Globe</h1>
      <nav style={{ display: "flex", gap: 16 }}>
        <Launch href="/watch" label="Watch" sub="Full-screen broadcast globe" />
        <Launch href="/control" label="Control" sub="Operator console" />
        <Launch href="/cities" label="Cities" sub="Manage city markers" />
      </nav>
    </main>
  );
}

function Launch({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "20px 28px",
        borderRadius: 12,
        border: "1px solid #2a3142",
        background: "#121826",
        color: "#fff",
        textDecoration: "none",
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#8b95a7", marginTop: 4 }}>{sub}</div>
    </Link>
  );
}
