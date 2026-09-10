"use client";

/**
 * G.O.D.S. panel chrome — the chamfered HUD plate language the masthead banner
 * (GodsBanner) established, lifted out as shared furniture for the map legend
 * and the top-right WORLD REPORT deck: one border+fill shell (GodsPanel) plus
 * the header / section-rule / footer / headline pieces from the design sheet,
 * all on the banner's Saira + JetBrains Mono type ramp. Data colours (severity
 * ramps, palette colours) stay with the callers — this file owns only chrome.
 */
import type { CSSProperties, ReactNode } from "react";
import { pageDotStyle, pageDotsSlack } from "./page-dots";

// No flag face listed here on purpose: globals.css re-declares `Saira` and
// `JetBrains Mono` over `unicode-range: U+1F1E6-1F1FF` pointing at our
// self-hosted flag subset, which EXTENDS both families with flag glyphs. So
// every `fontFamily: SANS | MONO` on air (and GodsBanner's SVG <text>) draws
// country flags without the encoder box owning an emoji font — see
// public/src/lib/fonts.ts for why that matters.
export const SANS = "Saira, 'Helvetica Neue', Helvetica, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/** Default accent when no theme colour is passed — the banner's cyan. */
export const GODS_ACCENT = "#3fd0ff";
export const GODS_BORDER = "var(--gods-border, #1d4354)";
export const GODS_FILL =
  "linear-gradient(180deg, var(--gods-panel-top, #0e1e29) 0%, var(--gods-panel-mid, #081420) 60%, var(--gods-panel-bottom, #0a1a24) 100%)";
export const INK = "var(--gods-title, #e9f3f7)";
export const TEXT_INK = "var(--gods-text, #c4d6de)";
export const INK_DIM = "var(--gods-muted, #9fb8c4)";
export const INK_FAINT = "var(--gods-dim, #7f9dab)";
/** Inset tile / feed-row fill + hairline that sit ON the panel fill. */
export const GODS_TILE = "var(--gods-tile, #0b1a24)";
export const GODS_TILE_BORDER = "var(--gods-tile-border, #163241)";

const KEYFRAMES = `@keyframes gpPulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){[data-gods-pulse]{animation:none !important}}`;

/** Accent hairline fading out to the right — header + section rules. */
export function accentRule(accent: string): string {
  return `linear-gradient(90deg, ${accent}80, ${accent}0d)`;
}

/** clip-path polygon for the chamfered plate corners: [small, large] in px.
 *  Exported for shells that need bespoke internals (the deck card's fixed
 *  height + scroll body) but the same silhouette. */
export function chamfer(a: number, b: number): string {
  return `polygon(0 ${a}px, ${a}px 0, calc(100% - ${b}px) 0, 100% ${b}px, 100% calc(100% - ${a}px), calc(100% - ${a}px) 100%, ${b}px 100%, 0 calc(100% - ${b}px))`;
}

/* ------------------------------------------------------------------ shell */

export interface GodsPanelProps {
  children: ReactNode;
  /** Corner chamfer sizes in px: [small, large]. */
  notch?: [number, number];
  /** Translucent shell for overlays that should leave the map visible. */
  glass?: boolean;
  padding?: string;
  width?: number | string;
  gap?: number;
  className?: string;
  style?: CSSProperties;
}

/** Chamfered container with the banner's border + fill. clip-path swallows a
 *  box-shadow, and there is no drop-shadow filter on the wrapper either: a
 *  shadow under a plate tints the globe beneath it (a ~25% black wash fading
 *  out over ~40px), which read on air as a faint dark box behind every UI
 *  element — the plates sit flat on the map instead. */
export function GodsPanel({
  children,
  notch = [16, 26],
  glass = false,
  padding = "22px 26px 24px",
  width,
  gap = 18,
  className,
  style,
}: GodsPanelProps) {
  const clip = chamfer(notch[0], notch[1]);
  return (
    <div
      className={className}
      style={{
        width,
        fontFamily: SANS,
        ...style,
      }}
    >
      <style>{KEYFRAMES}</style>
      <div style={{ background: glass ? "rgba(65, 126, 149, 0.25)" : GODS_BORDER, clipPath: clip, padding: 1.6 }}>
        <div
          style={{
            background: glass ? "rgba(6, 18, 28, 0.72)" : GODS_FILL,
            clipPath: clip,
            padding,
            display: "flex",
            flexDirection: "column",
            gap,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export interface GodsPanelHeaderProps {
  title: string;
  /** Right-hand mono tag, e.g. "LAST 24H". */
  tag?: string;
  /** Pulsing accent square on the left. */
  pulse?: boolean;
  accent?: string;
}

export function GodsPanelHeader({ title, tag, pulse = true, accent = GODS_ACCENT }: GodsPanelHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {pulse && (
        <div
          data-gods-pulse=""
          style={{
            width: 9,
            height: 9,
            flex: "0 0 auto",
            background: accent,
            animation: "gpPulse 1.8s ease-in-out infinite",
            // Own compositor layer: CEF ticks this on the main thread; without
            // a layer every pulse step repaints (docs/watch-perf-plan.md, round 10).
            willChange: "opacity",
          }}
        />
      )}
      <div style={{ color: INK, fontSize: 19, fontWeight: 600, letterSpacing: 4, whiteSpace: "nowrap" }}>
        {title}
      </div>
      <div style={{ flex: 1, height: 1, background: GODS_BORDER }} />
      {tag && (
        <div style={{ color: accent, fontFamily: MONO, fontSize: 12, letterSpacing: 1.4, whiteSpace: "nowrap" }}>
          {tag}
        </div>
      )}
    </div>
  );
}

/** Section rule, e.g. "ACTIVE FEED". */
export function GodsSectionRule({ label, accent = GODS_ACCENT }: { label: string; accent?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ color: accent, fontSize: 14, fontWeight: 600, letterSpacing: 3.4, whiteSpace: "nowrap" }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: accentRule(accent) }} />
    </div>
  );
}

export interface GodsPanelFooterProps {
  note?: string;
  /** Page dots: total count and the active index. */
  pages?: number;
  activePage?: number;
  accent?: string;
}

export function GodsPanelFooter({ note, pages = 0, activePage = 0, accent = GODS_ACCENT }: GodsPanelFooterProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      {note && <div style={{ color: INK_FAINT, fontFamily: MONO, fontSize: 11.5, letterSpacing: 1.2 }}>{note}</div>}
      {pages > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto", marginRight: pageDotsSlack(6, 18) }}>
          {Array.from({ length: pages }, (_, i) => (
            <span key={i} style={pageDotStyle(i, activePage, 6, 18, accent, GODS_BORDER, 300)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Big headline number with a caption and an optional note on the right. */
export function GodsHeadline({
  value,
  caption,
  note,
  captionColor = GODS_ACCENT,
}: {
  value: string | number;
  caption: string;
  note?: string;
  captionColor?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ color: TEXT_INK, fontSize: 58, fontWeight: 300, lineHeight: 0.9, letterSpacing: -1 }}>
          {value}
        </div>
        <div style={{ color: captionColor, fontSize: 14, fontWeight: 500, letterSpacing: 4, marginTop: 6 }}>
          {caption}
        </div>
      </div>
      {note && (
        <div style={{ maxWidth: 236, textAlign: "right", color: INK_DIM, fontSize: 14.5, lineHeight: 1.45 }}>
          {note}
        </div>
      )}
    </div>
  );
}
