"use client";

/**
 * /admin/runs/:id — one as-run session reviewed shot by shot: a vertical
 * timeline of every cut the director made (kind, subject, real vs. planned
 * hold, breaking/skip marks, and the sub-view stops inside round-up shots).
 * Re-polls while the session is live so the timeline grows as the show airs.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import RunTimelineEntry from "../../../../components/admin/RunTimelineEntry";
import Link from "next/link";
import MuiLink from "@mui/material/Link";
import {
  fmtDuration,
  getRun,
  kindColor,
  runDurationMs,
  runIsLive,
  type AiredVideo,
  type AirEntry,
  type AirRun,
} from "../../../../lib/airlog";

const POLL_MS = 5_000;

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<AirRun | null>(null);
  const [entries, setEntries] = useState<AirEntry[]>([]);
  const [videos, setVideos] = useState<AiredVideo[]>([]);
  const [sceneName, setSceneName] = useState("");
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getRun(id);
    if (!res) {
      setMissing(true);
      return;
    }
    setRun(res.run);
    setEntries(res.entries);
    setVideos(res.videos ?? []);
    setSceneName(res.sceneName);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const live = run ? runIsLive(run) : false;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [live, reload]);

  return (
    <AdminPageShell
      title={run ? `Run · ${sceneName}` : "Run"}
      crumbs={[{ href: "/admin/runs", label: "Runs" }, { label: run ? fmtTime(run.startedAt) : "…" }]}
      description={
        run ? (
          <>
            {live ? (
              <Box component="span" sx={{ color: "error.main", fontWeight: 700 }}>
                ● LIVE ·{" "}
              </Box>
            ) : null}
            {fmtTime(run.startedAt)} → {run.endedAt ? fmtTime(run.endedAt) : "now"} ·{" "}
            {fmtDuration(runDurationMs(run))} · {run.cuts} cuts
            {run.endReason === "stale" ? " · orphaned (worker restarted mid-session)" : ""}
          </>
        ) : missing ? (
          "No such run."
        ) : (
          "Loading…"
        )
      }
      actions={
        <Button variant="outlined" onClick={reload}>
          Refresh
        </Button>
      }
    >
      {run && (
        // Kind colours are lib/airlog's shared categorical scale, matched to the
        // dots on the timeline rail below — data, not a per-page palette.
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mb: 2.25 }}>
          {Object.entries(run.kindCounts ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) => (
              <Chip
                key={kind}
                label={`${kind} · ${n}`}
                sx={{ height: 22, fontSize: 12, color: kindColor(kind), borderColor: `${kindColor(kind)}55` }}
              />
            ))}
        </Stack>
      )}

      {/* The YouTube video(s) this session went out on — the reverse of /admin/streams/:id. */}
      {videos.length > 0 && (
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", mb: 2.25 }}>
          <Typography variant="caption" color="text.secondary">
            Aired on
          </Typography>
          {videos.map((v) => (
            <Typography key={v.id} variant="caption" component="span">
              <MuiLink component={Link} href={`/admin/streams/${encodeURIComponent(v.id)}`}>
                {v.title || v.id}
              </MuiLink>
              {v.watchUrl && (
                <>
                  {" · "}
                  <MuiLink href={v.watchUrl} target="_blank">
                    Watch ↗
                  </MuiLink>
                </>
              )}
            </Typography>
          ))}
        </Stack>
      )}

      <Box>
        {entries.map((e, i) => (
          <RunTimelineEntry key={e.id} entry={e} isLast={i === entries.length - 1} />
        ))}
        {run && entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No cuts recorded in this run yet.
          </Typography>
        )}
      </Box>
    </AdminPageShell>
  );
}
