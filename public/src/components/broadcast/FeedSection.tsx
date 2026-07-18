"use client";

/**
 * The "ACTIVE FEED" header + scrolling body as one block, so every deck slide
 * carries the feed *inside* its own card instead of some slides integrating it
 * and others stacking a separate WorldWatchPanel below. Just the label rule and
 * the WorldFeed marquee — the surrounding card chrome belongs to the caller.
 */
import type { WorldWatchItem } from "../../lib/broadcast";
import type { BroadcastTheme } from "./config";
import WorldFeed from "./WorldFeed";

export default function FeedSection({
  feed,
  theme,
  visible = 5,
  emptyLabel,
}: {
  feed: WorldWatchItem[];
  theme: BroadcastTheme;
  /** Rows shown before the feed starts marqueeing. */
  visible?: number;
  emptyLabel?: string;
}) {
  return (
    <>
      <div
        style={{
          fontSize: 12.1,
          fontWeight: 800,
          letterSpacing: 1.6,
          color: theme.accent,
          borderBottom: `2px solid ${theme.accent}55`,
          paddingBottom: 4,
        }}
      >
        ACTIVE FEED
      </div>
      <WorldFeed items={feed} visible={visible} emptyLabel={emptyLabel} />
    </>
  );
}
