"use client";

/**
 * The "ACTIVE FEED" header + scrolling body as one block, so every deck slide
 * carries the feed *inside* its own card instead of some slides integrating it
 * and others stacking a separate WorldWatchPanel below. Just the section rule
 * (shared G.O.D.S. chrome) and the WorldFeed marquee — the surrounding card
 * chrome belongs to the caller.
 */
import type { WorldWatchItem } from "../../lib/broadcast";
import type { BroadcastTheme } from "./config";
import { GodsSectionRule } from "./GodsPanel";
import WorldFeed from "./WorldFeed";

export default function FeedSection({
  feed,
  theme,
  visible = 5,
  emptyLabel,
  paceDeck = true,
}: {
  feed: WorldWatchItem[];
  theme: BroadcastTheme;
  /** Rows shown before the feed starts marqueeing. */
  visible?: number;
  emptyLabel?: string;
  /** Let the marquee own the enclosing WORLD REPORT slide's clock — the deck
   *  turns the page after a whole lap of this feed rather than on a blind dwell
   *  (see ./run-pacing). On by default: every FeedSection lives in a deck slide,
   *  and outside one the run-pacing context is null, so nothing is claimed. */
  paceDeck?: boolean;
}) {
  return (
    <>
      <GodsSectionRule label="ACTIVE FEED" accent={theme.accent} />
      <WorldFeed items={feed} visible={visible} emptyLabel={emptyLabel} paceDeck={paceDeck} />
    </>
  );
}
