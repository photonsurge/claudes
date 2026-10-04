"use client";

/**
 * Render defaults card (§5.2 `render`): the encoder and the YouTube channel a
 * render of this format starts from — the same encoders and connected channels
 * the streams page's run form offers. The encoder is the Render form's own
 * picker (`EncoderSelect` for a video: video encoders first, each with what it
 * is doing now). The render form and schedules can still pick others. Stages
 * the whole `render` field; "Any video encoder" / "default channel" clear the
 * default.
 */
import { useEffect, useState } from "react";
import Stack from "@mui/material/Stack";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import { ANY_ENCODER } from "@photonsurge/shared/short-render";
import EncoderSelect from "../../streams/EncoderSelect";
import type { EncoderWithOccupancy } from "../../../../lib/renders";
import SettingsCard from "../../scenes/SettingsCard";
import { useSceneDraft } from "../../scenes/SceneDraft";
import { fetchRenderOptions } from "../../../../lib/short-formats";
import type { StreamAccount } from "../../../../lib/stream";

export default function FormatRenderSettings({ load = fetchRenderOptions }: { load?: typeof fetchRenderOptions }) {
  const { format, stageFormat } = useSceneDraft();
  const [options, setOptions] = useState<{ encoders: EncoderWithOccupancy[]; accounts: StreamAccount[] } | null>(null);

  useEffect(() => {
    let live = true;
    load().then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [load]);

  if (!format) return null;
  const r = format.render;
  const set = (over: Partial<ShortFormat["render"]>) => {
    const next: ShortFormat["render"] = { ...r, ...over };
    // An empty pick clears the default: drop the key (the save sends the clear).
    if (next.encoderId === ANY_ENCODER) delete next.encoderId;
    for (const k of ["encoderId", "accountId"] as const) if (!next[k]) delete next[k];
    stageFormat({ render: next });
  };

  const encoders = options?.encoders ?? [];
  const accounts = options?.accounts ?? [];
  // A saved id the lists no longer have is named under the picker, so it can be seen and cleared.
  const encoderKnown = !r.encoderId || encoders.some((e) => e.id === r.encoderId);
  const accountKnown = !r.accountId || accounts.some((a) => a.channelId === r.accountId);

  return (
    <SettingsCard
      id="render"
      blurb="What a render of this format starts from. The render form and schedules can pick another encoder or channel."
    >
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Stack spacing={0.25}>
          <EncoderSelect
            purpose="video"
            size="small"
            label="Encoder"
            encoders={encoders}
            value={r.encoderId ?? ANY_ENCODER}
            onChange={(id) => set({ encoderId: id })}
            sx={{ minWidth: 220 }}
          />
          {!options && (
            <Typography variant="caption" color="text.secondary">
              Loading encoders…
            </Typography>
          )}
          {options && !encoderKnown && (
            <Typography variant="caption" color="warning.main">
              The saved encoder &quot;{r.encoderId}&quot; no longer exists. Pick another, or Any video encoder.
            </Typography>
          )}
        </Stack>
        <TextField
          select
          size="small"
          label="YouTube channel"
          value={r.accountId ?? ""}
          onChange={(e) => set({ accountId: e.target.value })}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Default channel</MenuItem>
          {accounts.map((a) => (
            <MenuItem key={a.channelId} value={a.channelId}>
              {a.channelTitle || a.channelId}
            </MenuItem>
          ))}
          {!accountKnown && <MenuItem value={r.accountId}>{r.accountId} (not connected)</MenuItem>}
        </TextField>
      </Stack>
    </SettingsCard>
  );
}
