"use client";

import { useEffect, useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { RunState, StreamHealth } from "@photonsurge/shared/runs";
import type { YoutubeVideoStats } from "../../../lib/stream";

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${days ? `${days}d ` : ""}${days || hours ? `${hours}h ` : ""}${minutes}m ${seconds % 60}s`;
}

export default function RunStats({ run, health, youtubeStats, statsError }: { run: RunState; health?: StreamHealth; youtubeStats?: YoutubeVideoStats; statsError?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  const running = run.status === "live" || run.status === "ending";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const started = run.startAt != null && Number.isFinite(run.startAt) && run.startAt <= now
    && run.status !== "scheduled" && run.status !== "awaiting-ingest";
  const end = run.endedAt ?? (running ? now : null);
  const elapsed = started && end != null ? duration(end - run.startAt!) : null;
  const freshHealth = running && health && now - health.at < 60_000 ? health : undefined;
  const cells: string[] = [elapsed ? `${running ? "On air" : "Runtime"}: ${elapsed}` : started ? "Runtime unavailable" : "Not yet live"];
  if (started) cells.push(`Started: ${new Date(run.startAt!).toLocaleString()}`);
  if (run.endedAt != null) cells.push(`Ended: ${new Date(run.endedAt).toLocaleString()}`);
  if (running && started && run.durationMs && run.durationMs > 0) {
    cells.push(`Auto-end in: ${duration(run.startAt! + run.durationMs - now)}`);
  }
  if (freshHealth?.obs?.kbps != null) cells.push(`Bitrate: ${Math.round(freshHealth.obs.kbps)} kbps`);
  if (freshHealth?.obs?.droppedRatio != null) cells.push(`Dropped frames: ${(freshHealth.obs.droppedRatio * 100).toFixed(1)}%`);
  if (freshHealth?.youtube?.health) cells.push(`YouTube: ${freshHealth.youtube.health}`);
  if (freshHealth?.obs?.reconnecting) cells.push("Encoder reconnecting");
  if (run.youtube?.broadcastId) {
    const count = (value?: string) => value != null && /^\d+$/.test(value) ? BigInt(value).toLocaleString() : "—";
    if (youtubeStats) {
      cells.push(`Views: ${count(youtubeStats.views)}`, `Likes: ${count(youtubeStats.likes)}`);
      if (run.status === "live") {
        const fresh = !statsError && !youtubeStats.error && youtubeStats.fetchedAt != null && now - youtubeStats.fetchedAt < 120_000;
        cells.push(`Watching now: ${count(fresh ? youtubeStats.watchingNow : undefined)}`);
      }
      if (youtubeStats.fetchedAt != null) cells.push(`YouTube updated: ${new Date(youtubeStats.fetchedAt).toLocaleString()}`);
      if (youtubeStats.error) cells.push(youtubeStats.error);
    } else {
      cells.push(statsError || "YouTube stats loading…");
    }
  }

  return (
    <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", mt: 1, fontVariantNumeric: "tabular-nums" }}>
      {cells.map((cell, i) => (
        <Typography key={i} variant="caption" color={i === 0 ? "text.primary" : "text.secondary"}>
          {cell}
        </Typography>
      ))}
    </Stack>
  );
}
