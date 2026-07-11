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
import { accentBorder, DEFAULT_THEME, type BroadcastTheme } from "./config";

/** One column width so the stacked cards share clean left/right edges. */
export const CARD_W = 420;
/** Fixed card height in the on-air deck so every rotating slide is the SAME size
 *  (no jump as the deck cross-fades); overlong bodies scroll inside. */
export const CARD_H = 520;

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
}
export const DeckChromeContext = createContext<DeckChrome | null>(null);

/** Shared ink tokens — every left-column panel drew from these ad-hoc before. */
export const INK = "#e6edf7";
export const MUTED = "#9fb3cc";
export const DIM = "#8ea3bf";
export const DIVIDER = "1px solid rgba(120,140,170,0.15)";
export const ON_AIR_RED = "#ff3b3b";

/** Standard `▸ SECTION` micro-label used for card + sub-section headers. */
export function CardEyebrow({ children, color = MUTED }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase", color }}>
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
  eyebrowColor = MUTED,
  headerRight,
  width = CARD_W,
  theme = DEFAULT_THEME,
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
  children: ReactNode;
  style?: CSSProperties;
}) {
  const chrome = useContext(DeckChromeContext);
  const stripe = chrome?.accent ?? accent ?? theme.accent;

  // Inside the on-air deck: render the shared template — event-type badge + event
  // title header (no ON AIR), fixed size, scrolling body — instead of the panel's
  // own badge/eyebrow header, so every slide reads identically and only the body
  // changes. The panel's `children` (incl. its inner CardSection eyebrows) render
  // in the scroll area untouched.
  if (chrome) {
    return (
      <div
        style={{
          width,
          height: chrome.height ?? CARD_H,
          display: "flex",
          flexDirection: "column",
          background: theme.panelBg,
          ...accentBorder(theme.panelBorder, `4px solid ${stripe}`),
          borderRadius: 14,
          boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          pointerEvents: "none",
          fontFamily: "system-ui, sans-serif",
          color: INK,
          overflow: "hidden",
          // NB: the template deliberately does NOT spread the panel's `style` —
          // it owns the uniform size, so a panel's own `width`/`padding` override
          // (e.g. ForecastPanel's `width:"auto"`) can't break the fixed template.
        }}
      >
        <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 1,
              textTransform: "uppercase",
              padding: "3px 10px",
              borderRadius: 5,
              background: chrome.badgeColor ?? stripe,
              color: "#fff",
            }}
          >
            {chrome.badge}
          </span>
          {chrome.title ? (
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                lineHeight: 1.14,
                marginTop: 8,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {chrome.title}
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 20px 16px" }}>{children}</div>
      </div>
    );
  }

  const hasBadgeRow = badge != null || live;
  const hasEyebrowRow = eyebrow != null || headerRight != null;

  return (
    <div
      style={{
        width,
        padding: "14px 20px",
        background: theme.panelBg,
        ...accentBorder(theme.panelBorder, `4px solid ${stripe}`),
        borderRadius: 14,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: INK,
        ...style,
      }}
    >
      {live ? <style>{"@keyframes bcast-onair{0%,100%{opacity:1}50%{opacity:0.4}}"}</style> : null}

      {hasBadgeRow ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {badge != null ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: 5,
                background: badgeColor ?? stripe,
                color: "#fff",
              }}
            >
              {badge}
            </span>
          ) : null}
          {live ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: MUTED }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: ON_AIR_RED, animation: "bcast-onair 1.4s ease-in-out infinite" }} />
              ON AIR
            </span>
          ) : null}
        </div>
      ) : null}

      {hasEyebrowRow ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          {eyebrow != null ? <CardEyebrow color={eyebrowColor}>▸ {eyebrow}</CardEyebrow> : null}
          {headerRight != null ? <div style={{ marginLeft: "auto" }}>{headerRight}</div> : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
