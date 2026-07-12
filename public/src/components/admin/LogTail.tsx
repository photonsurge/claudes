"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { iLogModel } from "@photonsurge/shared/db/log-model";

const LEVELS = ["error", "warn", "info", "event", "log"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_STYLE: Record<string, { fg: string; bg: string }> = {
  error: { fg: "#fecaca", bg: "#7f1d1d" },
  warn: { fg: "#fde68a", bg: "#78350f" },
  info: { fg: "#bfdbfe", bg: "#1e3a5f" },
  event: { fg: "#bbf7d0", bg: "#14532d" },
  log: { fg: "#d1d5db", bg: "#374151" },
};

function relTime(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function Pill({ level }: { level: string }) {
  const s = LEVEL_STYLE[level] ?? LEVEL_STYLE.log;
  return (
    <span
      style={{
        color: s.fg,
        background: s.bg,
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        minWidth: 38,
        textAlign: "center",
      }}
    >
      {level}
    </span>
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
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>
          {title} <span style={{ color: "#5b6577", fontWeight: 400 }}>{shown.length}</span>
        </h3>
        <div style={{ display: "flex", gap: 5 }}>
          {LEVELS.map((l) => {
            const on = active.has(l);
            const s = LEVEL_STYLE[l];
            return (
              <button
                key={l}
                type="button"
                onClick={() => toggleLevel(l)}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  padding: "2px 7px",
                  borderRadius: 4,
                  cursor: "pointer",
                  border: `1px solid ${on ? s.bg : "#2a3344"}`,
                  background: on ? s.bg : "transparent",
                  color: on ? s.fg : "#5b6577",
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter…"
          style={{
            flex: 1,
            minWidth: 120,
            background: "#0a0e16",
            color: "#fff",
            border: "1px solid #2a3344",
            borderRadius: 5,
            padding: "4px 8px",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          title={live ? "Pause auto-refresh" : "Resume"}
          style={{
            fontSize: 11,
            padding: "4px 9px",
            borderRadius: 5,
            border: "1px solid #2a3344",
            background: live ? "#14532d" : "#1a1f2b",
            color: live ? "#bbf7d0" : "#8b95a7",
            cursor: "pointer",
          }}
        >
          {live ? "● live" : "paused"}
        </button>
      </div>

      <div
        style={{
          marginTop: 10,
          border: "1px solid #1b2030",
          borderRadius: 8,
          background: "#0a0e16",
          maxHeight: 520,
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
        }}
      >
        {shown.map((l) => {
          const hasStuff = l.stuff != null && Object.keys(l.stuff as object).length > 0;
          return (
            <div key={l.id} style={{ borderTop: "1px solid #121826" }}>
              <div
                onClick={() => hasStuff && setOpen(open === l.id ? null : l.id)}
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "baseline",
                  padding: "5px 10px",
                  cursor: hasStuff ? "pointer" : "default",
                }}
              >
                <span style={{ color: "#475569", width: 30, textAlign: "right" }} title={new Date(l.timestamp).toLocaleString()}>
                  {relTime(l.timestamp, now)}
                </span>
                <Pill level={l.level} />
                <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                  {l.instance}:{l.tag}
                </span>
                <span style={{ color: "#e5e7eb", flex: 1, wordBreak: "break-word" }}>{l.message}</span>
                {hasStuff && <span style={{ color: "#475569" }}>{open === l.id ? "▾" : "▸"}</span>}
              </div>
              {open === l.id && hasStuff && (
                <pre
                  style={{
                    margin: 0,
                    padding: "0 10px 8px 49px",
                    color: "#94a3b8",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(l.stuff, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ padding: 14, color: "#5b6577" }}>No matching log entries.</div>}
      </div>
    </div>
  );
}
