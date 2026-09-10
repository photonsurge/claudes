"use client";

/**
 * Per-channel "what's on / what's next" strip for the home launcher: the shot the
 * auto-director is airing NOW (with its countdown), the one it has queued NEXT,
 * and a Next button that cuts to it immediately — the same skipNonce bump as
 * /control's Skip ⏭, so home can drive a channel without opening its console.
 *
 * Renders nothing unless the director is actually driving the channel: a
 * hand-driven or off-air channel has no queue to show and nothing to skip to.
 */
import { useEffect, useState } from "react";
import { upNextLabel, type DirectorState } from "@photonsurge/shared/director";
import { skipToNextShot } from "../lib/director";

/** Safety net: clear the pending state if no fresh cut arrives (worker asleep). */
const SKIP_TIMEOUT_MS = 8000;

export default function ChannelNowNext({
  sceneId,
  director,
}: {
  sceneId: string;
  director: DirectorState | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [skipping, setSkipping] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // A new cut (seq bump) is the confirmation that the skip landed.
  const seq = director?.seq;
  useEffect(() => {
    setSkipping(false);
  }, [seq]);

  // …and don't stay stuck on "Cutting…" if that cut never arrives.
  useEffect(() => {
    if (!skipping) return;
    const t = setTimeout(() => setSkipping(false), SKIP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [skipping]);

  if (!director?.active || !director.segment) return null;

  const segment = director.segment;
  const next = director.upNext?.[0];
  const remaining = director.endsAt ? Math.max(0, Math.round((director.endsAt - now) / 1000)) : null;

  const skip = async () => {
    setFailed(false);
    setSkipping(true);
    try {
      await skipToNextShot(sceneId);
    } catch {
      setSkipping(false);
      setFailed(true);
    }
  };

  return (
    <div style={{ borderTop: "1px solid #232b3d", paddingTop: 10, marginBottom: 10 }}>
      <Line label="Now" title={segment.title} sub={segment.subtitle} trailing={remaining === null ? undefined : `${remaining}s`} />
      <div style={{ marginTop: 6 }}>
        <Line label="Next" title={next ? upNextLabel(next) : "—"} muted />
      </div>
      <button
        onClick={skip}
        disabled={skipping}
        title="Cut to the next shot now"
        style={{
          marginTop: 10,
          padding: "5px 12px",
          borderRadius: 6,
          border: "1px solid #2a3142",
          background: "#1a2030",
          color: skipping ? "#8b95a7" : "#fff",
          fontSize: 13,
          fontWeight: 600,
          cursor: skipping ? "default" : "pointer",
        }}
      >
        {skipping ? "Cutting…" : "Next ⏭"}
      </button>
      {failed ? <span style={{ marginLeft: 8, fontSize: 12, color: "#ff8a8a" }}>Skip failed</span> : null}
    </div>
  );
}

/** One "Now"/"Next" row: fixed-width label, title (+ optional detail), trailing chip. */
function Line({
  label,
  title,
  sub,
  trailing,
  muted,
}: {
  label: string;
  title: string;
  sub?: string;
  trailing?: string;
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#8b95a7",
          width: 34,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ color: muted ? "#8b95a7" : "#fff", fontWeight: muted ? 400 : 600, minWidth: 0 }}>
        {title}
        {sub ? <span style={{ color: "#8b95a7", fontWeight: 400 }}> · {sub}</span> : null}
      </span>
      {trailing ? (
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#8b95a7", flexShrink: 0 }}>{trailing}</span>
      ) : null}
    </div>
  );
}
