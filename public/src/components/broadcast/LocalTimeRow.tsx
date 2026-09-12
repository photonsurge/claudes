"use client";

/**
 * The LOCAL TIME row in the on-air info tile — "what time is it where we are
 * looking", ticking live.
 *
 * A country spotlight, a warning, a quake or an erupting volcano is a place with
 * its own clock, and that clock is a fact viewers reach for: 03:12 local says
 * something about an evacuation that 18:12 UTC does not. The zone itself is
 * resolved once per cut on the focus bundle (an IANA id off the nearest
 * catalogued city, else a longitude estimate — see shared/time/local-zone), so
 * this component only formats and ticks; it never fetches.
 *
 * Renders as `display: contents` so the label/value pair drops straight into the
 * info tile's existing two-column details grid rather than starting a grid of
 * its own — same alignment, same hairline rhythm as the rows above it.
 */
import { useEffect, useState } from "react";
import {
  formatLocalTime,
  formatLocalDay,
  localZoneCaption,
  type LocalZone,
} from "@photonsurge/shared/time/local-zone";
import { DIM } from "./BroadcastCard";
import type { SegmentKind } from "@photonsurge/shared/director";

/**
 * The cuts that carry a local clock: a country spotlight, a severe-weather
 * alert, a quake and a volcano — each a named place a viewer can picture, where
 * the local hour is part of the story.
 *
 * Deliberately NOT every kind with coordinates. A world spin, an orbital pass or
 * an ocean shot has no single "there"; a moving aircraft or vessel crosses zones
 * mid-shot, so a clock on those would be a number that keeps changing for the
 * wrong reason. A region spotlight can span several zones, so it stays out too.
 */
const LOCAL_TIME_KINDS = new Set<SegmentKind>(["country", "storm", "quake", "volcano"]);

/** Whether this segment kind gets the LOCAL TIME row. */
export function showsLocalTime(kind: SegmentKind): boolean {
  return LOCAL_TIME_KINDS.has(kind);
}

/** The reading, recomputed on each tick. */
interface Reading {
  time: string;
  day: string;
  caption: string;
}

const read = (zone: LocalZone, at: Date): Reading => ({
  time: formatLocalTime(zone, at),
  day: formatLocalDay(zone, at),
  caption: localZoneCaption(zone, at),
});

/**
 * The place's clock, ticking. The interval runs every second so the minute
 * turns over promptly, but the state it sets is a plain string — React bails out
 * of a re-render when it hasn't changed, so the row actually repaints once a
 * minute, not sixty times.
 *
 * Starts blank so the server's first render and the client's first render agree
 * (a clock is the classic hydration mismatch), then fills on mount.
 */
function useLocalReading(zone: LocalZone | null): Reading | null {
  const [reading, setReading] = useState<Reading | null>(null);
  // The zone object is rebuilt each time a bundle lands, so depend on its VALUES
  // — otherwise every cut of the same place would restart the interval.
  const { timezone, offsetHours, source, from } = zone ?? {};
  useEffect(() => {
    if (!source) {
      setReading(null);
      return;
    }
    const z: LocalZone = { timezone: timezone ?? null, offsetHours: offsetHours ?? 0, source, from };
    const tick = () => {
      const next = read(z, new Date());
      setReading((prev) =>
        prev && prev.time === next.time && prev.day === next.day && prev.caption === next.caption
          ? prev
          : next,
      );
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [timezone, offsetHours, source, from]);
  return reading;
}

export default function LocalTimeRow({ zone }: { zone: LocalZone | null }) {
  const reading = useLocalReading(zone);
  if (!zone) return null;
  // The label ships with the first render and the reading fills on mount (same
  // trick as WorldClockStrip): a clock rendered on the server would never match
  // the client's, and holding the whole row back would flash the details block's
  // hairline over an empty strip on the cuts where this is the only row.
  return (
    <div style={{ display: "contents" }}>
      <span style={{ opacity: 0.55, fontWeight: 700, letterSpacing: 0.3 }}>LOCAL TIME</span>
      <span style={{ fontWeight: 700, textAlign: "right" }}>
        {reading?.time ?? ""}
        {reading ? (
          <span style={{ color: DIM, fontWeight: 700, fontSize: "0.78em", marginLeft: 7 }}>
            {reading.day} · {reading.caption}
          </span>
        ) : null}
      </span>
    </div>
  );
}
