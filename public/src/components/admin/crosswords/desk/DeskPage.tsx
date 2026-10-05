"use client";

/**
 * /admin/crosswords/desk/:scene — live operation of one crossword channel, the
 * counterpart of /control (docs/crossword-mode-plan.md §8.3): the board in
 * small, the clue in the spotlight with its countdown, this puzzle's scores and
 * the solve feed; the game controls; and the simulator. When the channel idles or
 * replays, a line says why (§7.5: the runner's reason, from the desk route). Go
 * live links to the Streams page until the Go live dialog lands (WP12); End stops
 * the channel's live run through the Streams API.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { sceneSurface, outputPath, type SceneMeta } from "@photonsurge/shared/control";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";
import AdminPageShell from "../../AdminPageShell";
import MiniGrid from "../puzzles/MiniGrid";
import { listScenes } from "../../../../lib/scenes";
import { call } from "../puzzles/api";
import { deskReason, deskUrl, type DeskInfo } from "./deskReason";
import { font } from "../../../../theme/tokens";
import DeskControls from "./DeskControls";
import EndButton from "./EndButton";
import SimForm from "./SimForm";
import GoLiveDialog from "../../streams/GoLiveDialog";
import { useDeskState } from "./useDeskState";

const PHASE_LABEL: Record<CrosswordPublicState["phase"], string> = {
  idle: "Idle",
  intro: "Intro card",
  playing: "Playing",
  finale: "Finale",
};

const secondsLeft = (endsAt: number, skew: number) => Math.max(0, Math.round((endsAt - (Date.now() + skew)) / 1000));

export default function DeskPage({ sceneId }: { sceneId: string }) {
  const { state, error, skew, refresh } = useDeskState(sceneId);
  const [scene, setScene] = useState<SceneMeta | null>(null);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let live = true;
    listScenes().then((all) => {
      if (live) setScene(all.find((s) => s.id === sceneId) ?? null);
    });
    return () => {
      live = false;
    };
  }, [sceneId]);

  // The reason changes with the puzzle on air, so it is re-read on each phase and puzzle.
  const [info, setInfo] = useState<DeskInfo | null>(null);
  const phase = state?.phase;
  useEffect(() => {
    if (!phase) return;
    let live = true;
    call<DeskInfo>(deskUrl(sceneId)).then((res) => {
      if (live && res.ok) setInfo(res.data);
    });
    return () => {
      live = false;
    };
  }, [sceneId, phase, state?.puzzleNo]);
  const reason = state ? deskReason(state.phase, info) : null;

  const name = scene?.name ?? sceneId;
  const notCrossword = scene && sceneSurface(scene) !== "crossword";
  const watchHref = scene
    ? `${outputPath(scene)}${scene.watchToken ? `?token=${encodeURIComponent(scene.watchToken)}` : ""}`
    : null;
  const spot = state?.spotlight ? state.entries.find((e) => e.id === state.spotlight!.entryId) : undefined;
  const solved = state?.entries.filter((e) => e.solved).length ?? 0;

  return (
    <AdminPageShell
      title={`Desk: ${name}`}
      maxWidth={1500}
      crumbs={[{ href: "/admin/crosswords", label: "Crosswords" }, { label: "Desk" }, { label: name }]}
      actions={
        <Stack direction="row" spacing={1}>
          {watchHref && (
            <Button variant="outlined" href={watchHref} target="_blank" rel="noopener">
              Output
            </Button>
          )}
          <Button variant="outlined" component={Link} href={`/admin/crosswords/channels/${encodeURIComponent(sceneId)}`}>
            Settings
          </Button>
          <Button variant="contained" color="error" onClick={() => setGoLiveOpen(true)} disabled={!scene}>
            Go live
          </Button>
          <EndButton sceneId={sceneId} />
        </Stack>
      }
    >
      {scene && goLiveOpen && (
        <GoLiveDialog open scene={scene} onClose={() => setGoLiveOpen(false)} onStarted={() => setStarted(true)} />
      )}
      <Stack spacing={1.75}>
        {started && (
          <Alert severity="success" onClose={() => setStarted(false)}>
            {name} is going live. Follow it on{" "}
            <Link href="/admin/streams">Streams</Link>.
          </Alert>
        )}
        {notCrossword && <Alert severity="warning">This channel is a weather channel; its controls are on /control.</Alert>}
        {reason && <Alert severity="info">{reason}</Alert>}
        {error && <Alert severity="error">Couldn&apos;t load the game: {error}</Alert>}

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          {state && <Chip size="small" label={PHASE_LABEL[state.phase]} color={state.phase === "playing" ? "success" : "default"} />}
          {state?.paused && <Chip size="small" label="Paused" color="warning" />}
          {state && (
            <Chip
              size="small"
              variant="outlined"
              label={state.inputLive ? "Live chat attached" : "No live chat (demo round)"}
              color={state.inputLive ? "info" : "default"}
            />
          )}
          {state && state.phase !== "idle" && (
            <Typography variant="body2" color="text.secondary">
              Puzzle {state.puzzleNo} · {state.title} · {solved} of {state.entries.length} solved
            </Typography>
          )}
        </Stack>

        <DeskControls sceneId={sceneId} state={state} onSent={() => setTimeout(refresh, 600)} />

        {!state ? (
          <Typography color="text.secondary">{error ? "" : "Loading…"}</Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "auto 1fr" }, gap: 1.75, alignItems: "start" }}>
            <Paper sx={{ p: 1.75, overflowX: "auto" }}>
              {state.width > 0 && state.height > 0 ? (
                <MiniGrid width={state.width} height={state.height} rows={state.rows} entries={state.entries} highlight={state.spotlight?.entryId} />
              ) : (
                <Typography color="text.secondary">No board.</Typography>
              )}
            </Paper>

            <Stack spacing={1.75}>
              <Paper sx={{ p: 1.75 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                  Now solving
                </Typography>
                {spot && state.spotlight ? (
                  <>
                    <Typography sx={{ fontWeight: 700 }}>
                      {spot.num} {spot.dir.toUpperCase()} · {spot.length} letters
                      <Box component="span" sx={{ ml: 1.5, fontFamily: font.mono, color: "text.secondary" }}>
                        {secondsLeft(state.spotlight.endsAt, skew)}s left
                      </Box>
                    </Typography>
                    <Typography variant="h6">{spot.clue}</Typography>
                  </>
                ) : (
                  <Typography color="text.secondary">
                    {state.phase === "playing" ? "Between clues." : `${PHASE_LABEL[state.phase]}.`}
                    {state.phase !== "idle" && state.phaseEndsAt > 0 && state.phase !== "playing"
                      ? ` Next in ${secondsLeft(state.phaseEndsAt, skew)}s.`
                      : ""}
                  </Typography>
                )}
              </Paper>

              <Paper sx={{ p: 1.75 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                  Say as viewer
                </Typography>
                <SimForm sceneId={sceneId} onSent={() => setTimeout(refresh, 600)} />
              </Paper>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.75 }}>
                <Board title="This puzzle" rows={state.scores.map((s) => ({ name: s.name, points: s.points, words: s.words }))} />
                <Board title="Today" rows={state.today} />
                <Paper sx={{ p: 1.75 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Feed
                  </Typography>
                  {state.feed.length ? (
                    [...state.feed].reverse().map((f) => (
                      <Typography key={`${f.at}.${f.text}`} variant="body2">
                        {f.text}
                      </Typography>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.disabled">
                      Nothing solved yet.
                    </Typography>
                  )}
                </Paper>
              </Box>
            </Stack>
          </Box>
        )}
      </Stack>
    </AdminPageShell>
  );
}

function Board({ title, rows }: { title: string; rows: { name: string; points: number; words?: number }[] }) {
  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {title}
      </Typography>
      {rows.length ? (
        rows.slice(0, 10).map((r, i) => (
          <Stack key={`${r.name}.${i}`} direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2">{r.name}</Typography>
            <Typography variant="body2" sx={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
              {r.points}
            </Typography>
          </Stack>
        ))
      ) : (
        <Typography variant="body2" color="text.disabled">
          No scores yet.
        </Typography>
      )}
    </Paper>
  );
}
