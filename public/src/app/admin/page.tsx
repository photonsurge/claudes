import Link from "next/link";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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
  { group: "Broadcast", href: "/admin/scenes", title: "Channels", desc: "Broadcast channels — each a named /watch/:id globe with its own controls & stream.", ready: true },
  { group: "Broadcast", href: "/admin/streams", title: "Live streams", desc: "Constant streams, encoders and one-off YouTube+OBS runs per channel.", ready: true },
  { group: "Broadcast", href: "/admin/shorts", title: "Short videos", desc: "Generate round-up video scripts and preview them on the preview scene.", ready: true },
  { group: "Broadcast", href: "/admin/youtube", title: "YouTube accounts", desc: "Connect streaming channels + check OAuth/OBS wiring.", ready: true },
  { group: "Broadcast", href: "/admin/access", title: "Access", desc: "Tokened OBS/YouTube URLs per channel — copy, rotate.", ready: true },
  { group: "Broadcast", href: "/admin/ads", title: "Ads", desc: "Sponsor images/video shown on the broadcast.", ready: true },
  { group: "Broadcast", href: "/admin/runs", title: "Runs", desc: "As-run log — what the auto-director aired, shot by shot.", ready: true },

  { group: "Signals", href: "/admin/alerts", title: "Weather alerts", desc: "Ingested CAP alerts — filter by severity / active.", ready: true },
  { group: "Signals", href: "/admin/events", title: "Watched events", desc: "Cross-source event dossiers — timeline, sources, resources, snapshots.", ready: true },
  { group: "Signals", href: "/admin/summaries", title: "Round-ups", desc: "Scheduled global weather-event summaries + narrative.", ready: true },
  { group: "Signals", href: "/admin/place-roundups", title: "Place round-ups", desc: "Per-country & per-region 12h AI round-ups, each written with the previous in view.", ready: true },
  { group: "Signals", href: "/admin/presenters", title: "Presenters", desc: "Presenter voices and the voice bench — test any presenter by ear, with the master switch for all speech.", ready: true },
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
  { group: "Operations", href: "/admin/files", title: "Files", desc: "Blob folder disk usage — textures, frames, snapshots and uploads, plus disk free.", ready: true },
  { group: "Operations", href: "/admin/archive", title: "Archive", desc: "One UTC day of the permanent record — the maps as they were, warnings in force, earthquakes and what aired.", ready: true },
];

export default function AdminPage() {
  return (
    <AdminPageShell title="Admin" description="Lists and consoles for the weather globe." maxWidth={1180}>
      <Box sx={{ mb: 3 }}>
        <ServiceStatusPanel />
      </Box>

      <Stack spacing={3}>
        {GROUPS.map((group) => (
          <Box component="section" key={group}>
            <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: "block", mb: 1.25 }}>
              {group}
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                gap: 1.5,
              }}
            >
              {ADMIN_LINKS.filter((l) => l.group === group).map((l) => {
                const card = (
                  <Paper
                    sx={{
                      p: 2,
                      height: "100%",
                      opacity: l.ready ? 1 : 0.55,
                      // The one affordance the flat palette allows: the hairline
                      // picks up the accent on hover so the card reads as a target.
                      transition: "border-color 120ms, background-color 120ms",
                      ...(l.ready && {
                        "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                      }),
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography variant="h3" color="text.primary">
                        {l.title}
                      </Typography>
                      {!l.ready && <Chip label="soon" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {l.desc}
                    </Typography>
                  </Paper>
                );
                // Plain <Link> wrapping the card, rather than MUI's
                // `component={Link}` polymorphism: this page is a server
                // component, and passing Link as a prop would send a function
                // across the server→client boundary. (Same trap as AdminTopBar.)
                return l.ready ? (
                  <Link key={l.href} href={l.href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                    {card}
                  </Link>
                ) : (
                  <div key={l.href}>{card}</div>
                );
              })}
            </Box>
          </Box>
        ))}
      </Stack>
    </AdminPageShell>
  );
}
