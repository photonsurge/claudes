"use client";

/** LATEST: the last few solves, newest first. Lines arrive; nothing scrolls. */
import type { CrosswordFeedItem } from "@photonsurge/shared/crossword";
import { EYEBROW, INK_DIM, INK_FAINT, SANS, TEXT_INK } from "./styles";

export default function SolveFeed({ feed, limit = 4 }: { feed: CrosswordFeedItem[]; limit?: number }) {
  const items = feed.slice(-limit).reverse();
  return (
    <div style={{ flex: 1.3, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ ...EYEBROW, fontSize: 16 }}>Latest</div>
      {items.length === 0 ? <div style={{ color: INK_FAINT, fontFamily: SANS, fontSize: 18 }}>—</div> : null}
      {items.map((f, i) => (
        <div
          key={`${f.at}-${f.text}`}
          data-cw-anim=""
          style={{
            color: i === 0 ? TEXT_INK : INK_DIM,
            fontFamily: SANS,
            fontSize: 18,
            lineHeight: 1.25,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            animation: i === 0 ? "cwLand 0.4s ease-out both" : undefined,
          }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}
