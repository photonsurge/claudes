"use client";

/**
 * "SATELLITE" — the on-air storm's imagery slide: the latest comparison (or
 * satellite pass) still, an optional GDACS-score sparkline, and the official
 * resource links — all delivered on the focus bundle. Image bytes come from the
 * worker-baked snapshot via /api/alerts/snapshot/:id (public renders <img>, does
 * no image processing — all sharp lives on the worker). Self-hides with no
 * snapshots. Mirrors AreaAlertsPanel's shell.
 */
import type { AlertSnapshotMeta } from "@photonsurge/shared/db/alert-snapshot-repo";
import type { iAlertResource } from "@photonsurge/shared/db/alert-resource-model";
import type { iAlertSeries } from "@photonsurge/shared/db/alert-series-model";
import { snapshotLabel } from "../../lib/satellite-view";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import MediaTileGrid from "./MediaTileGrid";
import Sparkline from "../Sparkline";

export function alertMediaSlideHasContent(snaps: AlertSnapshotMeta[] | undefined): boolean {
  return !!snaps && snaps.length > 0;
}

const snapSrc = (s: AlertSnapshotMeta) => `/api/alerts/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`;
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default function AlertMediaPanel({
  snapshots,
  resources = [],
  series = [],
  color = "#d23a3a",
  theme = DEFAULT_THEME,
}: {
  snapshots: AlertSnapshotMeta[];
  resources?: iAlertResource[];
  series?: iAlertSeries[];
  color?: string;
  theme?: BroadcastTheme;
}) {
  if (!alertMediaSlideHasContent(snapshots)) return null;
  // Every snapshot rides as a webcam-style tile so the whole imagery set is on air
  // at once, rather than a single hero still.
  const tiles = snapshots.map((s) => ({
    key: s.id,
    src: snapSrc(s),
    title: snapshotLabel(s.kind, s.layer),
    caption: utc(s.observationTime),
  }));
  const scoreSeries = series.find((s) => s.metric === "alertscore") ?? series[0];

  return (
    <BroadcastCard accent={color} eyebrow="Satellite" theme={theme}>
      <MediaTileGrid first tiles={tiles} />

      {scoreSeries && scoreSeries.samples.length > 1 ? (
        <CardSection eyebrow={scoreSeries.metric}>
          <Sparkline samples={scoreSeries.samples} width={360} height={40} color={color} strokeWidth={2} />
        </CardSection>
      ) : null}

      {resources.length ? (
        <CardSection eyebrow="Official">
          {resources.slice(0, 3).map((r) => (
            <div
              key={r.id ?? r.url}
              style={{ color: "#cbd5e1", fontSize: 14.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {r.description || r.url}
            </div>
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
