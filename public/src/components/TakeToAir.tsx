"use client";

/**
 * "Take to air" on the operator's SELECTED card: queue a director cut to the
 * clicked event. The worker resolves the segment id itself (same builder the
 * director uses), so what airs is the channel's own shot of that event.
 */
import { useState } from "react";
import type { Segment } from "@photonsurge/shared/director";
import { sendCommand } from "../lib/director-commands";

export default function TakeToAir({ sceneId, segment }: { sceneId: string; segment: Segment }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | { error: string }>("idle");

  const take = async () => {
    setState("sending");
    const res = await sendCommand(sceneId, { op: "cut", target: { type: "segment", id: segment.id } });
    setState(res.ok ? "sent" : { error: res.error });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={take}
        disabled={state === "sending"}
        style={{
          background: "#b3261e",
          color: "#fff",
          border: "1px solid #ff5252",
          borderRadius: 6,
          padding: "4px 12px",
          fontWeight: 700,
          fontSize: 13,
          cursor: state === "sending" ? "default" : "pointer",
        }}
      >
        Take to air
      </button>
      {state === "sent" ? <span style={{ fontSize: 12, opacity: 0.8 }}>Queued — cutting now…</span> : null}
      {typeof state === "object" ? (
        <span role="alert" style={{ fontSize: 12, color: "#ffb454" }}>
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
