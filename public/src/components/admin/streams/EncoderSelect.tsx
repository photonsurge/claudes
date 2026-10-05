"use client";

/**
 * The encoder picker (docs/short-video-plan.md §6.2): each OBS instance with
 * what it is doing right now, from the `occupancy` the /api/streams snapshot
 * returns per encoder — free; live (since, until); held by an always-on slot;
 * rendering (with how many more are queued); booked; disabled (greyed).
 *
 * Two purposes:
 *  - `channel` (the go-live and slot forms): encoders assigned to videos are
 *    not offered, so a channel can't take one by accident (§6.6). The state is
 *    advisory — the server checks on submit.
 *  - `video` (the Render form): video encoders first, then "Any video
 *    encoder", then channel encoders. A live or held encoder can't take a
 *    video; a rendering one can (the video queues behind it). A free channel
 *    encoder can be picked, with a warning.
 */
import type { ReactNode } from "react";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import type { EncoderOccupancyState } from "@photonsurge/shared/encoder-occupancy";
import { encoderUse } from "@photonsurge/shared/runs";
import { ANY_ENCODER } from "@photonsurge/shared/short-render";
import { encodersForChannel, type EncoderWithOccupancy } from "../../../lib/renders";

const STATE_COLOR: Record<EncoderOccupancyState, string> = {
  free: "success.main",
  booked: "success.main",
  rendering: "info.main",
  live: "error.main",
  held: "warning.main",
  disabled: "text.disabled",
};

interface Props {
  encoders: EncoderWithOccupancy[];
  value: string;
  onChange: (id: string) => void;
  purpose: "channel" | "video";
  label?: string;
  /** `channel` only: the label of the empty value ("auto": the worker picks). */
  emptyLabel?: string;
  /**
   * `channel` only: a live, held or rendering encoder can't be chosen (the Go
   * live dialog, crossword plan §10). Off, the state is advisory as before.
   */
  refuseBusy?: boolean;
  /** `channel` only: no empty ("auto") value — an encoder must be picked. */
  noAuto?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}

/** What the encoder is doing, one line ("free" when the snapshot didn't say). */
export function occupancyLine(enc: EncoderWithOccupancy): string {
  if (!enc.enabled) return "disabled";
  return enc.occupancy?.label ?? "free";
}

/** Is the encoder streaming or held, so a channel can't go live on it now? */
export const encoderBusy = (enc: EncoderWithOccupancy): boolean => {
  const state = enc.occupancy?.state;
  return state === "live" || state === "held" || state === "rendering";
};

/** Can a video be queued on this encoder (§6.2)? */
export const canTakeVideo = (enc: EncoderWithOccupancy): boolean =>
  enc.enabled && enc.occupancy?.canQueueVideo !== false;

export default function EncoderSelect({
  encoders,
  value,
  onChange,
  purpose,
  label = "encoder",
  emptyLabel = "auto",
  refuseBusy,
  noAuto,
  disabled,
  size,
  sx,
}: Props) {
  const name = (e: EncoderWithOccupancy) => e.name || e.id;
  const item = (enc: EncoderWithOccupancy, itemDisabled: boolean) => {
    const state: EncoderOccupancyState = enc.enabled ? (enc.occupancy?.state ?? "free") : "disabled";
    return (
      <MenuItem key={enc.id} value={enc.id} disabled={itemDisabled} sx={{ display: "block" }}>
        <Typography variant="body2" component="div">
          {name(enc)}
        </Typography>
        <Typography variant="caption" component="div" sx={{ color: STATE_COLOR[state] }}>
          {occupancyLine(enc)}
        </Typography>
      </MenuItem>
    );
  };

  const items: ReactNode[] = [];
  let helper: string | undefined;
  if (purpose === "channel") {
    if (!noAuto) {
      items.push(
        <MenuItem key="" value="">
          {emptyLabel}
        </MenuItem>,
      );
    }
    for (const enc of encodersForChannel(encoders, value)) items.push(item(enc, !enc.enabled || (!!refuseBusy && encoderBusy(enc))));
  } else {
    const video = encoders.filter((e) => encoderUse(e) === "videos");
    const channel = encoders.filter((e) => encoderUse(e) !== "videos");
    for (const enc of video) items.push(item(enc, !canTakeVideo(enc)));
    items.push(
      <MenuItem key={ANY_ENCODER} value={ANY_ENCODER} sx={{ display: "block" }}>
        <Typography variant="body2" component="div">
          Any video encoder
        </Typography>
        <Typography variant="caption" component="div" color="text.secondary">
          {video.length ? "the first idle video encoder takes it" : "no encoder is assigned to videos yet"}
        </Typography>
      </MenuItem>,
    );
    if (channel.length) {
      items.push(<ListSubheader key="channel-encoders">Channel encoders</ListSubheader>);
      for (const enc of channel) items.push(item(enc, !canTakeVideo(enc)));
    }
    const picked = encoders.find((e) => e.id === value);
    if (picked && encoderUse(picked) !== "videos") {
      helper = "A channel encoder: it is pointed at the video while it renders. A channel can't use it meanwhile.";
    } else if (value === ANY_ENCODER && !video.length) {
      helper = "No encoder is assigned to videos — the video waits until one is.";
    }
  }

  const known = value === "" || value === ANY_ENCODER || encoders.some((e) => e.id === value);
  return (
    <TextField
      select
      size={size}
      label={label}
      value={known ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      helperText={helper}
      sx={{ minWidth: 180, ...((sx as object) ?? {}) }}
      slotProps={{
        select: {
          renderValue: (v) => {
            const id = String(v ?? "");
            if (id === "") return noAuto ? "" : emptyLabel;
            if (id === ANY_ENCODER) return "Any video encoder";
            const enc = encoders.find((e) => e.id === id);
            return enc ? (
              <Box component="span">
                {name(enc)}
                <Box component="span" sx={{ color: "text.secondary" }}>
                  {" "}
                  · {occupancyLine(enc)}
                </Box>
              </Box>
            ) : (
              id
            );
          },
        },
        formHelperText: helper ? { sx: { color: "warning.main" } } : undefined,
      }}
    >
      {items}
    </TextField>
  );
}
