import Link from "next/link";
import AdminPageShell from "../../components/admin/AdminPageShell";
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
  group: AdminGroup;
}

type AdminGroup = "Broadcast" | "Signals" | "Catalogs" | "Operations";

const GROUPS: AdminGroup[] = ["Broadcast", "Signals", "Catalogs", "Operations"];

export const ADMIN_LINKS: AdminLink[] = [
  { group: "Broadcast", href: "/control", title: "Operator console", desc: "Live broadcast control — variables, basemap, camera.", ready: true },
  { group: "Broadcast", href: "/watch", title: "Watch", desc: "The output view that goes to stream.", ready: true },
  { group: "Broadcast", href: "/admin/scenes", title: "Scenes", desc: "Named /watch/:id globes for OBS sources and overlays.", ready: true },
  { group: "Broadcast", href: "/admin/access", title: "Access", desc: "Tokened OBS/YouTube URLs per scene — copy, rotate.", ready: true },
  { group: "Broadcast", href: "/admin/ads", title: "Ads", desc: "Sponsor images/video shown on the broadcast.", ready: true },
  { group: "Broadcast", href: "/admin/runs", title: "Runs", desc: "As-run log — what the auto-director aired, shot by shot.", ready: true },

  { group: "Signals", href: "/admin/alerts", title: "Weather alerts", desc: "Ingested CAP alerts — filter by severity / active.", ready: true },
  { group: "Signals", href: "/admin/events", title: "Watched events", desc: "Cross-source event dossiers — timeline, sources, resources, snapshots.", ready: true },
  { group: "Signals", href: "/admin/summaries", title: "Round-ups", desc: "Scheduled global weather-event summaries + narrative.", ready: true },
  { group: "Signals", href: "/admin/place-roundups", title: "Place round-ups", desc: "Per-country & per-region 12h AI round-ups, each written with the previous in view.", ready: true },
  { group: "Signals", href: "/admin/tracks", title: "Live tracks", desc: "Satellites (SGP4), aircraft (ADS-B), ships (AIS).", ready: true },

  { group: "Catalogs", href: "/admin/content", title: "Content editor", desc: "Edit on-air text + images for cities, countries, regions, volcanoes, alerts, quakes and seismic stations — with a live on-air preview.", ready: true },
  { group: "Catalogs", href: "/cities", title: "Cities", desc: "City markers, Wikipedia enrichment results and map preview.", ready: true },
  { group: "Catalogs", href: "/admin/vehicles", title: "Vehicles", desc: "Persistent aircraft and ship registry, including enrichment results.", ready: true },
  { group: "Catalogs", href: "/admin/cams", title: "Webcams", desc: "Catalogued live cams — status, location, preview.", ready: true },
  { group: "Catalogs", href: "/admin/volcanoes", title: "Volcanoes", desc: "Active volcanoes — status, reports and Wikipedia enrichment.", ready: true },
  { group: "Catalogs", href: "/admin/sea-points", title: "Sea points", desc: "Ocean-monitoring catalog the Director's ocean kind rotates through.", ready: true },
  { group: "Catalogs", href: "/countries", title: "Countries", desc: "Full country catalog — boundaries, enrichment, area-weather and globe preview.", ready: true },
  { group: "Catalogs", href: "/regions", title: "Regions", desc: "Oceans, continents, EU blocs, UK nations — enrichment, area-weather and globe preview.", ready: true },

  { group: "Operations", href: "/admin/weather", title: "Weather runs", desc: "Baked weather runs per model — which variables baked, forecast hours, texture thumbnails and age.", ready: true },
  { group: "Operations", href: "/admin/jobs", title: "Worker jobs", desc: "Trigger ingest/snapshot jobs; view the queue.", ready: true },
  { group: "Operations", href: "/admin/queue", title: "Queue", desc: "BullMQ dashboard — browse/retry jobs, schedules, pause.", ready: true },
  { group: "Operations", href: "/admin/logs", title: "Back log", desc: "Saved log of worker/job activity.", ready: true },
  { group: "Operations", href: "/admin/users", title: "Users", desc: "Admin accounts for /admin and /control.", ready: true },
  { group: "Operations", href: "/admin/db", title: "Database", desc: "Mongo collection sizes, doc counts, storage summary.", ready: true },
];

export default function AdminPage() {
  return (
    <AdminPageShell title="Admin" description="Lists and consoles for the weather globe." maxWidth={1180}>
      <div style={{ marginBottom: 16 }}>
        <ServiceStatusPanel />
      </div>

      <div style={{ display: "grid", gap: 22, marginTop: 16 }}>
        {GROUPS.map((group) => (
          <section key={group}>
            <h2
              style={{
                margin: "0 0 10px",
                color: "#8b95a7",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {group}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              {ADMIN_LINKS.filter((l) => l.group === group).map((l) => {
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
        ))}
      </div>
    </AdminPageShell>
  );
}
