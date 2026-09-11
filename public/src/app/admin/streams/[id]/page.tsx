"use client";

/**
 * /admin/streams/:id — one streaming run = one YouTube video, reviewed as an
 * as-run: the player up top, and below it every director cut placed at its
 * offset in the video (▶ seeks the player), with unlogged stretches drawn as
 * explicit gaps. Re-polls while the run is live so the timeline grows with the
 * stream. Data: GET /api/streams/:id/asrun (docs/vod-as-run-plan.md).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { runIsActive } from "@photonsurge/shared/runs";
import { fmtOffset, vodOffsetMs } from "@photonsurge/shared/vod";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import RunStats from "../../../../components/admin/streams/RunStats";
import VodPlayer, { type VodPlayerApi } from "../../../../components/admin/streams/VodPlayer";
import VodTimeline, { type VodChatLine } from "../../../../components/admin/streams/VodTimeline";
import { fmtDuration, kindColor } from "../../../../lib/airlog";
import { fetchChatLog } from "../../../../lib/chat";
import { useYoutubeVideoStats } from "../../../../lib/stream";
import { asRunCoverage, getAsRun, publishChapters, type AsRunBundle, type ChaptersResult } from "../../../../lib/vod";

const POLL_MS = 5_000;

const STATUS_COLOR: Record<string, "default" | "error" | "warning" | "success"> = {
  scheduled: "warning",
  "awaiting-ingest": "warning",
  live: "error",
  ending: "warning",
  ended: "default",
  stopped: "default",
  failed: "error",
};

const fmtTime = (ms?: number | null): string => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function StreamAsRunPage() {
  const { id } = useParams<{ id: string }>();
  const [bundle, setBundle] = useState<AsRunBundle | null>(null);
  const [missing, setMissing] = useState(false);
  const [player, setPlayer] = useState<VodPlayerApi | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<ChaptersResult | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatLines, setChatLines] = useState<VodChatLine[] | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getAsRun(id);
    if (!res) {
      setMissing(true);
      return;
    }
    setBundle(res);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = bundle?.run ?? null;
  const active = run ? runIsActive(run.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [active, reload]);

  const { stats, error: statsError } = useYoutubeVideoStats(!!bundle?.video.id);

  const video = bundle?.video;
  const base = video?.base ?? null;

  // Chat rides the same time base as the cuts: message ts → video offset.
  const baseMs = base?.baseMs ?? null;
  const leadMs = video?.leadMs ?? 0;
  useEffect(() => {
    if (!showChat || !id || baseMs == null) return;
    let cancelled = false;
    fetchChatLog(id)
      .then((msgs) => {
        if (cancelled) return;
        setChatLines(msgs.map((m) => ({ id: m.id, offsetMs: vodOffsetMs(m.ts, baseMs, leadMs), author: m.author, text: m.text })));
      })
      .catch(() => {
        if (!cancelled) setChatLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showChat, id, baseMs, leadMs, bundle?.run.status]);
  const nowOffset = base && active ? vodOffsetMs(Date.now(), base.baseMs, video?.leadMs ?? 0) : undefined;
  const coverage = bundle ? asRunCoverage(bundle.items, nowOffset) : null;
  const title = run ? run.title || bundle?.sceneName || run.sceneId : "Stream";
  const seek = player ? (ms: number) => player.seekTo(Math.floor(ms / 1000)) : undefined;
  const chapters = run?.chapters ?? null;

  const publish = async () => {
    if (!id) return;
    setPublishing(true);
    setPublished(null);
    try {
      setPublished(await publishChapters(id));
      await reload();
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AdminPageShell
      title={title}
      crumbs={[{ href: "/admin/streams", label: "Streams" }, { label: run ? "As-run" : "…" }]}
      maxWidth={860}
      description={
        run && bundle ? (
          <>
            <Chip size="small" color={STATUS_COLOR[run.status] ?? "default"} label={run.status} sx={{ mr: 1 }} />
            scene {bundle.sceneName} · {fmtTime(run.startAt)} → {run.endedAt != null ? fmtTime(run.endedAt) : active ? "now" : "—"}
            {base && (
              <>
                {" · "}
                {coverage?.cuts ?? 0} cuts
                {coverage && coverage.loggedMs + coverage.gapMs > 0 && (
                  <> · {Math.round((coverage.loggedMs / (coverage.loggedMs + coverage.gapMs)) * 100)}% logged</>
                )}
                {" · timed by "}
                {base.source === "youtube" ? "YouTube's clock" : "our go-live stamp"}
                {video?.leadMs ? ` · lead ${video.leadMs} ms` : ""}
              </>
            )}
            {chapters?.publishedAt ? ` · ${chapters.count} chapters on YouTube` : ""}
            {video?.watchUrl && (
              <>
                {" · "}
                <MuiLink href={video.watchUrl} target="_blank">
                  Watch ↗
                </MuiLink>
              </>
            )}
          </>
        ) : missing ? (
          "No such run."
        ) : (
          "Loading…"
        )
      }
      actions={
        <Stack direction="row" spacing={1}>
          {video?.id && (
            <Button
              variant="outlined"
              onClick={publish}
              disabled={publishing || active}
              title={active ? "Chapters are written once the run has ended" : "Write the as-run digest into the video description as chapters"}
            >
              {publishing ? "Publishing…" : chapters?.publishedAt ? "Re-publish chapters" : "Publish chapters"}
            </Button>
          )}
          <Button variant="outlined" onClick={reload}>
            Refresh
          </Button>
        </Stack>
      }
    >
      {published && (
        <Alert severity={published.ok ? "success" : published.skipped ? "info" : "error"} sx={{ mb: 1.75 }} onClose={() => setPublished(null)}>
          {published.ok
            ? `Chapters ${published.changed === false ? "already up to date" : "published"} · ${published.count ?? 0} lines${published.descriptionLength != null ? ` · description ${published.descriptionLength} chars` : ""}`
            : published.skipped ?? published.error ?? "Publish failed"}
        </Alert>
      )}
      {!published && chapters?.error && (
        <Alert severity="warning" sx={{ mb: 1.75 }}>
          Last automatic chapters publish failed: {chapters.error}
        </Alert>
      )}
      {video?.id && (
        <Paper sx={{ mb: 2.25, overflow: "hidden" }}>
          <VodPlayer videoId={video.id} onApi={setPlayer} />
        </Paper>
      )}

      {run && <Box sx={{ mb: 2.25 }}><RunStats run={run} youtubeStats={stats[run.id]} statsError={statsError} /></Box>}

      {bundle && Object.keys(bundle.kindCounts).length > 0 && (
        // Kind colours are lib/airlog's shared categorical scale, matched to the
        // dots on the timeline rail below — data, not a per-page palette.
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mb: 2.25 }}>
          {Object.entries(bundle.kindCounts)
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

      {bundle && bundle.sessions.length > 0 && (
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", mb: 2.25 }}>
          <Typography variant="caption" color="text.secondary">
            Director {bundle.sessions.length === 1 ? "session" : "sessions"}
          </Typography>
          {bundle.sessions.map((sid, i) => (
            <MuiLink key={sid} component={Link} href={`/admin/runs/${encodeURIComponent(sid)}`} variant="caption">
              #{i + 1}
            </MuiLink>
          ))}
          {coverage && coverage.gapMs > 0 && (
            <Typography variant="caption" color="text.disabled">
              · {fmtDuration(coverage.gapMs)} not logged
            </Typography>
          )}
          <FormControlLabel
            sx={{ ml: "auto", mr: 0 }}
            control={<Checkbox size="small" checked={showChat} onChange={(e) => setShowChat(e.target.checked)} />}
            label={<Typography variant="caption">Show chat{showChat && chatLines ? ` (${chatLines.length})` : ""}</Typography>}
          />
        </Stack>
      )}

      {bundle && !bundle.window && (
        <Typography variant="body2" color="text.secondary">
          This run never went live, so there is no video timeline to place cuts on.
        </Typography>
      )}
      {bundle && bundle.window && bundle.items.every((i) => i.type === "gap") && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75 }}>
          No director cuts were logged during this video. The as-run log only records auto-director cuts (recording
          began 2026-07-08); time the operator drove by hand is not in it.
        </Typography>
      )}
      {bundle && bundle.window && (
        <VodTimeline items={bundle.items} watchUrl={video?.watchUrl} onSeek={seek} chat={showChat ? chatLines ?? undefined : undefined} />
      )}
      {bundle && bundle.window && active && base && (
        <Typography variant="caption" color="text.disabled">
          Live — the video is at about {fmtOffset(nowOffset ?? 0)}; the timeline re-polls every {POLL_MS / 1000}s.
        </Typography>
      )}
    </AdminPageShell>
  );
}
