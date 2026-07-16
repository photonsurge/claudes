"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { iLogModel } from "@photonsurge/shared/db/log-model";
import { font, surface } from "../../theme/tokens";

const LEVELS = ["error", "warn", "info", "event", "log"] as const;
type Level = (typeof LEVELS)[number];

/**
 * Levels map onto the theme's status ramp rather than carrying their own
 * palette, so an `error` line here reads the same red as an error anywhere else
 * in the product. `log`/`info` have no severity to signal, hence the neutrals.
 */
type LevelColor = "error" | "warning" | "info" | "success" | "default";
const LEVEL_COLOR: Record<string, LevelColor> = {
  error: "error",
  warn: "warning",
  info: "info",
  event: "success",
  log: "default",
};

function relTime(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function Pill({ level }: { level: string }) {
  return (
    <Chip
      label={level}
      variant="filled"
      color={LEVEL_COLOR[level] ?? "default"}
      sx={{ minWidth: 46, height: 16, fontSize: 10, flexShrink: 0 }}
    />
  );
}

/** Live tail of the back-log. Reusable on /admin/logs and /admin/jobs. */
export default function LogTail({
  limit = 200,
  title = "Logs",
  excludeType,
}: {
  limit?: number;
  title?: string;
  /** Comma-separated log `type`s to omit server-side (e.g. "request" to hide API-request lines). */
  excludeType?: string;
}) {
  const [logs, setLogs] = useState<iLogModel[]>([]);
  const [active, setActive] = useState<Set<Level>>(new Set());
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.parse("2026-01-01T00:00:00Z"));

  const refresh = useCallback(async () => {
    const exclude = excludeType ? `&exclude=${encodeURIComponent(excludeType)}` : "";
    const res = await fetch(`/api/admin/logs?limit=${limit}${exclude}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (body) setLogs(body.logs ?? []);
    setNow(Date.now());
  }, [limit, excludeType]);

  useEffect(() => {
    refresh();
    if (!live) return;
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh, live]);

  const toggleLevel = (l: Level) =>
    setActive((prev) => {
      const next = new Set(prev);
      next.has(l) ? next.delete(l) : next.add(l);
      return next;
    });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (active.size && !active.has(l.level as Level)) return false;
      if (q && !`${l.message} ${l.tag} ${l.type} ${l.instance}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, active, search]);

  return (
    <Box>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="h3" component="h3">
          {title}{" "}
          <Box component="span" sx={{ color: "text.disabled", fontWeight: 400, fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
            {shown.length}
          </Box>
        </Typography>
        {/*
          A ToggleButtonGroup rather than filter chips: the levels are a
          multi-select of pressed/unpressed states, and `aria-pressed` is what
          actually tells a screen reader which filters are on.
        */}
        <ToggleButtonGroup
          value={[...active]}
          onChange={(_e, next: Level[]) => setActive(new Set(next))}
          size="small"
          aria-label="Filter by level"
          sx={{
            "& .MuiToggleButton-root": {
              px: 0.875,
              py: 0.25,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1.4,
              letterSpacing: 0.3,
              color: "text.disabled",
              borderColor: "divider",
            },
          }}
        >
          {LEVELS.map((l) => {
            const tone = LEVEL_COLOR[l];
            return (
              <ToggleButton
                key={l}
                value={l}
                aria-label={l}
                sx={{
                  // Selected takes the level's own status colour, so which
                  // filter is on is legible without reading the labels.
                  "&.Mui-selected": {
                    color: tone === "default" ? "text.primary" : `${tone}.main`,
                    borderColor: tone === "default" ? "divider" : `${tone}.main`,
                  },
                }}
              >
                {l}
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter…"
          slotProps={{ htmlInput: { "aria-label": "Filter log entries" } }}
          sx={{ flex: 1, minWidth: 120 }}
        />
        <Button
          variant="outlined"
          onClick={() => setLive((v) => !v)}
          title={live ? "Pause auto-refresh" : "Resume"}
          sx={{ minHeight: 28, whiteSpace: "nowrap", ...(live && { color: "success.main", borderColor: "success.main" }) }}
        >
          {live ? "● live" : "paused"}
        </Button>
      </Stack>

      {/* A log tail is a reading, end to end: sunken well, mono, tabular. */}
      <Box
        sx={{
          mt: 1.25,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: surface.sunken,
          maxHeight: 520,
          overflowY: "auto",
          fontFamily: font.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 12,
        }}
      >
        {shown.map((l) => {
          const hasStuff = l.stuff != null && Object.keys(l.stuff as object).length > 0;
          return (
            <Box key={l.id} sx={{ borderTop: 1, borderColor: "divider" }}>
              <Box
                onClick={() => hasStuff && setOpen(open === l.id ? null : l.id)}
                sx={{
                  display: "flex",
                  gap: 1.125,
                  alignItems: "baseline",
                  px: 1.25,
                  py: 0.625,
                  cursor: hasStuff ? "pointer" : "default",
                }}
              >
                <Box component="span" sx={{ color: "text.disabled", width: 30, textAlign: "right", flexShrink: 0 }} title={new Date(l.timestamp).toLocaleString()}>
                  {relTime(l.timestamp, now)}
                </Box>
                <Pill level={l.level} />
                <Box component="span" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
                  {l.instance}:{l.tag}
                </Box>
                <Box component="span" sx={{ color: "text.primary", flex: 1, wordBreak: "break-word" }}>
                  {l.message}
                </Box>
                {hasStuff && <Box component="span" sx={{ color: "text.disabled" }}>{open === l.id ? "▾" : "▸"}</Box>}
              </Box>
              {open === l.id && hasStuff && (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    pl: "49px",
                    pr: 1.25,
                    pb: 1,
                    color: "text.secondary",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(l.stuff, null, 2)}
                </Box>
              )}
            </Box>
          );
        })}
        {shown.length === 0 && (
          <Box sx={{ p: 1.75, color: "text.disabled" }}>No matching log entries.</Box>
        )}
      </Box>
    </Box>
  );
}
