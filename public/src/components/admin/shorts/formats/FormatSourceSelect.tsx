"use client";

/**
 * "Duplicate from" / "Copy look from" picker: every channel, then every format
 * (a format's id is also its scene's, and never a channel's). `exclude` drops
 * one id — a format can't copy its own look.
 */
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { SceneMeta } from "@photonsurge/shared/control";

export default function FormatSourceSelect({
  label,
  value,
  onChange,
  channels,
  formats,
  exclude,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  channels: Pick<SceneMeta, "id" | "name">[];
  formats: { id: string; name: string }[];
  exclude?: string;
  disabled?: boolean;
}) {
  const chans = channels.filter((c) => c.id !== exclude);
  const fmts = formats.filter((f) => f.id !== exclude);
  const known = chans.some((c) => c.id === value) || fmts.some((f) => f.id === value);
  return (
    <TextField
      select
      size="small"
      label={label}
      value={known ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      sx={{ minWidth: 240 }}
    >
      {chans.length > 0 && <ListSubheader>Channels</ListSubheader>}
      {chans.map((c) => (
        <MenuItem key={`c:${c.id}`} value={c.id}>
          {c.name}
        </MenuItem>
      ))}
      {fmts.length > 0 && <ListSubheader>Formats</ListSubheader>}
      {fmts.map((f) => (
        <MenuItem key={`f:${f.id}`} value={f.id}>
          {f.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
