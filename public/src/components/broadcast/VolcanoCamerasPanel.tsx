"use client";

/**
 * On-air card for an active volcano's OFFICIAL monitoring cameras (GeoNet et al.)
 * — the "what does it look like right now" slide. Cameras arrive on the ONE focus
 * call (FocusBundle.nearbyCams), never a per-cut fetch. P2a shows the live latest
 * still hot-linked from the provider; the worker-captured on-disk frame + media
 * route is P2b. Returns null when the volcano has no cameras, so callers check
 * `volcanoCamerasSlideHasContent` before adding this as a page.
 */
import type { Cam } from "../../lib/cams/types";
import BroadcastCard, { CardSection } from "./BroadcastCard";

const MAX_CAMS = 1;

export function volcanoCamerasSlideHasContent(cams: Cam[]): boolean {
  return cams.some((c) => !!c.imageUrl);
}

export default function VolcanoCamerasPanel({
  cams,
  color = "#38bdf8",
}: {
  cams: Cam[];
  color?: string;
}) {
  const shown = cams.filter((c) => !!c.imageUrl).slice(0, MAX_CAMS);
  if (!shown.length) return null;

  const attribution = shown[0]?.attribution?.provider;

  return (
    <BroadcastCard accent={color} eyebrow="Cameras">
      <CardSection first eyebrow={attribution ? `Live · ${attribution}` : "Live"}>
        {shown.map((c) => (
          <div key={c.camId} style={{ padding: "3px 0" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.imageUrl}
              alt={c.title}
              style={{ width: "100%", height: 270, objectFit: "contain", borderRadius: 8, background: "#070a11", display: "block" }}
            />
            <div
              style={{
                fontSize: 10,
                color: "#8ea3bf",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {c.title}
            </div>
          </div>
        ))}
      </CardSection>
    </BroadcastCard>
  );
}
