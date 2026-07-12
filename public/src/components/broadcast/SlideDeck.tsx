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
import { CARD_W, MUTED, DeckChromeContext, DeckSlideActiveContext, type DeckChrome } from "./BroadcastCard";

/** One rotation position. `id` must be stable across renders so React keeps the
 *  slide mounted (and its internal state alive) as data streams in. */
export type DeckSlide = { id: string; node: ReactNode };

/** How long each slide holds before the deck advances. Slowed (6s → 10s → 16s)
 *  so later slides' content has time to finish opening (and overlong bodies —
 *  e.g. the tiled AREA HISTORY grid — have time to read/auto-scroll) before the
 *  deck moves on. */
const HOLD_MS = 16000;
/** Cross-fade duration between slides — a slow, gentle dissolve rather than a
 *  quick cut. */
const FADE_MS = 1200;

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
  chrome = null,
}: {
  slides: DeckSlide[];
  width?: number;
  holdMs?: number;
  /** Active-dot colour — pass the segment's kind accent to match the card. */
  dotColor?: string;
  /** Shared template (event-type badge + title, fixed size) applied to every
   *  slide via context, so the whole deck reads as one card. */
  chrome?: DeckChrome | null;
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
  // Single slide: no rotation, no dots, no crossfade layers needed — still wrap
  // in the provider so it wears the same template. It's always the on-air slide,
  // so the default-true active context is correct (no per-slide provider needed).
  if (count === 1) return <DeckChromeContext.Provider value={chrome}>{slides[0].node}</DeckChromeContext.Provider>;

  return (
    <DeckChromeContext.Provider value={chrome}>
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
            {/* Tell the slide whether it's on air so its body resets to the top
                when it airs and doesn't auto-scroll while it waits off-screen. */}
            <DeckSlideActiveContext.Provider value={i === active}>
              {s.node}
            </DeckSlideActiveContext.Provider>
          </div>
        ))}
        <Dots count={count} active={active} accent={dotColor} />
      </div>
    </DeckChromeContext.Provider>
  );
}
