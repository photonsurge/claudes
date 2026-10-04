"use client";

/**
 * A countdown to a server time: a draining bar and an m:ss readout. The bar is
 * one CSS animation per deadline (keyed on `endsAt`), started from how full it
 * should be now; the readout ticks once a second. Both read the server's clock
 * as local now + `offset`, so an encoder whose clock is off still counts right.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatClock, remainingMs } from "../../lib/crossword";
import { ACCENT, CELL, INK, MONO } from "./styles";

export interface CountdownProps {
  endsAt: number;
  /** When the window opened (server time); without it the bar starts full. */
  startedAt?: number;
  offset: number;
  paused?: boolean;
  /** Draw the bar (off: the readout only). */
  bar?: boolean;
  fontSize?: number;
}

/** Local now, re-read once a second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [live]);
  return now;
}

export default function Countdown({ endsAt, startedAt, offset, paused = false, bar = true, fontSize = 28 }: CountdownProps) {
  const now = useNow(!paused);
  const left = remainingMs(endsAt, offset, now);

  // Fixed per deadline: re-deriving these every tick would restart the animation.
  const drain = useMemo(() => {
    const ms = remainingMs(endsAt, offset);
    const total = startedAt !== undefined ? endsAt - startedAt : ms;
    return { ms, from: total > 0 ? Math.min(1, ms / total) : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, startedAt, paused]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      {bar ? (
        <div style={{ flex: 1, height: 10, background: CELL, borderRadius: 5, overflow: "hidden" }}>
          <div
            key={endsAt}
            data-cw-anim=""
            data-testid="cw-countdown-bar"
            style={
              {
                height: "100%",
                background: ACCENT,
                transformOrigin: "left center",
                transform: `scaleX(${drain.from})`,
                "--cw-from": String(drain.from),
                animation: `cwDrain ${drain.ms}ms linear forwards`,
                animationPlayState: paused ? "paused" : "running",
              } as CSSProperties
            }
          />
        </div>
      ) : null}
      <div
        data-testid="cw-countdown"
        style={{ color: INK, fontFamily: MONO, fontSize, minWidth: fontSize * 2.6, textAlign: "right" }}
      >
        {paused ? "PAUSED" : formatClock(left)}
      </div>
    </div>
  );
}
