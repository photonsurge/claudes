"use client";

/**
 * On-air card for ONE of a volcano's official monitoring cameras (GeoNet, INGV,
 * MAGMA…) — the "what does it look like right now" slide.
 *
 * ONE CAMERA PER SLIDE: a volcano's cameras each get their own page in the deck so
 * they all rotate onto air, rather than a single card showing one angle while the
 * rest are never seen (Etna alone has ~8 active). The deck handles the rotation;
 * this card just renders the frame big.
 *
 * Cameras arrive on the ONE focus call (FocusBundle.volcanoCams), never a per-cut
 * fetch, already filtered to ACTIVE server-side (a camera an operator switched off,
 * or one a registry lost, never reaches air) and joined to our own stored frame.
 *
 * Serves `localImageUrl` (OUR copy, via /api/volcanoes/media/:id) in preference to
 * the provider's URL. The worker already downloads every camera (`cameraRefresh`),
 * so hot-linking would blank the slide whenever the provider is down/slow/blocking
 * us, and would hit their server from every viewer's browser. `upstreamImageUrl` is
 * only a fallback for a camera we haven't stored yet.
 */
import type { FocusVolcanoCam } from "../../lib/focus/types";
import BroadcastCard, { CardSection } from "./BroadcastCard";

/** Our stored copy first; the provider's URL only if we haven't got one yet. */
export const volcanoCamSrc = (c: FocusVolcanoCam): string | undefined => c.localImageUrl ?? c.upstreamImageUrl;

/** The cameras worth giving a slide each — renderable, ours-first so the reliable
 *  ones lead the rotation. No cap: every active camera gets its turn. */
export function airableVolcanoCams(cams: FocusVolcanoCam[]): FocusVolcanoCam[] {
  return cams
    .filter((c) => !!volcanoCamSrc(c))
    .sort((a, b) => Number(Boolean(b.localImageUrl)) - Number(Boolean(a.localImageUrl)));
}

export function volcanoCamerasSlideHasContent(cams: FocusVolcanoCam[]): boolean {
  return airableVolcanoCams(cams).length > 0;
}

export default function VolcanoCamerasPanel({ cam, color = "#38bdf8" }: { cam: FocusVolcanoCam; color?: string }) {
  const src = volcanoCamSrc(cam);
  if (!src) return null;

  return (
    <BroadcastCard accent={color} eyebrow="Camera">
      <CardSection first eyebrow={cam.attribution ? `Live · ${cam.attribution}` : "Live"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={cam.title}
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
          {cam.title}
        </div>
      </CardSection>
    </BroadcastCard>
  );
}
