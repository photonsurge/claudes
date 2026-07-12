import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import type { AlertResourceKind } from "@photonsurge/shared/db/alert-resource-model";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";

/**
 * Promote GDACS's numeric metrics + official resource links off the feed's `raw`
 * feature into the alert_series / alert_resources collections — no extra HTTP,
 * the 15-min re-poll is the sampling cadence. `appendSample` dedups unchanged
 * values, so the series stays a deltas-over-time graph.
 */

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function harvestGdacsExtras(
  a: iAlert,
  db: AppDb,
  now: Date,
): Promise<{ samples: number; resources: number }> {
  const props = (a.raw as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props) return { samples: 0, resources: 0 };

  const t = now.getTime();
  const alertId = (a as { id?: string }).id;
  const geom = a.info?.[0]?.area?.[0]?.geometry;
  const pt = geom ? alertRepPoint(geom) : null;
  const lng = pt ? pt[0] : undefined;
  const lat = pt ? pt[1] : undefined;

  // ── series (promote-from-raw) ─────────────────────────────────────────────
  const sev = props.severitydata as { severity?: unknown } | undefined;
  const candidates: { metric: string; value: number | null }[] = [
    { metric: "alertscore", value: num(props.alertscore) },
    { metric: "episodealertscore", value: num(props.episodealertscore) },
    { metric: "severity", value: num(sev?.severity) },
    { metric: "population", value: num(props.population ?? props.affectedpopulation) },
  ];
  let samples = 0;
  for (const c of candidates) {
    if (c.value == null) continue;
    const r = await db.alertSeries.appendSample({
      source: a.source,
      identifier: a.identifier,
      alertId,
      metric: c.metric,
      value: c.value,
      t,
      lng,
      lat,
    });
    if (r.appended) samples++;
  }

  // ── resources (refs only) ─────────────────────────────────────────────────
  const url = props.url as { report?: unknown; details?: unknown } | undefined;
  const resources: {
    source: string;
    identifier: string;
    alertId?: string;
    url: string;
    kind: AlertResourceKind;
    description?: string;
    mimeType?: string;
  }[] = [];
  const addRes = (u: unknown, kind: AlertResourceKind, description: string, mimeType?: string) => {
    if (typeof u === "string" && /^https?:\/\//i.test(u)) {
      resources.push({ source: a.source, identifier: a.identifier, alertId, url: u, kind, description, mimeType });
    }
  };
  addRes(url?.report, "report", "GDACS event report");
  addRes(url?.details, "report", "GDACS event details");
  addRes(props.iconoverall, "icon", "GDACS overall alert icon", "image/png");
  addRes(props.icon, "icon", "GDACS alert icon", "image/png");
  if (resources.length) await db.alertResources.upsertMany(resources);

  return { samples, resources: resources.length };
}
