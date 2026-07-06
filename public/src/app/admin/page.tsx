import Link from "next/link";
import ServiceStatusPanel from "../../components/ServiceStatusPanel";

/**
 * /admin — hub linking the admin list/console pages. Kept data-light (just
 * navigation) so it renders instantly; each card deep-links to a real list.
 */
interface AdminLink {
  href: string;
  title: string;
  desc: string;
  ready: boolean;
}

const LINKS: AdminLink[] = [
  { href: "/admin/alerts", title: "Weather alerts", desc: "Ingested CAP alerts — filter by severity / active.", ready: true },
  { href: "/admin/summaries", title: "Round-ups", desc: "Scheduled global weather-event summaries + narrative.", ready: true },
  { href: "/cities", title: "Cities", desc: "City markers, Wikipedia enrichment results and map preview.", ready: true },
  { href: "/control", title: "Operator console", desc: "Live broadcast control — variables, basemap, camera.", ready: true },
  { href: "/watch", title: "Watch (broadcast)", desc: "The output view that goes to stream.", ready: true },
  { href: "/admin/scenes", title: "Scenes", desc: "Named /watch/:id globes for OBS sources / overlay windows.", ready: true },
  { href: "/admin/access", title: "Access", desc: "Tokened OBS/YouTube URLs per scene — copy, rotate.", ready: true },
  { href: "/admin/tracks", title: "Live tracks", desc: "Satellites (SGP4), aircraft (ADS-B), ships (AIS).", ready: true },
  { href: "/admin/vehicles", title: "Vehicles in DB", desc: "Persistent aircraft and ship registry, including enrichment results.", ready: true },
  { href: "/admin/cams", title: "Webcams", desc: "Catalogued live cams — status, location, preview.", ready: true },
  { href: "/admin/ads", title: "Ads", desc: "Sponsor images/video shown on the broadcast.", ready: true },
  { href: "/admin/jobs", title: "Worker jobs", desc: "Trigger ingest/snapshot jobs; view the queue.", ready: true },
  { href: "/admin/queue", title: "Queue", desc: "BullMQ dashboard — browse/retry jobs, schedules, pause.", ready: true },
  { href: "/admin/logs", title: "Back log", desc: "Saved log of worker/job activity.", ready: true },
  { href: "/admin/users", title: "Users", desc: "Admin accounts for /admin and /control.", ready: true },
];

export default function AdminPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Admin</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>Lists and consoles for the weather globe.</p>

        <div style={{ marginBottom: 16 }}>
          <ServiceStatusPanel />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          {LINKS.map((l) => {
            const card = (
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: "1px solid #1b2030",
                  background: "#0c111c",
                  height: "100%",
                  opacity: l.ready ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{l.title}</h3>
                  {!l.ready && (
                    <span style={{ fontSize: 11, color: "#8b95a7", border: "1px solid #2a3344", borderRadius: 4, padding: "1px 5px" }}>
                      soon
                    </span>
                  )}
                </div>
                <div style={{ color: "#8b95a7", fontSize: 13, marginTop: 6 }}>{l.desc}</div>
              </div>
            );
            return l.ready ? (
              <Link key={l.href} href={l.href} style={{ textDecoration: "none", color: "inherit" }}>
                {card}
              </Link>
            ) : (
              <div key={l.href}>{card}</div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
