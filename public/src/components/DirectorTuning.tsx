"use client";

/** The director's small standalone knobs: transition pacing, sponsor-ad
 *  cadence, and the event thresholds that gate which quakes/storms are
 *  worth airing at all (see DirectorHolds for per-tier hold durations). */
import type { DirectorConfig } from "@photonsurge/shared/director";
import InfoTip from "./InfoTip";

export default function DirectorTuning({
  config,
  update,
}: {
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
}) {
  return (
    <>
      <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
        Transition: <strong style={{ fontSize: 15 }}>{config.transitionSeconds}s</strong>
        <InfoTip text="How long the deliberate camera move between shots takes." />
        <input
          type="range"
          min={1}
          max={12}
          step={0.5}
          value={config.transitionSeconds}
          onChange={(e) => update({ transitionSeconds: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 6 }}
        />
      </label>

      {config.kinds.ad ? (
        <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
          Ad break every: <strong>{config.adEveryNShots} shots</strong>
          <InfoTip text="Sponsor ads are inserted every N shots. A breaking event defers a due ad slot rather than skipping it." />
          <input
            type="range"
            min={2}
            max={20}
            step={1}
            value={config.adEveryNShots}
            onChange={(e) => update({ adEveryNShots: Number(e.target.value) })}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
      ) : null}

      <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
        Min quake magnitude: <strong>M{config.minQuakeMag.toFixed(1)}</strong>
        <InfoTip text="Earthquakes below this magnitude never air, and their hold-time tier is hidden below since it can't fire." />
        <input
          type="range"
          min={2}
          max={8}
          step={0.5}
          value={config.minQuakeMag}
          onChange={(e) => update({ minQuakeMag: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
        Min storm severity: <strong>{config.minAlertSeverity}/4</strong>
        <InfoTip text="Storm warnings below this severity never air, same idea as the quake threshold above." />
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={config.minAlertSeverity}
          onChange={(e) => update({ minAlertSeverity: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
    </>
  );
}
