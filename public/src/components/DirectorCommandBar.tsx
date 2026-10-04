"use client";

/**
 * Operator commands for a director in Auto (shared/director-commands.ts): hold
 * the shot, pause / resume, clear the queue, cut to a kind of shot now, and the
 * command log — what was asked, by whom, and what happened. Take to air for a
 * clicked event lives on its SELECTED card (control/page.tsx).
 *
 * Commands go through the queue, so the worker's loop stays the only thing
 * that changes what is on air; the readout above shows the result on the next
 * `director:state`.
 */
import { useCallback, useEffect, useState } from "react";
import type { DirectorState, SegmentKind } from "@photonsurge/shared/director";
import { describeOp, type DirectorCommand, type DirectorOp } from "@photonsurge/shared/director-commands";
import { dropCommand, fetchCommands, sendCommand } from "../lib/director-commands";
import { box } from "./panelBox";

/** The "cut to one of these now" row. */
export const TAKE_KINDS: { kind: SegmentKind; label: string }[] = [
  { kind: "quake", label: "Quake" },
  { kind: "storm", label: "Storm" },
  { kind: "volcano", label: "Volcano" },
  { kind: "flight", label: "Flight" },
  { kind: "ship", label: "Ship" },
  { kind: "ocean", label: "Ocean" },
  { kind: "orbital", label: "Space" },
  { kind: "global", label: "World" },
];

const STATUS_COLOR: Record<DirectorCommand["status"], string> = {
  queued: "#7fb3ff",
  applied: "#2bbe63",
  refused: "#ffb454",
  expired: "#8b93a7",
  dropped: "#8b93a7",
};

const btn = { ...box, cursor: "pointer", padding: "3px 8px", fontSize: 12 } as const;

function who(c: DirectorCommand): string {
  if (c.source.kind === "viewer") return `@${c.source.author}`;
  if (c.source.kind === "operator") return c.source.user;
  return c.source.job;
}

export default function DirectorCommandBar({
  sceneId,
  live,
  kinds,
  pollMs = 5000,
}: {
  sceneId: string;
  live: DirectorState | null;
  /** The channel's enabled kinds — a kind button shows only for kinds that air. */
  kinds: Partial<Record<SegmentKind, boolean>>;
  pollMs?: number;
}) {
  const [log, setLog] = useState<DirectorCommand[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchCommands(sceneId, 12).then(setLog);
  }, [sceneId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  // A new cut or a queue change usually means a command just settled.
  useEffect(() => {
    refresh();
  }, [refresh, live?.seq, live?.queued?.length, live?.paused?.since]);

  const send = async (op: DirectorOp) => {
    setError(null);
    const res = await sendCommand(sceneId, op);
    if (!res.ok) setError(res.error);
    refresh();
  };

  const paused = !!live?.paused;
  const takeable = TAKE_KINDS.filter((k) => kinds[k.kind]);

  return (
    <div style={{ marginBottom: 12 }} aria-label="Director commands">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <button type="button" style={btn} onClick={() => send({ op: "hold", extendS: 30 })}>
          Hold +30s
        </button>
        <button type="button" style={btn} onClick={() => send(paused ? { op: "resume" } : { op: "pause" })}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" style={btn} onClick={() => send({ op: "clear" })} disabled={!live?.queued?.length}>
          Clear queue
        </button>
      </div>
      {takeable.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Take now:</span>
          {takeable.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              style={{ ...btn, padding: "2px 6px", fontSize: 11 }}
              onClick={() => send({ op: "cut", target: { type: "kind", kind } })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: "#ffb454", marginBottom: 6 }}>
          {error}
        </div>
      ) : null}
      {log.length > 0 && (
        <div style={{ fontSize: 11, maxHeight: 140, overflowY: "auto" }} aria-label="Command log">
          {log.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "1px 0" }}>
              <span style={{ color: STATUS_COLOR[c.status], minWidth: 52 }}>{c.status}</span>
              <span style={{ flex: 1 }}>
                {describeOp(c.cmd)}
                {c.resolved ? ` → ${c.resolved.title}` : ""}
                {c.note && c.status !== "applied" ? ` · ${c.note}` : ""}
                <span style={{ opacity: 0.5 }}> · {who(c)}</span>
              </span>
              {c.status === "queued" ? (
                <button
                  type="button"
                  aria-label={`Drop ${describeOp(c.cmd)}`}
                  style={{ ...btn, padding: "0 5px", fontSize: 11 }}
                  onClick={() => void dropCommand(sceneId, c.id).then(refresh)}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
