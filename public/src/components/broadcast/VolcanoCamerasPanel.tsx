"use client";

/**
 * On-air card for an active volcano's OFFICIAL monitoring cameras (GeoNet, INGV,
 * MAGMA…) — the "what does it look like right now" slide.
 *
 * Cameras arrive on the ONE focus call (FocusBundle.volcanoCams), never a per-cut
 * fetch. They're already filtered to ACTIVE server-side (a camera an operator
 * switched off, or one a registry lost, never reaches air) and joined to our own
 * stored frame.
 *
 * Serves `localImageUrl` (OUR copy, via /api/volcanoes/media/:id) in preference to
 * the provider's URL. The worker already downloads every camera (`cameraRefresh`),
 * so hot-linking would blank the slide whenever the provider is down/slow/blocking
 * us, and would hit their server from every viewer's browser. `upstreamImageUrl`
 * is only a fallback for a camera we haven't stored yet.
 */
import type { FocusVolcanoCam } from "../../lib/focus/types";
import BroadcastCard, { CardSection } from "./BroadcastCard";

const MAX_CAMS = 1;

/** Our stored copy first; the provider's URL only if we haven't got one yet. */
export const volcanoCamSrc = (c: FocusVolcanoCam): string | undefined => c.localImageUrl ?? c.upstreamImageUrl;

export function volcanoCamerasSlideHasContent(cams: FocusVolcanoCam[]): boolean {
  return cams.some((c) => !!volcanoCamSrc(c));
}

export default function VolcanoCamerasPanel({
  cams,
  color = "#38bdf8",
}: {
  cams: FocusVolcanoCam[];
  color?: string;
}) {
  // Prefer cameras we hold locally — those always render.
  const shown = cams
    .filter((c) => !!volcanoCamSrc(c))
    .sort((a, b) => Number(Boolean(b.localImageUrl)) - Number(Boolean(a.localImageUrl)))
    .slice(0, MAX_CAMS);
  if (!shown.length) return null;

  const attribution = shown[0]?.attribution;

  return (
    <BroadcastCard accent={color} eyebrow="Cameras">
      <CardSection first eyebrow={attribution ? `Live · ${attribution}` : "Live"}>
        {shown.map((c) => (
          <div key={c.camId} style={{ padding: "3px 0" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={volcanoCamSrc(c)}
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
