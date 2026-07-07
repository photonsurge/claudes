"use client";

/**
 * The auto-director's "what airs, and for how long" list (rendered inside
 * DirectorPanel). One row per segment KIND: the enable checkbox inline with the
 * kind's hold slider — untick a kind and its slider disappears with it. The
 * event kinds split into their LEVELS — earthquakes by magnitude class
 * (Minor … Great) and storms by severity (None … Extreme) — so an Extreme
 * warning can dwell far longer than a routine shot.
 *
 * Level rows are filtered to what can actually air under the current
 * minQuakeMag / minAlertSeverity thresholds, so the list never shows a tier
 * the director would refuse to schedule anyway.
 */
import {
  SEGMENT_KINDS,
  STORM_LEVELS,
  type DirectorConfig,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { QUAKE_MAGNITUDE_BANDS } from "@photonsurge/shared/seismic";

export const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Intro spin",
  ocean: "Ocean (world)",
  orbital: "Orbital (satellites)",
  tour: "Region tour",
  country: "Countries",
  weather: "Weather",
  storm: "Severe storms / volcanoes",
  quake: "Earthquakes",
  flight: "Aircraft",
  ship: "Ships",
  ad: "Sponsor ads",
  summary: "Round-up ticker",
};

/** Kinds whose hold comes from a per-level map, not the kind slider. */
const LEVELLED_KINDS = new Set<SegmentKind>(["quake", "storm"]);

function Slider({
  seconds,
  onChange,
  max = 60,
}: {
  seconds: number;
  onChange: (s: number) => void;
  max?: number;
}) {
  return (
    <input
      type="range"
      min={4}
      max={max}
      step={1}
      value={seconds}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%", display: "block", marginTop: 4 }}
    />
  );
}

/** A per-level hold row (quake magnitude band / storm severity tier). */
function LevelRow({
  label,
  seconds,
  onChange,
}: {
  label: string;
  seconds: number;
  onChange: (s: number) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.85 }}>
        <span>{label}</span>
        <strong style={{ fontSize: 14 }}>{seconds}s</strong>
      </span>
      <Slider seconds={seconds} onChange={onChange} max={90} />
    </div>
  );
}

export default function DirectorHolds({
  config,
  update,
}: {
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
}) {
  // Only magnitude bands that can air under the current threshold — a band is
  // reachable when its (exclusive) top end sits above minQuakeMag. Strongest first.
  const quakeBands = QUAKE_MAGNITUDE_BANDS.filter((b, i) => {
    const upper = i === 0 ? Infinity : QUAKE_MAGNITUDE_BANDS[i - 1].min;
    return upper > config.minQuakeMag;
  });
  // Likewise only severity levels at/above the storm threshold.
  const stormLevels = STORM_LEVELS.filter((l) => l.rank >= config.minAlertSeverity);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Show · hold per shot:</div>
      {SEGMENT_KINDS.map((k) => {
        const on = !!config.kinds[k];
        const levelled = LEVELLED_KINDS.has(k);
        return (
          <div key={k} style={{ marginBottom: on ? 8 : 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => update({ kinds: { [k]: e.target.checked } as Record<SegmentKind, boolean> })}
              />
              <span style={{ flex: 1 }}>{KIND_LABEL[k]}</span>
              {on && !levelled ? (
                <strong style={{ fontSize: 14 }}>{config.kindHoldSeconds[k]}s</strong>
              ) : null}
            </label>

            {/* Plain kinds: one slider, shown only while the kind is on air-eligible. */}
            {on && !levelled ? (
              <div style={{ paddingLeft: 22 }}>
                <Slider
                  seconds={config.kindHoldSeconds[k]}
                  onChange={(s) =>
                    update({ kindHoldSeconds: { [k]: s } as DirectorConfig["kindHoldSeconds"] })
                  }
                />
              </div>
            ) : null}

            {/* Earthquakes: one hold per magnitude class instead of a kind slider. */}
            {on && k === "quake" ? (
              <div style={{ paddingLeft: 22, marginTop: 4 }}>
                {quakeBands.map((b, i) => {
                  const upper = i === 0 ? null : QUAKE_MAGNITUDE_BANDS[i - 1].min;
                  const range = upper == null ? `M${b.min}+` : `M${b.min}–${upper}`;
                  return (
                    <LevelRow
                      key={b.cls}
                      label={`${b.label} (${range})`}
                      seconds={config.quakeHoldSeconds[b.cls]}
                      onChange={(s) =>
                        update({ quakeHoldSeconds: { [b.cls]: s } as DirectorConfig["quakeHoldSeconds"] })
                      }
                    />
                  );
                })}
              </div>
            ) : null}

            {/* Storms: one hold per severity level instead of a kind slider. */}
            {on && k === "storm" ? (
              <div style={{ paddingLeft: 22, marginTop: 4 }}>
                {stormLevels.map((l) => (
                  <LevelRow
                    key={l.key}
                    label={`${l.label} (${l.rank}/4)`}
                    seconds={config.stormHoldSeconds[l.key]}
                    onChange={(s) =>
                      update({ stormHoldSeconds: { [l.key]: s } as DirectorConfig["stormHoldSeconds"] })
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
