"use client";

import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";

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
  const shown = media.filter((item) => item.type === "SATELLITE" && Boolean(src(item))).slice(0, 1);
  if (!shown.length) return null;

  return (
    <BroadcastCard accent={color} eyebrow="Satellite imagery">
      <CardSection first eyebrow="Latest volcano products">
        {shown.map((item) => (
          <div key={item.id} style={{ marginBottom: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src(item)} alt={item.title ?? item.type}
              style={{ width: "100%", height: 270, objectFit: "contain", borderRadius: 8, background: "#070a11", display: "block" }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2, fontSize: 10 }}>
              <span style={{ color: "#a9bad0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.title ?? item.caption ?? item.type}
              </span>
              <span style={{ color: DIM, flex: "0 0 auto" }}>{item.source} · {item.type}</span>
            </div>
            <div style={{ color: DIM, fontSize: 9, marginTop: 1, lineHeight: 1.25 }}>
              {utc(item.observedAt ?? item.acquiredAt)}
              {item.attribution ? ` · ${item.attribution}` : ""}
              {item.cameraId ? ` · camera ${item.cameraId}` : ""}
              {item.sourceMediaId ? ` · upstream ${item.sourceMediaId}` : ""}
            </div>
            {(item.latitude != null || item.longitude != null || item.bearing != null) && (
              <div style={{ color: DIM, fontSize: 9, lineHeight: 1.25 }}>
                {item.latitude != null && item.longitude != null ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}` : "position unknown"}
                {item.bearing != null ? ` · bearing ${item.bearing}°` : ""}
              </div>
            )}
          </div>
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
