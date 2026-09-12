"use client";

/**
 * EXPOSURE LOG for one ad — the what/where/when record of its always-on
 * airings ("Sponsored by …" crawl mentions + bottom-left billboard rotation):
 * one row per exposure window (surface, scene, start → end, duration), newest
 * first, with an ON AIR badge while a window is still open. Windows are
 * written by the worker's ads.exposure sweep; this just reads them. Renders
 * nothing for an ad that has never been placed on either surface (no windows).
 */
import { useEffect, useState } from "react";
import { getAdExposure, type AdExposureWindow } from "../../lib/ads/client";
import { asOf } from "../tracks/styles";

/** Surface tag + ink per exposure surface (the crawl is the plain default). */
const SURFACE_TAG: Record<string, string> = { billboard: "BILLBOARD", alertSlot: "ALERT SLOT", ticker: "CRAWL" };
const SURFACE_INK: Record<string, string> = { billboard: "#7dd3fc", alertSlot: "#fbbf24", ticker: "#8b95a7" };

/** "3m 20s" / "1h 05m" — window durations are minutes-to-hours scale. */
export const fmtWindowMs = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
};

const day = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** "Aug 28 14:02 → 15:40" (same day) / "Aug 28 23:50 → Aug 29 00:10" / "… → now". */
export const fmtWindowRange = (w: Pick<AdExposureWindow, "startedAt" | "endedAt">): string => {
  const from = `${day(w.startedAt)} ${clock(w.startedAt)}`;
  if (!w.endedAt) return `${from} → now`;
  const sameDay = day(w.startedAt) === day(w.endedAt);
  return `${from} → ${sameDay ? "" : `${day(w.endedAt)} `}${clock(w.endedAt)}`;
};

export default function AdExposureLog({ adId }: { adId: string }) {
  const [windows, setWindows] = useState<AdExposureWindow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWindows(null);
    getAdExposure(adId)
      .then((w) => {
        if (!cancelled) setWindows(w);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [adId]);

  if (!windows || windows.length === 0) return null;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #1b2030", paddingTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#8b95a7", marginBottom: 6 }}>
        EXPOSURE LOG
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
        {windows.map((w, i) => (
          <div
            key={`${w.sceneId}-${w.startedAt}-${i}`}
            style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, color: "#c7d0e0" }}
          >
            {!w.endedAt && (
              <span style={{ color: "#34d399", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                ● ON AIR
              </span>
            )}
            <span
              style={{
                color: SURFACE_INK[w.surface] ?? "#8b95a7",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.6,
                whiteSpace: "nowrap",
              }}
            >
              {SURFACE_TAG[w.surface] ?? "CRAWL"}
            </span>
            <span style={{ color: "#8b95a7" }}>{w.sceneName}</span>
            <span>{fmtWindowRange(w)}</span>
            <span style={{ color: "#8b95a7", marginLeft: "auto", whiteSpace: "nowrap" }}>{fmtWindowMs(w.ms)}</span>
          </div>
        ))}
      </div>
      <div style={{ ...asOf, marginTop: 6 }}>
        When this ad was on an always-on surface (crawl mention / corner billboard / New alerts card), per channel.
      </div>
    </div>
  );
}
