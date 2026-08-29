"use client";

/**
 * The single card shell for the on-air LEFT COLUMN. Every context/event/mode
 * panel that used to roll its own container (OnAirCard's themed glass, or the
 * compact `rgba(8,13,22,.82)` report look QuakeReport/TrackInfo hardcoded)
 * renders inside this instead, so the whole column reads as one system: same
 * themed glass background, hairline border with a coloured accent stripe,
 * radius, drop shadow, blur, width, base ink + font.
 *
 * Header is optional and comes in two flavours (a panel usually picks one):
 *   • `badge` — a coloured kind chip, optionally with a pulsing ON AIR dot
 *     (the OnAirCard look), and
 *   • `eyebrow` — a `▸ SECTION` micro-label (the QuakeReport/TrackInfo look),
 *     with room for a right-aligned chip via `headerRight`.
 *
 * Body is `children`. Sub-sections divided by a hairline use <CardSection>.
 * Pure presentation inside the scaled broadcast stage; pointer-inert.
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { accentBorder, BASE_LOOK, GLASS_BG, type BroadcastTheme } from "./config";
import {
  chamfer,
  accentRule,
  SANS,
  GODS_BORDER,
  GODS_FILL,
  TEXT_INK as GODS_INK,
} from "./GodsPanel";
import { useBroadcastTheme } from "./theme-context";
import AutoScroll from "./AutoScroll";

/** One column width so the stacked cards share clean left/right edges. */
export const CARD_W = 420;
/** Fixed card height in the on-air deck so every rotating slide is the SAME size
 *  (no jump as the deck cross-fades); overlong bodies scroll inside.
 *  Trimmed from 520 — the old height left most slides with a big empty apron. */
export const CARD_H = 415;

/**
 * Per-deck "chrome" the on-air SlideDeck injects so every slide shares ONE
 * template: the same event-type badge + event title header (no ON AIR) and the
 * same fixed size. A BroadcastCard rendered inside a deck reads this from context
 * and renders that template header + a scrolling body, overriding whatever
 * per-panel badge/eyebrow/live it was constructed with — so the column reads as
 * one card whose body changes per slide. Null (the default) → the standalone card
 * look used off-deck (e.g. the operator console).
 */
export interface DeckChrome {
  /** Event-type label, e.g. "Seismic", "Aircraft", "Country". */
  badge: string;
  badgeColor?: string;
  /** Event title — the constant header repeated on every slide of the mode. */
  title?: string;
  accent?: string;
  height?: number;
  /** Persistent readout rendered INSIDE the card, between the title bar and the
   *  rotating body — the EVENT DETECTION OVERLAY rows ride here so they're part
   *  of the deck card itself (not a second floating plate) and stay on screen
   *  while the slides rotate beneath. Constant per deck, like badge/title. */
  tracking?: ReactNode;
}
export const DeckChromeContext = createContext<DeckChrome | null>(null);

/** Whether this card is the deck's currently on-air slide. SlideDeck sets it
 *  per-slide (all slides stay mounted); the template's auto-scroll uses it to
 *  reset to the top and hold when a slide airs, and to sit still while it waits
 *  off-screen. Default true so a standalone (non-deck) card scrolls normally. */
export const DeckSlideActiveContext = createContext<boolean>(true);

/** DEFAULT ink values (from the theme BASE_LOOK) — kept exported for the many
 *  panels that hardcode the default look. Themed code should prefer
 *  useBroadcastTheme() so per-channel overrides reach it. */
export const INK = BASE_LOOK.textColor;
export const MUTED = BASE_LOOK.mutedColor;
export const DIM = BASE_LOOK.dimColor;
export const DIVIDER = `1px solid ${GODS_BORDER}`;

/** Standard `▸ SECTION` micro-label used for card + sub-section headers.
 *  Un-tinted eyebrows follow the channel's muted ink. */
export function CardEyebrow({ children, color }: { children: ReactNode; color?: string }) {
  const theme = useBroadcastTheme();
  return (
    <div
      style={{
        fontSize: 11.3,
        fontWeight: 800,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: color ?? theme.mutedColor,
      }}
    >
      {children}
    </div>
  );
}

/** A sub-block within a card, separated from what's above it by a hairline
 *  (unless `first`), with an optional eyebrow label. */
export function CardSection({
  eyebrow,
  first = false,
  children,
  style,
}: {
  eyebrow?: ReactNode;
  first?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        marginTop: first ? 0 : 12,
        paddingTop: first ? 0 : 12,
        borderTop: first ? undefined : DIVIDER,
        ...style,
      }}
    >
      {eyebrow ? <div style={{ marginBottom: 6 }}><CardEyebrow>{eyebrow}</CardEyebrow></div> : null}
      {children}
    </div>
  );
}

export default function BroadcastCard({
  accent,
  badge,
  badgeColor,
  live = false,
  eyebrow,
  eyebrowColor,
  headerRight,
  width = CARD_W,
  theme: propTheme,
  glass = false,
  children,
  style,
}: {
  /** Left accent stripe colour — defaults to the theme accent. */
  accent?: string;
  /** Coloured kind chip in the header (e.g. "Country", "Seismic"). */
  badge?: string;
  /** Chip background — defaults to `accent`. */
  badgeColor?: string;
  /** Show the pulsing ON AIR dot beside the badge. */
  live?: boolean;
  /** `▸ SECTION` micro-header, when the panel has no kind chip. */
  eyebrow?: ReactNode;
  /** Eyebrow tint — defaults to the muted ink (e.g. gold for a VIP track). */
  eyebrowColor?: string;
  /** Right-aligned header content (e.g. a category chip). */
  headerRight?: ReactNode;
  width?: number;
  theme?: BroadcastTheme;
  /** Off-deck only: drop the coloured accent stripe and use a see-through glass
   *  fill (GLASS_BG) with a stronger blur — for panels that hang off the reticle
   *  and should read as light glass over the map rather than a solid card. */
  glass?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  // Prop wins; panels that pass no theme follow the channel's provider instead
  // of silently falling back to the default preset.
  const theme = useBroadcastTheme(propTheme);
  const chrome = useContext(DeckChromeContext);
  const slideActive = useContext(DeckSlideActiveContext);
  const stripe = chrome?.accent ?? accent ?? theme.accent;

  // Inside the on-air deck: render the shared template — event-type badge + event
  // title header (no ON AIR), fixed size, scrolling body — instead of the panel's
  // own badge/eyebrow header, so every slide reads identically and only the body
  // changes. The panel's `children` (incl. its inner CardSection eyebrows) render
  // in the scroll area untouched.
  if (chrome) {
    // The on-air deck card wears the shared G.O.D.S. chamfered chrome (see
    // GodsPanel): border + navy fill layers clipped to the same silhouette,
    // depth from a drop-shadow filter on the wrapper (clip-path swallows a
    // normal box-shadow). Hand-rolled rather than <GodsPanel> because the
    // template owns a fixed height with a scrolling body.
    const clip = chamfer(14, 22);
    return (
      <div
        style={{
          width,
          height: chrome.height ?? CARD_H,
          filter: "drop-shadow(0 10px 28px rgba(0,0,0,0.45))",
          pointerEvents: "none",
          fontFamily: SANS,
          color: GODS_INK,
          // NB: the template deliberately does NOT spread the panel's `style` —
          // it owns the uniform size, so a panel's own `width`/`padding` override
          // (e.g. ForecastPanel's `width:"auto"`) can't break the fixed template.
        }}
      >
        <div
          style={{
            background: GODS_BORDER,
            clipPath: clip,
            padding: 1.6,
            height: "100%",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              background: GODS_FILL,
              clipPath: clip,
              height: "100%",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* One-line title bar: badge chip + event title on a single row,
                closed by an accent hairline. The right padding clears the
                deck's page-dot indicator (top-right). */}
            <div style={{ flexShrink: 0, padding: "14px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 44 }}>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: 1.4,
                    textTransform: "uppercase",
                    padding: "3px 10px",
                    background: chrome.badgeColor ?? stripe,
                    color: "#fff",
                  }}
                >
                  {chrome.badge}
                </span>
                {chrome.title ? (
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 19.5,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {chrome.title}
                  </div>
                ) : null}
              </div>
              <div style={{ marginTop: 10, height: 1, background: accentRule(stripe) }} />
            </div>
            {/* The persistent tracking readout (EVENT DETECTION OVERLAY rows) —
                part of the card's fixed header, so only the slide body rotates
                below. */}
            {chrome.tracking ? <div style={{ flexShrink: 0 }}>{chrome.tracking}</div> : null}
            {/* Pointer-inert on air, so overlong bodies can't be hand-scrolled —
                AutoScroll walks them top→bottom→top; content that fits sits still.
                `active` resets it to the top when this slide airs (and holds it
                there while it waits off-screen), so a slide always loads scrolled
                to top. */}
            <AutoScroll
              active={slideActive}
              style={{ flex: 1, minHeight: 0, overflowY: "hidden", padding: "10px 20px 16px" }}
            >
              {children}
            </AutoScroll>
          </div>
        </div>
      </div>
    );
  }

  const hasBadgeRow = badge != null || live;
  const hasEyebrowRow = eyebrow != null || headerRight != null;

  return (
    // Standalone (off-deck) shell on the same G.O.D.S. surfaces as the deck
    // template — navy fill, square corners, hairline border (accent stripe kept
    // for non-glass callers). Rectangular rather than chamfered: this branch is
    // a single element whose callers override padding/width via `style`, which
    // the two-layer chamfer clip can't accommodate.
    <div
      style={{
        width,
        padding: "14px 20px",
        background: glass ? GLASS_BG : GODS_FILL,
        ...(glass
          ? { border: `1px solid ${GODS_BORDER}` }
          : accentBorder(`1px solid ${GODS_BORDER}`, `4px solid ${stripe}`)),
        borderRadius: 0,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: glass ? "blur(11px)" : undefined,
        WebkitBackdropFilter: glass ? "blur(11px)" : undefined,
        pointerEvents: "none",
        fontFamily: SANS,
        color: GODS_INK,
        ...style,
      }}
    >
      {live ? <style>{"@keyframes bcast-onair{0%,100%{opacity:1}50%{opacity:0.4}}"}</style> : null}

      {hasBadgeRow ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {badge != null ? (
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                padding: "3px 10px",
                background: badgeColor ?? stripe,
                color: "#fff",
              }}
            >
              {badge}
            </span>
          ) : null}
          {live ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.2, fontWeight: 800, letterSpacing: 1.2, color: theme.mutedColor }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: theme.liveColor, animation: "bcast-onair 1.4s ease-in-out infinite" }} />
              ON AIR
            </span>
          ) : null}
        </div>
      ) : null}

      {hasEyebrowRow ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          {eyebrow != null ? <CardEyebrow color={eyebrowColor ?? theme.mutedColor}>▸ {eyebrow}</CardEyebrow> : null}
          {headerRight != null ? <div style={{ marginLeft: "auto" }}>{headerRight}</div> : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
