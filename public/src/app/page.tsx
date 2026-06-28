import Link from "next/link";

/** Launcher / home. The ping demo (PingPanel + /api/ping) stays on disk but is
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
        gap: 10,
        background: "#0a0e16",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 34 }}>Live Weather Globe</h1>
      <p style={{ margin: 0, color: "#8b95a7", fontSize: 15 }}>
        NOAA weather · alerts · live satellites, aircraft & ships
      </p>

      <nav
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginTop: 22,
          width: "100%",
          maxWidth: 820,
        }}
      >
        <Launch href="/watch" label="Watch" sub="Full-screen broadcast globe" accent="#2563eb" />
        <Launch href="/control" label="Control" sub="Operator console" accent="#2563eb" />
        <Launch href="/admin" label="Admin" sub="Alerts, tracks, cities & tools" />
      </nav>

      <div style={{ display: "flex", gap: 14, marginTop: 18, fontSize: 13 }}>
        <Quick href="/admin/alerts" label="Weather alerts" />
        <Quick href="/admin/tracks" label="Live tracks" />
        <Quick href="/cities" label="Cities" />
      </div>
    </main>
  );
}

function Launch({
  href,
  label,
  sub,
  accent,
}: {
  href: string;
  label: string;
  sub: string;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "20px 24px",
        borderRadius: 12,
        border: `1px solid ${accent ?? "#2a3142"}`,
        background: "#121826",
        color: "#fff",
        textDecoration: "none",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#8b95a7", marginTop: 4 }}>{sub}</div>
    </Link>
  );
}

function Quick({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ color: "#8b95a7", textDecoration: "none" }}>
      {label}
    </Link>
  );
}
