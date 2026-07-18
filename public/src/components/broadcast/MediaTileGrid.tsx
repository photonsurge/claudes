"use client";

/**
 * The shared "webcam-tiles" grid for the on-air media slides — a 2-column grid of
 * thumbnails (cover-cropped, like the volcano camera overview) with a small title
 * and caption under each. It's the one layout the satellite and products slides
 * share so every media surface reads the same on air.
 *
 * Presentation only: callers hand it tiles built from the arrays already on the
 * focus bundle (snapshots / volcano media). No fetching, no cap — the card body
 * scrolls and the deck rotates, so we show every tile.
 */
import { CardSection, DIM } from "./BroadcastCard";

export type MediaTile = {
  key: string;
  src?: string;
  title?: string;
  caption?: string;
};

export default function MediaTileGrid({
  tiles,
  eyebrow,
  first = false,
}: {
  tiles: MediaTile[];
  eyebrow?: string;
  first?: boolean;
}) {
  if (!tiles.length) return null;
  return (
    <CardSection first={first} eyebrow={eyebrow}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {tiles.map((t) => (
          <div key={t.key} style={{ minWidth: 0 }}>
            {t.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.src}
                alt={t.title ?? ""}
                style={{ width: "100%", height: 92, objectFit: "cover", borderRadius: 5, background: "#070a11", display: "block" }}
              />
            ) : (
              <div style={{ width: "100%", height: 92, borderRadius: 5, background: "#141b28" }} />
            )}
            {t.title ? (
              <div style={{ fontSize: 9.9, color: "#8ea3bf", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.title}
              </div>
            ) : null}
            {t.caption ? (
              <div style={{ fontSize: 9, color: DIM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.caption}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </CardSection>
  );
}
