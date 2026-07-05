"use client";

/**
 * Rolling feed of worker → browser events (map refresh / data-ingest ticks) for
 * the on-air SYSLOG strip. Pure ambient "control room" flavor — distinct from
 * the admin LogTail, which is a polling diagnostic table. Listens to every
 * relayed socket event via onAny(), keeps only the ones worth showing, and
 * reduces each to a short plain-words line. Lines age out on their own after
 * LOG_LIFETIME_MS so the feed always reflects "recent" activity without a
 * manual read/dismiss step.
 */
import { useEffect, useRef, useState } from "react";
import { useSocket } from "./socket-provider";
import {
  WEATHER_RUN,
  TRACKS_UPDATED,
  CITIES_UPDATED,
  ALERTS_UPDATED,
  SUMMARIES_UPDATED,
} from "@photonsurge/shared/control";

export interface LogLine {
  id: string;
  /** ms since epoch (receipt time) — drives the fade + expiry. */
  at: number;
  text: string;
}

export const LOG_LIFETIME_MS = 20_000;
const MAX_LINES = 6;

/** Reduce a raw worker-event payload to a short plain-words line, or null to skip it. */
function formatEvent(type: string, data: Record<string, unknown> | undefined): string | null {
  switch (type) {
    case WEATHER_RUN:
      return "map refresh";
    case TRACKS_UPDATED: {
      const kind = typeof data?.kind === "string" ? data.kind : "tracks";
      return `tracks ${kind}`;
    }
    case CITIES_UPDATED:
      return typeof data?.enriched === "number" ? "cities enrich" : "cities sync";
    case ALERTS_UPDATED:
      return "alerts sync";
    case SUMMARIES_UPDATED:
      return "summary gen";
    default:
      return null;
  }
}

/** Rolling recent-activity feed for the on-air SYSLOG strip. Lines expire after ~20s. */
export function useEventLog(): LogLine[] {
  const { socket } = useSocket();
  const [lines, setLines] = useState<LogLine[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!socket) return;
    const onAny = (type: string, payload?: { data?: Record<string, unknown> }) => {
      const text = formatEvent(type, payload?.data);
      if (!text) return;
      seq.current += 1;
      const entry = { id: `${Date.now()}-${seq.current}`, at: Date.now(), text };
      setLines((prev) => [entry, ...prev].slice(0, MAX_LINES));
    };
    socket.onAny(onAny);
    return () => {
      socket.offAny(onAny);
    };
  }, [socket]);

  // Re-render once a second so lines fade + expire between events.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const now = Date.now();
  return lines.filter((l) => now - l.at < LOG_LIFETIME_MS);
}
