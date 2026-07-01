/**
 * PURE text builders for the broadcast chrome (tickers + live-alert banner). No
 * DOM, no React — turn the live overlay data (alerts, quakes, tracks) into the
 * short strings the on-air furniture displays, so the formatting is unit-tested
 * and the components stay dumb.
 */
import type { AlertFeature } from "./alerts";
import type { Quake, Track } from "./tracks/types";
import { SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";

/** "SEISMIC M5.9 · 12km SSW of … · TSUNAMI POTENTIAL" */
export function quakeTicker(q: Quake): string {
  const loc = q.place ?? `${q.lat.toFixed(1)}, ${q.lng.toFixed(1)}`;
  return `SEISMIC M${q.mag.toFixed(1)} · ${loc}${q.tsunami ? " · TSUNAMI POTENTIAL" : ""}`;
}

/** "TSUNAMI WATCH: Fiji Region" (severity-prefixed hazard + area). */
export function alertTicker(a: AlertFeature): string {
  const p = a.properties;
  const sev = SEVERITY_LABELS[p.severityRank];
  const area = p.areaDesc ? ` · ${p.areaDesc}` : "";
  return `${sev ? `${sev.toUpperCase()}: ` : ""}${p.event}${area}`;
}

/** "🇺🇸 GLOBAL THUNDER-26 · AIRCRAFT" */
export function trackTicker(t: Track): string {
  const id = t.name || t.code || "UNKNOWN";
  const flag = t.flag ? `${t.flag} ` : "";
  const kind = t.kind === "aircraft" ? "AIRCRAFT" : t.kind === "ship" ? "VESSEL" : "SATELLITE";
  return `${flag}${id} · ${kind}`;
}

/**
 * All ticker lines from the live data, seismic → alerts → tracks. No cap — the
 * crawl shows everything (long feeds just scroll longer); duplicates are dropped
 * so the same event doesn't repeat back-to-back.
 */
export function buildTicker(input: {
  alerts?: AlertFeature[];
  quakes?: Quake[];
  tracks?: Track[];
}): string[] {
  const items: string[] = [];
  for (const q of input.quakes ?? []) items.push(quakeTicker(q));
  for (const a of input.alerts ?? []) items.push(alertTicker(a));
  for (const t of input.tracks ?? []) items.push(trackTicker(t));
  return [...new Set(items)];
}

/** The single most severe active alert (drives the top-right alert panel), or null. */
export function topAlert(alerts: AlertFeature[]): AlertFeature | null {
  if (!alerts.length) return null;
  return alerts.reduce((best, a) =>
    a.properties.severityRank > best.properties.severityRank ? a : best,
  );
}

/** "Tsunami Watch: Fiji Region — YELLOW" for the live-alert panel body. */
export function alertBannerText(a: AlertFeature): string {
  const p = a.properties;
  const area = p.areaDesc ? `: ${p.areaDesc}` : "";
  const level = p.level ?? SEVERITY_LABELS[p.severityRank];
  return `${p.event}${area}${level ? ` — ${level.toUpperCase()}` : ""}`;
}
