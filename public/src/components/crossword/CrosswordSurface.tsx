"use client";

/**
 * The crossword frame, laid out on a 1920×1080 stage (§5 of the plan):
 *
 *   header   brand · CROSSWORD     Puzzle 42 · Title      7 of 14 solved
 *   body     grid | spotlight / clue list / scores + latest
 *   footer   how to play
 *
 * The phase picks the body: the title card for `intro`, the holding card for
 * `idle` (and before the first state lands), the grid with the podium for
 * `finale`. Pure layout: everything it draws comes in as props.
 */
import type { ReactNode } from "react";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";
import ClueList from "./ClueList";
import FinaleCard from "./FinaleCard";
import Grid from "./Grid";
import HoldingCard from "./HoldingCard";
import HowToStrip from "./HowToStrip";
import IntroCard from "./IntroCard";
import Scoreboard from "./Scoreboard";
import SolveFeed from "./SolveFeed";
import SpotlightCard from "./SpotlightCard";
import { BODY_H, BODY_TOP, BOTTOM_H, FOOTER_H, FRAME_H, FRAME_W, GAP, GRID_COL_W, GRID_PAD, HEADER_H, MAX_CELL, PAD, RIGHT_GAP, RIGHT_W, RIGHT_X, SPOT_H } from "./layout";
import { ACCENT, EYEBROW, INK, INK_DIM, KEYFRAMES, LIVE, MONO, PLATE, SANS } from "./styles";

/** The biggest cell (up to 64 px) that fits a width × height grid in the grid column. */
export function cellSize(width: number, height: number): number {
  if (width <= 0 || height <= 0) return MAX_CELL;
  return Math.max(
    16,
    Math.min(MAX_CELL, Math.floor((GRID_COL_W - GRID_PAD * 2) / width), Math.floor((BODY_H - GRID_PAD * 2) / height)),
  );
}

export interface CrosswordSurfaceProps {
  state: CrosswordPublicState | null;
  offset: number;
  /** The channel's brand name (theme.brand.title). */
  brand: string;
  /** The channel's logo (theme.brand.logoUrl); "" or absent for none. */
  logoUrl?: string;
}

export default function CrosswordSurface({ state, offset, brand, logoUrl }: CrosswordSurfaceProps) {
  const s = state;
  const hasPuzzle = !!s && s.phase !== "idle" && s.width > 0;
  const solvedCount = s ? s.entries.filter((e) => e.solved).length : 0;
  const spotEntry = s?.spotlight ? s.entries.find((e) => e.id === s.spotlight!.entryId) ?? null : null;

  let body: ReactNode;
  if (!s || !hasPuzzle) {
    body = (
      <div style={{ ...centred }}>
        <HoldingCard brand={brand} />
      </div>
    );
  } else if (s.phase === "intro") {
    body = (
      <div style={{ ...centred }}>
        <IntroCard
          puzzleNo={s.puzzleNo}
          title={s.title}
          words={s.entries.length}
          phaseEndsAt={s.phaseEndsAt}
          offset={offset}
          paused={s.paused}
        />
      </div>
    );
  } else {
    const cell = cellSize(s.width, s.height);
    body = (
      <>
        <div
          style={{
            ...PLATE,
            position: "absolute",
            left: PAD,
            top: 0,
            width: GRID_COL_W,
            height: BODY_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Grid
            rows={s.rows}
            entries={s.entries}
            spotlightId={s.phase === "playing" ? s.spotlight?.entryId : null}
            cell={cell}
            puzzleKey={s.puzzleNo}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: RIGHT_X,
            top: 0,
            width: RIGHT_W,
            height: BODY_H,
            display: "flex",
            flexDirection: "column",
            gap: RIGHT_GAP,
          }}
        >
          {s.phase === "finale" ? (
            <FinaleCard
              puzzleNo={s.puzzleNo}
              entries={s.entries}
              scores={s.scores}
              phaseEndsAt={s.phaseEndsAt}
              offset={offset}
              paused={s.paused}
            />
          ) : (
            <>
              <div style={{ height: SPOT_H, flex: "0 0 auto" }}>
                <SpotlightCard entry={spotEntry} spotlight={s.spotlight} rows={s.rows} offset={offset} paused={s.paused} />
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <ClueList entries={s.entries} spotlightId={s.spotlight?.entryId} />
              </div>
              <div style={{ ...PLATE, height: BOTTOM_H, flex: "0 0 auto", padding: "12px 24px", display: "flex", gap: 28 }}>
                <Scoreboard scores={s.scores} today={s.today} />
                <SolveFeed feed={s.feed} />
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <div style={{ position: "relative", width: FRAME_W, height: FRAME_H, overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>
      <header
        style={{
          ...PLATE,
          position: "absolute",
          left: PAD,
          top: PAD,
          width: FRAME_W - PAD * 2,
          height: HEADER_H,
          padding: "0 28px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div style={{ ...EYEBROW, fontSize: 22, color: INK, display: "flex", alignItems: "center", gap: 14 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img data-testid="cw-logo" src={logoUrl} alt="" style={{ height: 44, width: "auto", objectFit: "contain" }} />
          ) : null}
          <span>
          {brand} <span style={{ color: ACCENT }}>· Crossword</span>
          </span>
        </div>
        <div style={{ color: INK, fontFamily: SANS, fontSize: 28, fontWeight: 500, whiteSpace: "nowrap" }}>
          {hasPuzzle && s ? (
            <>
              <span style={{ color: ACCENT }}>Puzzle {s.puzzleNo}</span> · {s.title}
            </>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 18 }}>
          {s?.paused ? (
            <span
              data-testid="cw-paused"
              style={{ border: `1px solid ${LIVE}`, color: LIVE, fontFamily: MONO, fontSize: 18, letterSpacing: 2, padding: "4px 10px", borderRadius: 4 }}
            >
              PAUSED
            </span>
          ) : null}
          {hasPuzzle && s ? (
            <span style={{ color: INK_DIM, fontFamily: SANS, fontSize: 24 }}>
              <span style={{ color: INK }}>{solvedCount}</span> of {s.entries.length} solved
            </span>
          ) : null}
        </div>
      </header>
      <div style={{ position: "absolute", left: 0, top: BODY_TOP, width: FRAME_W, height: BODY_H }}>{body}</div>
      <div style={{ position: "absolute", left: PAD, top: FRAME_H - PAD - FOOTER_H, width: FRAME_W - PAD * 2, height: FOOTER_H }}>
        <HowToStrip inputLive={!!s?.inputLive} />
      </div>
    </div>
  );
}

const centred = {
  position: "absolute" as const,
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
