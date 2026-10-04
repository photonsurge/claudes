"use client";

/**
 * The selected script's FORMAT scene /watch page in a 16:9 iframe (tokened
 * URL, same origin), with Play / Stop for that script. Plays only ever target
 * a format's scene — the one a render uses, so this is what renders. When the
 * scene doesn't exist there is nothing to show, so the pane says how to create
 * it instead.
 *
 * The on-air chrome is laid out for a 1920×1080 canvas (what OBS captures), so
 * the iframe renders at that size and is scaled down to the pane's width —
 * a small viewport would reflow the chrome into something that never airs.
 */
import { useEffect, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { previewWatchUrl, type ShortPreviewInfo } from "../../../lib/shorts";
import { font } from "../../../theme/tokens";

interface Props {
  preview: ShortPreviewInfo;
  /** The selected script (Play is disabled without one). */
  script: { id: string; title: string; clipCount: number } | null;
  onPlay: () => void;
  onStop: () => void;
  busy?: boolean;
  /** The Play button's label ("Play sample" on a format's editor). */
  playLabel?: string;
  /** Overrides when Play is enabled (default: a script with clips is selected) —
   *  the format editor's Play sample can generate a script when there is none. */
  canPlay?: boolean;
  /** Replaces the line under the header (what Play will do). */
  note?: ReactNode;
}

/** The broadcast canvas the on-air chrome is designed for. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

/** Width of `el`, tracked with a ResizeObserver (0 until measured). Takes the
 *  element (a callback-ref'd state), not a ref, so a frame that mounts later —
 *  the scene seeded while the page was open — is still measured. */
function useWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

export default function PreviewPane({ preview, script, onPlay, onStop, busy, playLabel = "Play", canPlay, note }: Props) {
  const playing = preview.mode === "script";
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const scale = useWidth(frame) / CANVAS_W;

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
          Preview · <Box component="code" sx={{ fontFamily: font.mono }}>/watch/{preview.sceneId}</Box>
        </Typography>
        <Button variant="contained" onClick={onPlay} disabled={busy || !preview.exists || !(canPlay ?? (!!script && !!script.clipCount))}>
          {playLabel}
        </Button>
        <Button variant="outlined" onClick={onStop} disabled={busy || !preview.exists || !playing}>
          Stop
        </Button>
      </Stack>

      {!preview.exists ? (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          The format scene <code>{preview.sceneId}</code> doesn&apos;t exist yet. Run <strong>Seed default short format</strong> on{" "}
          /admin/jobs (or <code>yarn seed:short-format</code> in <code>worker</code>), then restart the worker — without a
          restarted worker nothing will play.
        </Alert>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
            {playing
              ? `Director: playing a script${script && preview.scriptId === script.id ? " — this one" : ""}.`
              : note ??
                (script
                  ? `Play runs “${script.title}” from the first clip. Previews never reach the as-run log.`
                  : "Select a script to preview it.")}
          </Typography>
          <Box
            ref={setFrame}
            sx={{ mt: 1.25, position: "relative", width: "100%", aspectRatio: "16 / 9", bgcolor: "#000", borderRadius: 1, overflow: "hidden" }}
          >
            {/* Scale is inline (changes with the pane width), not sx — see AdminPageShell's zoom. */}
            <Box
              component="iframe"
              title="Short preview"
              src={previewWatchUrl(preview)}
              allow="autoplay"
              style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale || 0})`, transformOrigin: "0 0" }}
              sx={{ position: "absolute", top: 0, left: 0, border: 0 }}
            />
          </Box>
        </>
      )}
    </Paper>
  );
}
