"use client";

import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import BroadcastCard from "./BroadcastCard";
import MediaTileGrid from "./MediaTileGrid";

const src = (item: VolcanoMedia) => item.assetRef
  ? `/api/volcanoes/media/${encodeURIComponent(item.assetRef)}?v=${encodeURIComponent(item.contentHash ?? String(item.acquiredAt))}`
  : item.imageUrl;
const utc = (value: Date | string | undefined) => {
  if (!value) return "time unknown";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "time unknown" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export function volcanoMediaSlideHasContent(media: VolcanoMedia[]): boolean {
  return media.some((item) => item.type === "SATELLITE" && Boolean(src(item)));
}

export default function VolcanoMediaPanel({ media, color = "#38bdf8" }: { media: VolcanoMedia[]; color?: string }) {
  // Internal operator surface: show acquired products regardless of reuse flag.
  // Every satellite product rides as a tile (webcam-grid layout) rather than a
  // single hero, so the deck shows the whole product set at a glance.
  const shown = media.filter((item) => item.type === "SATELLITE" && Boolean(src(item)));
  if (!shown.length) return null;

  const tiles = shown.map((item) => ({
    key: item.id,
    src: src(item),
    title: item.title ?? item.caption ?? item.type,
    caption: `${item.source} · ${utc(item.observedAt ?? item.acquiredAt)}`,
  }));

  return (
    <BroadcastCard accent={color} eyebrow="Satellite imagery">
      <MediaTileGrid first eyebrow={`Latest volcano products (${shown.length})`} tiles={tiles} />
    </BroadcastCard>
  );
}
