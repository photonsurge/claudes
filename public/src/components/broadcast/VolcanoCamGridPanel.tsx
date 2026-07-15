"use client";

/**
 * On-air OVERVIEW of a volcano's official cameras — up to four angles at once
 * (summit / flank / thermal), establishing the whole volcano in one read before
 * the deck goes on to give each camera its own full-size page
 * (`VolcanoCamerasPanel`). Together they're the hybrid: wide read first, then
 * detail — and a short cut still gets the overview.
 *
 * Only worth a slide when there's more than one camera: with a single camera the
 * grid would just be a smaller duplicate of the page that follows it.
 *
 * Same rules as the single-camera card: cameras come from the ONE focus call,
 * already ACTIVE-only, and we serve OUR stored copy (`localImageUrl`) rather than
 * hot-linking the provider.
 */
import type { FocusVolcanoCam } from "../../lib/focus/types";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import { airableVolcanoCams, volcanoCamSrc } from "./VolcanoCamerasPanel";

const GRID_CAMS = 4;

export function volcanoCamGridSlideHasContent(cams: FocusVolcanoCam[]): boolean {
  return airableVolcanoCams(cams).length > 1;
}

export default function VolcanoCamGridPanel({
  cams,
  color = "#38bdf8",
}: {
  cams: FocusVolcanoCam[];
  color?: string;
}) {
  const airable = airableVolcanoCams(cams);
  if (airable.length < 2) return null;
  const shown = airable.slice(0, GRID_CAMS);
  const attribution = shown[0]?.attribution;

  return (
    <BroadcastCard accent={color} eyebrow={`Cameras (${airable.length} active)`}>
      <CardSection first eyebrow={attribution ? `Live · ${attribution}` : "Live"}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {shown.map((c) => (
            <div key={c.camId}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={volcanoCamSrc(c)}
                alt={c.title}
                style={{ width: "100%", height: 92, objectFit: "cover", borderRadius: 5, background: "#070a11", display: "block" }}
              />
              <div
                style={{
                  fontSize: 9,
                  color: "#8ea3bf",
                  marginTop: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.title}
              </div>
            </div>
          ))}
        </div>
      </CardSection>
    </BroadcastCard>
  );
}
