"use client";

/**
 * A broadcast crawl: an optional title chip pinned to the left and the live feed
 * scrolling seamlessly beside it. The content is rendered twice and the track
 * slides by exactly half its width, so the loop is gapless; speed is derived
 * from content length so a short feed doesn't whip past. Pure CSS animation —
 * no rAF.
 *
 * Entries are plain strings, or `{ text, ad: true }` sponsored mentions (see
 * lib/broadcast's weaveSponsors) rendered in the accent ink behind a small AD
 * tag — clearly sponsor, never disguised as a feed line.
 */
import { Fragment } from "react";
import type { TickerEntry } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

const SEPARATOR = "❯";
const STANDBY = "STANDING BY · AWAITING LIVE FEED";

const entryText = (e: TickerEntry): string => (typeof e === "string" ? e : e.text);

/** One copy of the crawl content — items with separators between them. */
function CrawlContent({ entries, theme }: { entries: TickerEntry[]; theme: BroadcastTheme }) {
  return (
    <span style={{ paddingLeft: 24 }}>
      {entries.map((e, i) => (
        <Fragment key={i}>
          {i > 0 && <span style={{ padding: "0 20px", opacity: 0.7 }}>{SEPARATOR}</span>}
          {typeof e === "string" ? (
            <span>{e}</span>
          ) : (
            <span style={{ color: theme.accent, fontWeight: 800 }}>
              <span
                style={{
                  display: "inline-block",
                  border: `1px solid ${theme.accent}`,
                  borderRadius: 3,
                  padding: "0px 4px",
                  marginRight: 8,
                  fontSize: "0.75em",
                  letterSpacing: 1.2,
                  verticalAlign: "1px",
                }}
              >
                AD
              </span>
              {e.text}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

export default function Ticker({
  title,
  items,
  edge,
  height = 30,
  compact = false,
  insetLeft = 0,
  offset = 0,
  contentInset = 0,
  theme = DEFAULT_THEME,
}: {
  /** Title chip text; null/empty renders no chip (a bare band). */
  title?: string | null;
  items: TickerEntry[];
  /** Which edge to pin to. */
  edge: "top" | "bottom";
  height?: number;
  compact?: boolean;
  /** Start the band this far from the left edge — the top crawl uses it to
   *  begin AFTER the masthead brand block instead of running underneath it. */
  insetLeft?: number;
  /** Push the band this far in from its pinned edge — the top crawl uses it to
   *  slide down beneath the masthead banner instead of hugging the very top. */
  offset?: number;
  /** Clip the crawl TEXT to start this far into the band while the band itself
   *  still spans full width — the top crawl uses it (chip-less) to run behind
   *  the masthead banner, with the text sliding out from behind the graphic's
   *  right edge instead of a hard chip terminus. Measured from the band's own
   *  left edge; meant for the chip-less mode. */
  contentInset?: number;
  theme?: BroadcastTheme;
}) {
  const entries: TickerEntry[] = items.length ? items : [STANDBY];
  const line = entries.map(entryText).join(`     ${SEPARATOR}     `);
  // Seconds for one full cycle — ~7 chars/sec, floored so short feeds still move.
  const dur = Math.max(24, line.length * 0.16);
  const fontSize = compact ? 10 : 12;

  return (
    <div
      style={{
        position: "absolute",
        left: insetLeft,
        right: 0,
        [edge]: offset,
        height,
        display: "flex",
        alignItems: "center",
        background: theme.tickerBg,
        borderBottom: edge === "top" ? "1px solid rgba(120,140,170,0.2)" : undefined,
        // A band floating below the masthead (offset top crawl) is framed on
        // both edges; one pinned to the screen edge only needs the inner line.
        borderTop:
          edge === "bottom" || offset > 0
            ? "1px solid rgba(120,140,170,0.2)"
            : undefined,
        overflow: "hidden",
        color: theme.tickerText,
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <style>{"@keyframes bcast-crawl{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      {/* Title chip (optional) */}
      {title ? (
        <div
          style={{
            flex: "0 0 auto",
            zIndex: 2,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: compact ? "0 8px" : "0 12px",
            fontSize: compact ? 9.9 : 12.1,
            fontWeight: 800,
            letterSpacing: 1.4,
            color: "#fff",
            background: theme.accent,
            clipPath: "polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)",
            paddingRight: compact ? 16 : 20,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      ) : null}
      {/* Crawl */}
      <div
        style={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          height: "100%",
          marginLeft: contentInset,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            display: "inline-flex",
            alignItems: "center",
            height: "100%",
            whiteSpace: "nowrap",
            animation: `bcast-crawl ${dur}s linear infinite`,
            fontSize,
            fontWeight: 600,
            letterSpacing: 0.6,
          }}
        >
          <CrawlContent entries={entries} theme={theme} />
          <CrawlContent entries={entries} theme={theme} />
        </div>
      </div>
    </div>
  );
}
