"use client";

/**
 * /admin/events/:id — one WatchedEvent's full dossier: the derived cross-source
 * timeline, contributing sources + revision history, external links (with match
 * method/score), harvested resources (attribution/licence + rebroadcast flag),
 * metric series (sparklines) and captured snapshots. The verification surface for
 * the whole acquisition pipeline.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import Sparkline from "../../../../components/Sparkline";
import { getEventDetail, eventStatusColor, type EventDetail } from "../../../../lib/events";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const beatGlyph = (type: string): string => {
  switch (type) {
    case "ISSUED":
      return "🟢";
    case "SOURCE_LINKED":
      return "🔗";
    case "SEVERITY_CHANGED":
      return "⚠️";
    case "AREA_CHANGED":
      return "📐";
    case "IMPACT_UPDATE":
      return "📊";
    case "PRODUCT_ADDED":
    case "MAP_ADDED":
    case "IMAGE_ADDED":
      return "🗺️";
    case "REPORT_ADDED":
      return "📰";
    case "GEOMETRY_REFINED":
      return "✏️";
    case "SNAPSHOT_CAPTURED":
      return "🛰️";
    case "CANCELLED":
      return "🚫";
    case "ENDED":
    case "CLOSED":
      return "⚫";
    default:
      return "🔄";
  }
};

/** Section card — the dossier is a stack of these, one per acquisition surface. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="h3" component="h3" sx={{ mb: 1.25 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<EventDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getEventDetail(id);
    if (!res) setMissing(true);
    else setD(res);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (missing) {
    return (
      <AdminPageShell title="Event" crumbs={[{ href: "/admin/events", label: "Watched Events" }, { label: "—" }]}>
        <Typography variant="body2" color="error.main">
          No such event.
        </Typography>
      </AdminPageShell>
    );
  }
  if (!d) {
    return (
      <AdminPageShell title="Event" crumbs={[{ href: "/admin/events", label: "Watched Events" }, { label: "…" }]}>
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </AdminPageShell>
    );
  }

  const e = d.event;
  return (
    <AdminPageShell
      title={e.title || e.primarySourceId}
      description={
        <Box component="span">
          <Box component="span" sx={{ color: eventStatusColor(e.status), fontWeight: 600 }}>
            {e.status}
          </Box>{" "}
          · {e.type} · <code>{e.primarySource}:{e.primarySourceId}</code>
        </Box>
      }
      crumbs={[{ href: "/admin/events", label: "Watched Events" }, { label: e.title || e.primarySourceId }]}
    >
      {/* Timeline */}
      <Card title={`Timeline (${d.timeline.length})`}>
        {d.timeline.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No beats yet.
          </Typography>
        ) : (
          <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {d.timeline.map((b, i) => (
              <Stack
                key={i}
                component="li"
                direction="row"
                spacing={1.25}
                sx={{ py: 0.625, borderBottom: 1, borderColor: "divider" }}
              >
                <Box component="span" sx={{ width: 22 }}>
                  {beatGlyph(b.type)}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ width: 130 }}>
                  <code>{fmtTime(b.at)}</code>
                </Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {b.label}
                </Typography>
                {b.source ? (
                  <Typography variant="caption" color="text.secondary">
                    {b.source}
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Box>
        )}
      </Card>

      {/* Snapshots */}
      {d.snapshots.length > 0 && (
        <Card title={`Snapshots (${d.snapshots.length})`}>
          <Stack direction="row" spacing={1.25} sx={{ flexWrap: "wrap", gap: 1.25 }}>
            {d.snapshots.map((s) => (
              <Link
                key={s.id}
                href={`/api/events/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`}
                target="_blank"
                rel="noreferrer"
                underline="none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Box
                  component="img"
                  src={`/api/events/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`}
                  alt={s.kind}
                  sx={{ width: 200, height: "auto", borderRadius: 1, border: 1, borderColor: "divider", display: "block" }}
                />
                <Typography variant="caption" color="text.secondary">
                  {s.kind}
                  {s.layer ? ` · ${s.layer}` : ""} · <code>{fmtTime(s.capturedAt)}</code>
                </Typography>
              </Link>
            ))}
          </Stack>
        </Card>
      )}

      {/* Series */}
      {d.series.length > 0 && (
        <Card title="Metric series">
          {d.series.map((s) => (
            <Stack key={s.key} direction="row" spacing={1.5} sx={{ alignItems: "center", py: 0.5 }}>
              <Typography variant="body2" sx={{ width: 160 }}>
                {s.source}:{s.metric}
              </Typography>
              <Sparkline samples={s.samples} />
              <Typography variant="caption" color="text.secondary">
                latest <code>{s.latest}</code>
              </Typography>
            </Stack>
          ))}
        </Card>
      )}

      {/* Resources */}
      {d.resources.length > 0 && (
        <Card title={`Resources (${d.resources.length})`}>
          <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
            {d.resources.map((r) => (
              <Box component="li" key={r.id} sx={{ py: 0.375 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>
                  [{r.kind}]
                </Typography>
                <Link href={r.url} target="_blank" rel="noreferrer" variant="body2" sx={{ wordBreak: "break-all" }}>
                  {r.title || r.url}
                </Link>
                {r.attribution ? (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    — {r.attribution}
                  </Typography>
                ) : null}
                {/* Licence-critical: a ref-only resource must never be rebroadcast. */}
                {!r.rebroadcastSafe ? (
                  <Typography component="span" variant="caption" sx={{ color: "warning.main", ml: 0.75 }}>
                    ref-only
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Box>
        </Card>
      )}

      {/* Sources + links */}
      <Card title={`Sources (${d.sources.length})`}>
        {d.sources.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No contributing sources acquired yet.
          </Typography>
        ) : (
          d.sources.map((s) => (
            <Typography key={s.id} variant="body2" component="div" sx={{ py: 0.5, borderBottom: 1, borderColor: "divider" }}>
              <strong>{s.source}</strong>{" "}
              <Typography component="span" variant="caption" color="text.secondary">
                #<code>{s.sourceEventId}</code>
              </Typography>{" "}
              · changed <code>{fmtTime(s.lastChangedAt)}</code>{" "}
              <Typography component="span" variant="caption" color="text.secondary">
                hash <code>{s.currentPayloadHash?.slice(0, 10)}</code>
              </Typography>
            </Typography>
          ))
        )}
        {d.links.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {d.links.map((l) => (
              <Typography key={l.id} variant="caption" color="text.secondary" sx={{ display: "block", py: 0.25 }}>
                🔗 {l.source}:<code>{l.externalId}</code> · {l.matchMethod}
                {l.matchScore != null ? ` (${l.matchScore})` : ""}
              </Typography>
            ))}
          </Box>
        )}
      </Card>

      {/* Schedule */}
      {d.schedules.length > 0 && (
        <Card title="Acquisition schedule">
          {d.schedules.map((s) => (
            <Typography key={s.id} variant="caption" color="text.secondary" sx={{ display: "block", py: 0.25 }}>
              {s.source} · every <code>{s.intervalSeconds}</code>s · next <code>{fmtTime(String(s.nextCheckAt))}</code> ·
              failures <code>{s.failureCount}</code>
            </Typography>
          ))}
        </Card>
      )}
    </AdminPageShell>
  );
}
