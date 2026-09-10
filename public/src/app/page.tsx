import Link from "next/link";
import ServiceStatusPanel from "../components/ServiceStatusPanel";
import StreamStatusBadge from "../components/StreamStatusBadge";
import ChannelLauncher from "../components/ChannelLauncher";
import InstanceMark from "../components/InstanceMark";
import { instanceVars, resolveInstance } from "../lib/instance";

/**
 * Rendered per request so the instance badge below is the box's OWN identity.
 * Live runs the image miranda tested, so anything baked at build time would say
 * "TEST" on live forever (lib/instance.ts).
 */
export const dynamic = "force-dynamic";

/** Launcher / home (login-gated — see proxy.ts). Leads with the per-channel
 * launcher; the ping demo (PingPanel + /api/ping) stays on disk but is no longer
 * linked from here. */
export default function Home() {
  const instance = resolveInstance();

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        // Washed with this deployment's colour — the launcher is where you pick
        // a box, so it's where mistaking test for live costs the most. The
        // variables are set on this very element (they apply to it too), so a
        // static render can never freeze the build box's identity here.
        background: "var(--inst-page, #0a0e16)",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        padding: 40,
        ...instanceVars(instance),
      } as React.CSSProperties}
    >
      {/* Which box am I on — fixed chrome, costs the layout nothing. */}
      <InstanceMark instance={instance} />
      <h1 style={{ margin: 0, fontSize: 34 }}>Live Weather Globe</h1>
      <p style={{ margin: 0, color: "#8b95a7", fontSize: 15 }}>
        NOAA weather · alerts · live satellites, aircraft & ships
      </p>

      <div style={{ marginTop: 4 }}>
        <StreamStatusBadge />
      </div>

      <div style={{ marginTop: 22, width: "100%", display: "flex", justifyContent: "center" }}>
        <ChannelLauncher />
      </div>

      <nav
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginTop: 26,
          width: "100%",
          maxWidth: 820,
        }}
      >
        <Launch href="/admin/scenes" label="Channels" sub="Create & manage broadcast channels" accent="#2563eb" />
        <Launch href="/admin/streams" label="Streams" sub="Constant streams, encoders & runs" accent="#2563eb" />
        <Launch href="/sandbox" label="Sandbox" sub="Detached globe — off-air, yours to play with" accent="#2563eb" blank />
        <Launch href="/admin" label="Admin" sub="Alerts, tracks, cities & tools" />
        <Launch href="/music" label="Music" sub="Generative broadcast audio bed" accent="#54e6a6" />
      </nav>

      <div style={{ display: "flex", gap: 14, marginTop: 18, fontSize: 13 }}>
        <Quick href="/admin/alerts" label="Weather alerts" />
        <Quick href="/admin/tracks" label="Live tracks" />
        <Quick href="/cities" label="Cities" />
      </div>

      <div style={{ marginTop: 26 }}>
        <ServiceStatusPanel compact />
      </div>
    </main>
  );
}

function Launch({
  href,
  label,
  sub,
  accent,
  blank,
}: {
  href: string;
  label: string;
  sub: string;
  accent?: string;
  /** Open in a new tab/window (used for the live globe surfaces). */
  blank?: boolean;
}) {
  return (
    <Link
      href={href}
      target={blank ? "_blank" : undefined}
      rel={blank ? "noreferrer" : undefined}
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
