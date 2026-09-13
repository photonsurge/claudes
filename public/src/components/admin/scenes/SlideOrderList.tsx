"use client";

/**
 * The bottom-left deck's slide list: pinned slides first (locked), then the
 * channel's ordered, hideable ones with up/down movers. Presentation only — the
 * card above it owns the staging.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  BROADCAST_SLIDES,
  SLIDE_GROUP_LABELS,
  type SlideId,
} from "@photonsurge/shared/broadcast-slides";

const SLIDE_BY_ID = new Map(BROADCAST_SLIDES.map((s) => [s.id, s]));

export default function SlideOrderList({
  ordered,
  off,
  onToggle,
  onMove,
}: {
  ordered: SlideId[];
  off: ReadonlySet<string>;
  onToggle: (id: SlideId, visible: boolean) => void;
  onMove: (id: SlideId, dir: -1 | 1) => void;
}) {
  const pinned = BROADCAST_SLIDES.filter((s) => s.pinned);

  return (
    <Box sx={{ display: "grid", gap: 0.5 }}>
      {pinned.map((s) => (
        <Row key={s.id} label={s.label} group={SLIDE_GROUP_LABELS[s.group]} pinned />
      ))}
      {ordered.map((id, idx) => {
        const s = SLIDE_BY_ID.get(id);
        if (!s) return null;
        return (
          <Row
            key={id}
            label={s.label}
            group={SLIDE_GROUP_LABELS[s.group]}
            checked={!off.has(id)}
            onToggle={(v) => onToggle(id, v)}
            onUp={idx > 0 ? () => onMove(id, -1) : undefined}
            onDown={idx < ordered.length - 1 ? () => onMove(id, 1) : undefined}
          />
        );
      })}
    </Box>
  );
}

function Row({
  label,
  group,
  checked,
  pinned,
  onToggle,
  onUp,
  onDown,
}: {
  label: string;
  group: string;
  checked?: boolean;
  pinned?: boolean;
  onToggle?: (v: boolean) => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", py: 0.25, opacity: pinned ? 0.7 : 1 }}
    >
      <Checkbox
        size="small"
        checked={pinned ? true : !!checked}
        disabled={pinned}
        onChange={(e) => onToggle?.(e.target.checked)}
        slotProps={{ input: { "aria-label": label } }}
        sx={{ p: 0.5 }}
      />
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
        {pinned && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
            (pinned)
          </Typography>
        )}
      </Typography>
      <Chip label={group} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      <IconButton
        size="small"
        disabled={!onUp}
        onClick={onUp}
        aria-label={`Move ${label} up`}
        sx={{ p: 0.25, width: 24, height: 24 }}
      >
        ↑
      </IconButton>
      <IconButton
        size="small"
        disabled={!onDown}
        onClick={onDown}
        aria-label={`Move ${label} down`}
        sx={{ p: 0.25, width: 24, height: 24 }}
      >
        ↓
      </IconButton>
    </Stack>
  );
}
