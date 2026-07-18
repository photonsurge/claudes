"use client";

/**
 * "PRODUCTS" — the on-air event's cross-source media/products slide: an event
 * snapshot still (when one has been rendered), a metric sparkline, and the
 * official products/maps/reports harvested from every contributing source
 * (deep-GDACS, Copernicus EMS, EONET…), each tagged with its source. Earns a
 * slide on resources ALONE (external sources produce products before we render a
 * snapshot). Image bytes via /api/events/snapshot/:id (public renders <img>, no
 * image processing — all sharp lives on the worker). Mirrors AlertMediaPanel.
 */
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { iEventResource } from "@photonsurge/shared/db/event-resource-model";
import type { iEventSeries } from "@photonsurge/shared/db/event-series-model";
import { snapshotLabel } from "../../lib/satellite-view";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";
import MediaTileGrid from "./MediaTileGrid";
import Sparkline from "../Sparkline";

export function eventMediaSlideHasContent(
  snaps: EventSnapshotMeta[] | undefined,
  resources: iEventResource[] | undefined,
): boolean {
  return (!!snaps && snaps.length > 0) || (!!resources && resources.length > 0);
}

const snapSrc = (s: EventSnapshotMeta) => `/api/events/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`;
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default function EventMediaPanel({
  snapshots = [],
  resources = [],
  series = [],
  color = "#d23a3a",
  theme = DEFAULT_THEME,
}: {
  snapshots?: EventSnapshotMeta[];
  resources?: iEventResource[];
  series?: iEventSeries[];
  color?: string;
  theme?: BroadcastTheme;
}) {
  if (!eventMediaSlideHasContent(snapshots, resources)) return null;
  // The captured products ride as webcam-style tiles so the whole set (compare /
  // satellite / render / map) is on air at once, not just a single hero still.
  const tiles = snapshots.map((s) => ({
    key: s.id,
    src: snapSrc(s),
    title: snapshotLabel(s.kind, s.layer),
    caption: utc(s.observationTime),
  }));
  const hasTiles = tiles.length > 0;
  const scoreSeries = series.find((s) => s.metric === "alertscore") ?? series[0];
  const hasSpark = !!scoreSeries && scoreSeries.samples.length > 1;

  return (
    <BroadcastCard accent={color} eyebrow="Products" theme={theme}>
      <MediaTileGrid first tiles={tiles} />

      {hasSpark ? (
        <CardSection first={!hasTiles} eyebrow={scoreSeries.metric}>
          <Sparkline samples={scoreSeries.samples} width={360} height={40} color={color} strokeWidth={2} />
        </CardSection>
      ) : null}

      {resources.length ? (
        <CardSection first={!hasTiles && !hasSpark} eyebrow="Official products">
          {resources.slice(0, 4).map((r) => (
            <div
              key={r.id ?? r.url}
              style={{ display: "flex", gap: 8, alignItems: "baseline", color: "#cbd5e1", fontSize: 14.3, padding: "1px 0" }}
            >
              <span style={{ flex: "0 0 auto", color: DIM, fontSize: 12.1 }}>[{r.kind}]</span>
              <span style={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.title || r.description || r.url}
              </span>
              {r.sourceName ? <span style={{ flex: "0 0 auto", color: DIM, fontSize: 12.1 }}>{r.sourceName}</span> : null}
            </div>
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
