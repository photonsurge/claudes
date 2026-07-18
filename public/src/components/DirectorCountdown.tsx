"use client";

/** The "starting in…" pre-broadcast countdown box on /control — a splash
 *  screen timer on /watch. Starting a countdown arms the show: the moment it
 *  reaches zero (or the operator hits "Go live now") the auto-director is
 *  switched on so it takes over the instant the broadcast goes live. Owns its
 *  own input + tick state since nothing outside this box needs it. */
import { useEffect, useRef, useState } from "react";
import { mergeControlState, type ControlState } from "@photonsurge/shared/control";
import { box } from "./panelBox";

export default function DirectorCountdown({
  liveState,
  applyLive,
  auto,
  startDirector,
}: {
  liveState: ControlState;
  applyLive: (next: ControlState) => void;
  auto: boolean;
  startDirector: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const [countdownSecs, setCountdownSecs] = useState(30);
  const countdownRemaining = liveState.startAt ? Math.max(0, Math.ceil((liveState.startAt - now) / 1000)) : 0;
  const countdownActive = liveState.startAt != null && countdownRemaining > 0;

  // When the countdown crosses zero, hand the show to the auto-director — once
  // per countdown, and only if it isn't already running. The wall-clock target
  // itself keys the fire-guard so a fresh countdown re-arms cleanly.
  const firedFor = useRef<number | null>(null);
  useEffect(() => {
    const target = liveState.startAt;
    if (target == null) {
      firedFor.current = null;
      return;
    }
    if (now >= target && firedFor.current !== target) {
      firedFor.current = target;
      if (!auto) startDirector();
    }
  }, [now, liveState.startAt, auto, startDirector]);

  // "Go live now" ends the countdown early and starts the director immediately.
  const goLiveNow = () => {
    applyLive(mergeControlState(liveState, { startAt: null }));
    if (!auto) startDirector();
  };

  return (
    <div style={{ ...box, marginBottom: 12, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.7, marginBottom: 8 }}>
        PRE-BROADCAST COUNTDOWN
      </div>
      {countdownActive ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{countdownRemaining}s</span>
          <button onClick={goLiveNow} style={{ ...box, cursor: "pointer" }}>
            Go live now
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            min={5}
            max={600}
            value={countdownSecs}
            onChange={(e) => setCountdownSecs(Math.max(5, Number(e.target.value) || 30))}
            style={{ ...box, width: 64 }}
          />
          <span style={{ fontSize: 12, opacity: 0.7 }}>seconds</span>
          <button
            onClick={() => applyLive(mergeControlState(liveState, { startAt: Date.now() + countdownSecs * 1000 }))}
            style={{ ...box, cursor: "pointer", fontWeight: 700, flex: 1, background: "#1f7a3f", borderColor: "#2bbe63" }}
          >
            Start countdown ▶
          </button>
        </div>
      )}
    </div>
  );
}
