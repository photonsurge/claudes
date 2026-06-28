"use client";

/**
 * Scrub / play through the run's forecast steps. On change it sets fhr and
 * preloads neighbouring steps' textures so playback doesn't flash.
 */
import { useEffect, useRef } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { preloadTextures } from "../lib/textures";
import { neighbourUrls } from "./timeline-utils";

export interface TimelineProps {
  manifest: WeatherManifest | null;
  fhr: number;
  activeVariable: string | null;
  showWind: boolean;
  onChange: (fhr: number) => void;
}

export default function Timeline({
  manifest,
  fhr,
  activeVariable,
  showWind,
  onChange,
}: TimelineProps) {
  const playing = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = manifest?.steps ?? [];
  const fhrs = steps.map((s) => s.fhr);
  const idx = Math.max(0, fhrs.indexOf(fhr));

  // Preload neighbours whenever the selection moves.
  useEffect(() => {
    if (!manifest) return;
    const vars = [showWind ? "wind" : null, activeVariable].filter(Boolean) as string[];
    preloadTextures(neighbourUrls(manifest, fhr, vars));
  }, [manifest, fhr, activeVariable, showWind]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  if (!manifest || fhrs.length === 0) {
    return <div style={{ color: "#888", fontSize: 12 }}>No run loaded</div>;
  }

  const step = (delta: number) => {
    const next = fhrs[(idx + delta + fhrs.length) % fhrs.length];
    onChange(next);
  };

  const togglePlay = () => {
    if (playing.current) {
      playing.current = false;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    } else {
      playing.current = true;
      timer.current = setInterval(() => step(1), 1000);
    }
  };

  const current = steps[idx];

  return (
    <div style={{ color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <button type="button" onClick={togglePlay} style={ctl}>
          ▶︎/❚❚
        </button>
        <button type="button" onClick={() => step(-1)} style={ctl} aria-label="previous step">
          ◀
        </button>
        <button type="button" onClick={() => step(1)} style={ctl} aria-label="next step">
          ▶
        </button>
        <span style={{ fontSize: 12 }}>
          +{fhr}h{" "}
          {current?.validTime
            ? new Date(current.validTime).toUTCString().replace(":00 GMT", "Z")
            : ""}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={fhrs.length - 1}
        value={idx}
        onChange={(e) => onChange(fhrs[Number(e.target.value)])}
        style={{ width: "100%" }}
        aria-label="forecast hour"
      />
    </div>
  );
}

const ctl: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 5,
  border: "1px solid #333",
  background: "#1a1f2b",
  color: "#fff",
  cursor: "pointer",
};
