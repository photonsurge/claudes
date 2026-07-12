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
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";
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
  // Prefer a comparison (most storytelling), else the newest satellite pass, else anything.
  const hero =
    snapshots.find((s) => s.kind === "compare") ?? snapshots.find((s) => s.kind === "satellite") ?? snapshots[0];
  const scoreSeries = series.find((s) => s.metric === "alertscore") ?? series[0];

  return (
    <BroadcastCard accent={color} eyebrow="Satellite" theme={theme}>
      <CardSection first>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={snapSrc(hero)} alt={hero.kind} style={{ width: "100%", borderRadius: 8, display: "block" }} />
        <div style={{ color: DIM, fontSize: 12, marginTop: 4 }}>
          {hero.kind === "compare" ? "Then → now" : "Latest pass"} · {utc(hero.observationTime)}
        </div>
      </CardSection>

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
              style={{ color: "#cbd5e1", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {r.description || r.url}
            </div>
          ))}
        </CardSection>
      ) : null}
    </BroadcastCard>
  );
}
