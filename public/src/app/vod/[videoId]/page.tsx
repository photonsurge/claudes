"use client";

/**
 * /vod/:videoId — the public "what was that?" page for one YouTube video,
 * linked from the video's description: the player, and every director cut at
 * its offset in the video (▶ seeks the player). Anonymous, secret-free (GET
 * /api/vod/:videoId); no links into the operator surfaces. Re-polls while the
 * stream is still live.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { runIsActive, type RunStatus } from "@photonsurge/shared/runs";
import VodPlayer, { type VodPlayerApi } from "../../../components/admin/streams/VodPlayer";
import VodTimeline from "../../../components/admin/streams/VodTimeline";
import { kindColor } from "../../../lib/airlog";
import { getPublicVod, type PublicVodBundle } from "../../../lib/vod";

const POLL_MS = 10_000;

const fmtDay = (ms?: number | null): string => {
  if (ms == null || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

export default function PublicVodPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const [bundle, setBundle] = useState<PublicVodBundle | null>(null);
  const [missing, setMissing] = useState(false);
  const [player, setPlayer] = useState<VodPlayerApi | null>(null);

  const reload = useCallback(async () => {
    if (!videoId) return;
    const res = await getPublicVod(videoId);
    if (!res) {
      setMissing(true);
      return;
    }
    setBundle(res);
  }, [videoId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const live = bundle ? runIsActive(bundle.status as RunStatus) : false;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [live, reload]);

  const cuts = bundle ? bundle.items.filter((i) => i.type === "cut").length : 0;
  const seek = player ? (ms: number) => player.seekTo(Math.floor(ms / 1000)) : undefined;

  return (
    <Box component="main" sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box component="section" sx={{ maxWidth: 860, mx: "auto", px: 3, pt: 3, pb: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          {bundle ? bundle.title || bundle.sceneName : missing ? "Video not found" : "Loading…"}
        </Typography>
        {bundle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.25 }}>
            {live && <Chip size="small" color="error" label="LIVE" sx={{ mr: 1 }} />}
            {bundle.sceneName}
            {bundle.startAt != null ? ` · ${fmtDay(bundle.startAt)}` : ""}
            {bundle.window ? ` · ${cuts} ${cuts === 1 ? "cut" : "cuts"}` : ""}
            {bundle.video.watchUrl && (
              <>
                {" · "}
                <MuiLink href={bundle.video.watchUrl} target="_blank">
                  Watch on YouTube ↗
                </MuiLink>
              </>
            )}
          </Typography>
        )}
        {missing && (
          <Typography variant="body2" color="text.secondary">
            We don&apos;t have an as-run record for that video.
          </Typography>
        )}

        {bundle && (
          <Paper sx={{ mb: 2.25, overflow: "hidden" }}>
            <VodPlayer videoId={bundle.video.id} onApi={setPlayer} />
          </Paper>
        )}

        {bundle && Object.keys(bundle.kindCounts).length > 0 && (
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

        {bundle && !bundle.window && (
          <Typography variant="body2" color="text.secondary">
            This stream never went live, so there is nothing to place on its timeline.
          </Typography>
        )}
        {bundle && bundle.window && bundle.items.every((i) => i.type === "gap") && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75 }}>
            No cuts were logged for this video.
          </Typography>
        )}
        {bundle && bundle.window && (
          <VodTimeline items={bundle.items} watchUrl={bundle.video.watchUrl} onSeek={seek} subjectLinks={false} />
        )}
        {bundle && (
          <Typography variant="caption" color="text.disabled" component="p" sx={{ mt: 3 }}>
            Offsets are where each cut sits in the archived video; a few seconds of drift is normal.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
