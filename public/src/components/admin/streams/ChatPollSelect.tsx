"use client";

/**
 * Chat poll-interval picker for a stream / constant-stream slot. Each option
 * shows roughly what one stream's chat polling costs per day against the
 * YouTube Data API quota (10k units/day by default; 5 units a poll).
 */
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { CHAT_POLL_CHOICES_MS, chatPollUnitsPerDay, fmtChatPoll } from "@photonsurge/shared/runs";

const fmtUnits = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));

export function chatPollLabel(ms: number): string {
  return ms ? `every ${fmtChatPoll(ms)} · ~${fmtUnits(chatPollUnitsPerDay(ms))} units/day` : "auto (quota-paced)";
}

export default function ChatPollSelect({
  value,
  onChange,
  disabled,
  fullWidth,
}: {
  value: number | null | undefined;
  onChange: (pollEveryMs: number | null) => void;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const current = value || 0;
  // Keep an off-list value (set via the API) selectable rather than blanking the field.
  const choices: number[] = (CHAT_POLL_CHOICES_MS as readonly number[]).includes(current)
    ? [...CHAT_POLL_CHOICES_MS]
    : [...CHAT_POLL_CHOICES_MS, current].sort((a, b) => a - b);
  return (
    <TextField
      select
      label="chat poll"
      value={String(current)}
      onChange={(e) => onChange(Number(e.target.value) || null)}
      disabled={disabled}
      fullWidth={fullWidth}
      sx={fullWidth ? undefined : { minWidth: 150 }}
      helperText="Slower = less YouTube quota. Viewer commands are answered on the next poll."
    >
      {choices.map((ms) => (
        <MenuItem key={ms} value={String(ms)}>
          {chatPollLabel(ms)}
        </MenuItem>
      ))}
    </TextField>
  );
}
