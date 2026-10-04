"use client";

/**
 * TakeList — the bench's spoken takes, newest first, each with a player and
 * what it cost, so voices and settings can be compared by ear.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { PresenterVoice, VoiceTest } from "@photonsurge/shared/presenter";
import { fmtUsd, takeAudioUrl, voiceSummary } from "../../../lib/presenters";
import { font } from "../../../theme/tokens";

const STATUS_COLOR: Record<VoiceTest["status"], "default" | "info" | "success" | "error"> = {
  queued: "default",
  speaking: "info",
  ready: "success",
  error: "error",
};

const STYLE_SENT: Record<NonNullable<VoiceTest["sent"]>["style"], string | null> = {
  option: "style sent as an option",
  text: "style sent in the text",
  "voice-id": "style is the voice",
  "not-sent": "style NOT sent",
  none: null,
};

function sentLine(t: VoiceTest): string {
  const parts = [`${t.audio?.chars ?? t.spoken?.length ?? t.text.length} chars`];
  if (t.audio?.durationMs) parts.push(`${(t.audio.durationMs / 1000).toFixed(1)} s`);
  if (t.audio) parts.push(`${(t.audio.latencyMs / 1000).toFixed(1)} s to make`, `~${fmtUsd(t.audio.estCostUsd)}`);
  const style = t.sent ? STYLE_SENT[t.sent.style] : null;
  if (style) parts.push(style);
  if (t.sent?.options) parts.push("options sent");
  return parts.join(" · ");
}

export interface TakeListProps {
  takes: VoiceTest[];
  onDelete: (id: string) => void;
  /** Copy a take's voice into a presenter's editor. */
  onUseVoice?: (voice: PresenterVoice) => void;
}

export default function TakeList({ takes, onDelete, onUseVoice }: TakeListProps) {
  const [open, setOpen] = useState<string | null>(null);
  if (!takes.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No takes yet. Press Test on a presenter.
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      {takes.map((t) => (
        <Paper key={t.id} variant="outlined" sx={{ p: 1.25 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t.label}
            </Typography>
            <Chip size="small" label={t.status} color={STATUS_COLOR[t.status]} />
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: font.mono }}>
              {voiceSummary(t.voice)}
              {t.voice.style ? ` · “${t.voice.style}”` : ""}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ ml: "auto" }}>
              {new Date(t.createdAt).toLocaleTimeString()}
            </Typography>
          </Stack>

          {t.status === "ready" && (
            <audio controls preload="none" src={takeAudioUrl(t.id)} style={{ width: "100%", marginTop: 8 }} />
          )}
          {t.error && (
            <Alert severity="error" sx={{ mt: 1, py: 0 }}>
              {t.error}
            </Alert>
          )}

          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5, flexWrap: "wrap" }} useFlexGap>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: font.mono, flex: 1 }}>
              {sentLine(t)}
            </Typography>
            <Button size="small" onClick={() => setOpen(open === t.id ? null : t.id)}>
              {open === t.id ? "Hide text" : "Text"}
            </Button>
            {onUseVoice && (
              <Button size="small" onClick={() => onUseVoice(t.voice)}>
                Use this voice
              </Button>
            )}
            <Button size="small" color="error" onClick={() => onDelete(t.id)}>
              Delete
            </Button>
          </Stack>

          {open === t.id && (
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Typed
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {t.text}
              </Typography>
              {t.spoken && t.spoken !== t.text && (
                <>
                  <Typography variant="caption" color="text.secondary">
                    Sent to the model (after the rewrite for the ear)
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: font.mono, fontSize: 13 }}>
                    {t.spoken}
                  </Typography>
                </>
              )}
              {t.audio?.generationId && (
                <Typography variant="caption" color="text.disabled" sx={{ fontFamily: font.mono }}>
                  generation {t.audio.generationId}
                </Typography>
              )}
            </Stack>
          )}
        </Paper>
      ))}
    </Stack>
  );
}
