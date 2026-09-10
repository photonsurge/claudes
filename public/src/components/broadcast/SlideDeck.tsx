"use client";

/**
 * The one rotator for the on-air LEFT COLUMN's mode/context cards. Given an
 * ordered list of slides (already content-filtered by `modeSlides` — see
 * ./mode-slides), it cross-fades through them on a single timer and shows a
 * small page-dot indicator so viewers know there's more.
 *
 * This replaces the hand-wired `usePagedSlides` + `display:none` page toggles
 * that BroadcastFrame used to spell out per segment kind. Like that old code, a
 * slide that has aired STAYS mounted (we toggle opacity, never unmount it) so
 * each panel's own featured-city cycle / fetched data / climate timers survive
 * a rotation instead of resetting every few seconds.
 *
 * What it no longer does is mount EVERY slide the moment a segment cuts in
 * (docs/watch-perf-plan.md, round 49). On OBS's CEF the cut was paying for the
 * whole deck at once — 300–500 fresh layout objects for 5–8 cards, one of them
 * visible — and a first layout of new nodes costs ~0.13 ms each on that box, so
 * the cut's chrome commit alone was 40–65 ms of layout, and it happened twice
 * (the cut, then the deck swap behind FadeSwap). Now a slide mounts when it
 * first becomes the on-air slide OR the one up next (so its fetches still get a
 * whole hold to land before it airs), and once mounted it stays. The rest of
 * the deck fills in one slide per rotation, a hold apart, instead of all at the
 * cut. A new segment (`resetKey`) starts a fresh lazy deck.
 *
 * Mounted off-air slides sit under `content-visibility: hidden`: their DOM is
 * kept (state, timers, fetched data all survive), but the engine skips their
 * layout and paint, so a hidden card's own churn — a featured-city cycle, a
 * feed refresh — costs no layout of the document. The one exception is the
 * slide fading OUT, which has to keep rendering to be seen fading; it drops to
 * hidden on the next rotation. Pure presentation inside the scaled broadcast
 * stage; pointer-inert.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { pageDotStyle, pageDotsSlack } from "./page-dots";
import { CARD_W, MUTED, DeckChromeContext, DeckSlideActiveContext, type DeckChrome } from "./BroadcastCard";
import { GODS_BORDER } from "./GodsPanel";

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

/** GODS-style page squares (the active one stretches), matching the top-right
 *  WORLD REPORT deck's indicator. Positioned to clear the card's chamfered
 *  top-right corner. */
function Dots({ count, active, accent }: { count: number; active: number; accent: string }) {
  return (
    <div style={{ position: "absolute", top: 20, right: 26 + pageDotsSlack(5, 14), display: "flex", gap: 5, alignItems: "center" }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={pageDotStyle(i, active, 5, 14, accent, GODS_BORDER, FADE_MS)} />
      ))}
    </div>
  );
}

/** Wrapper style per slide role. Only the on-air slide is in flow (it sizes the
 *  deck); everything else is stacked absolutely underneath at opacity 0. */
function slideStyle(role: "active" | "leaving" | "hidden"): CSSProperties {
  if (role === "active") return { position: "relative", opacity: 1, transition: `opacity ${FADE_MS}ms ease` };
  const off: CSSProperties = { position: "absolute", inset: 0, opacity: 0, transition: `opacity ${FADE_MS}ms ease`, pointerEvents: "none" };
  // Skipped by layout + paint until it airs (or fades out) — see the header.
  if (role === "hidden") off.contentVisibility = "hidden";
  return off;
}

export default function SlideDeck({
  slides,
  width = CARD_W,
  holdMs = HOLD_MS,
  dotColor = MUTED,
  chrome = null,
  resetKey,
}: {
  slides: DeckSlide[];
  width?: number;
  holdMs?: number;
  /** Active-dot colour — pass the segment's kind accent to match the card. */
  dotColor?: string;
  /** Shared template (event-type badge + title, fixed size) applied to every
   *  slide via context, so the whole deck reads as one card. */
  chrome?: DeckChrome | null;
  /** Rewinds the deck to the first slide whenever this changes. Pass the on-air
   *  segment id so cutting to a new thing/place always opens on slide 0 instead
   *  of wherever the previous segment's rotation had landed. */
  resetKey?: string;
}) {
  const count = slides.length;
  const [idx, setIdx] = useState(0);
  // Slides that have been on air or up next since the last reset — mounted and
  // kept. The id of the slide that just left the air is remembered so it can
  // finish its out-fade before going hidden.
  const deck = useRef<{ mounted: Set<string>; activeId: string | null; leavingId: string | null }>({
    mounted: new Set(),
    activeId: null,
    leavingId: null,
  });

  // New segment/place → back to the top of the deck, with a fresh lazy deck.
  // Done during render (not in an effect) so the first commit of the new
  // segment already shows slide 0 and mounts only what slide 0 needs — an
  // effect would first commit the previous rotation's index against the new
  // slide list, mounting two extra cards for one frame. React re-runs this
  // render straight away with the reset state; `position` is what THIS pass
  // uses, so the discarded pass and the real one mount the same slides.
  const [seenKey, setSeenKey] = useState(resetKey);
  let position = idx;
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setIdx(0);
    deck.current = { mounted: new Set(), activeId: null, leavingId: null };
    position = 0;
  }

  useEffect(() => {
    if (count <= 1) return;
    const iv = setInterval(() => setIdx((n) => n + 1), holdMs);
    return () => clearInterval(iv);
  }, [count, holdMs]);

  if (count === 0) return null;
  const active = position % count;
  // Single slide: no rotation, no dots, no crossfade layers needed — still wrap
  // in the provider so it wears the same template. It's always the on-air slide,
  // so the default-true active context is correct (no per-slide provider needed).
  if (count === 1) return <DeckChromeContext.Provider value={chrome}>{slides[0].node}</DeckChromeContext.Provider>;

  const activeId = slides[active].id;
  const nextId = slides[(active + 1) % count].id;
  const d = deck.current;
  if (d.activeId !== activeId) {
    d.leavingId = d.activeId;
    d.activeId = activeId;
  }
  d.mounted.add(activeId);
  d.mounted.add(nextId);

  return (
    <DeckChromeContext.Provider value={chrome}>
      <div style={{ position: "relative", width }}>
        {slides.map((s, i) => {
          if (!d.mounted.has(s.id)) return null;
          const role = i === active ? "active" : s.id === d.leavingId ? "leaving" : "hidden";
          return (
            <div key={s.id} aria-hidden={i !== active} style={slideStyle(role)}>
              {/* Tell the slide whether it's on air so its body resets to the top
                  when it airs and doesn't auto-scroll while it waits off-screen. */}
              <DeckSlideActiveContext.Provider value={i === active}>{s.node}</DeckSlideActiveContext.Provider>
            </div>
          );
        })}
        <Dots count={count} active={active} accent={dotColor} />
      </div>
    </DeckChromeContext.Provider>
  );
}
