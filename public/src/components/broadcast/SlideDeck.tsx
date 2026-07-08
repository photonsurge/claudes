"use client";

/**
 * The one rotator for the on-air LEFT COLUMN's mode/context cards. Given an
 * ordered list of slides (already content-filtered by `modeSlides` — see
 * ./mode-slides), it cross-fades through them on a single timer and shows a
 * small page-dot indicator so viewers know there's more.
 *
 * This replaces the hand-wired `usePagedSlides` + `display:none` page toggles
 * that BroadcastFrame used to spell out per segment kind. Like that old code,
 * EVERY slide stays mounted (we toggle opacity, never mount/unmount) so each
 * panel's own featured-city cycle / fetched data / climate timers survive a
 * rotation instead of resetting every few seconds. Pure presentation inside the
 * scaled broadcast stage; pointer-inert.
 */
import { useEffect, useState, type ReactNode } from "react";
import { CARD_W, MUTED } from "./BroadcastCard";

/** One rotation position. `id` must be stable across renders so React keeps the
 *  slide mounted (and its internal state alive) as data streams in. */
export type DeckSlide = { id: string; node: ReactNode };

/** How long each slide holds before the deck advances — matches the old
 *  usePagedSlides SLIDE_HOLD_MS so the on-air cadence is unchanged. */
const HOLD_MS = 6000;
const FADE_MS = 600;

function Dots({ count, active, accent }: { count: number; active: number; accent: string }) {
  return (
    <div style={{ position: "absolute", top: 15, right: 18, display: "flex", gap: 5 }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: i === active ? accent : "rgba(159,179,204,0.3)",
            transition: `background ${FADE_MS}ms ease`,
          }}
        />
      ))}
    </div>
  );
}

export default function SlideDeck({
  slides,
  width = CARD_W,
  holdMs = HOLD_MS,
  dotColor = MUTED,
}: {
  slides: DeckSlide[];
  width?: number;
  holdMs?: number;
  /** Active-dot colour — pass the segment's kind accent to match the card. */
  dotColor?: string;
}) {
  const count = slides.length;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (count <= 1) return;
    const iv = setInterval(() => setIdx((n) => n + 1), holdMs);
    return () => clearInterval(iv);
  }, [count, holdMs]);

  if (count === 0) return null;
  const active = idx % count;
  // Single slide: no rotation, no dots, no crossfade layers needed.
  if (count === 1) return <>{slides[0].node}</>;

  return (
    <div style={{ position: "relative", width }}>
      {slides.map((s, i) => (
        <div
          key={s.id}
          aria-hidden={i !== active}
          style={
            i === active
              ? { position: "relative", opacity: 1, transition: `opacity ${FADE_MS}ms ease` }
              : { position: "absolute", inset: 0, opacity: 0, transition: `opacity ${FADE_MS}ms ease`, pointerEvents: "none" }
          }
        >
          {s.node}
        </div>
      ))}
      <Dots count={count} active={active} accent={dotColor} />
    </div>
  );
}
