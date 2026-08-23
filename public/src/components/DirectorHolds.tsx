"use client";

/**
 * The auto-director's "how long each shot holds" list (rendered inside
 * DirectorPanel). One row per ENABLED segment kind — which kinds air at all is
 * a channel content choice, edited on the channel's admin page
 * (/admin/scenes/:id, DirectorSettings card), so this component only paces
 * them. The event kinds split into their LEVELS — earthquakes by magnitude
 * class (Minor … Great) and storms by severity (None … Extreme) — so an
 * Extreme warning can dwell far longer than a routine shot.
 *
 * Level rows are filtered to what can actually air under the current
 * minQuakeMag / minAlertSeverity thresholds, so the list never shows a tier
 * the director would refuse to schedule anyway.
 */
import {
  SEGMENT_KINDS,
  STORM_LEVELS,
  VOLCANO_LEVELS,
  type DirectorConfig,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { useRef, useState } from "react";
import { QUAKE_MAGNITUDE_BANDS } from "@photonsurge/shared/seismic";
import InfoTip from "./InfoTip";
import { box } from "./panelBox";
import { KIND_LABEL } from "../lib/kind-labels";

/** Kinds whose hold comes from a per-level map, not the kind slider. */
const LEVELLED_KINDS = new Set<SegmentKind>(["quake", "storm", "volcano"]);

/**
 * Editable seconds readout beside each hold slider. Type any value (min 4,
 * no ceiling) to override the slider's 300s drag range — the draft only
 * commits on blur/Enter so half-typed numbers never reach the live director.
 */
function HoldSeconds({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (s: number) => void;
}) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Mirrored in a ref so Enter's commit-then-blur can't double-fire onChange
  // (the blur handler still sees the pre-setState closure in the same tick).
  const draftRef = useRef<string | null>(null);
  const setDraft = (v: string | null) => {
    draftRef.current = v;
    setDraftState(v);
  };
  const commit = () => {
    const d = draftRef.current;
    if (d == null) return;
    setDraft(null);
    const n = Math.round(Number(d));
    if (Number.isFinite(n) && n >= 4 && n !== seconds) onChange(n);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
      <input
        type="number"
        min={4}
        step={1}
        value={draft ?? seconds}
        onFocus={(e) => {
          setDraft(String(seconds));
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          commit();
          e.currentTarget.blur();
        }}
        style={{ ...box, width: 56, padding: "1px 4px", fontSize: 13, fontWeight: 700, textAlign: "right" }}
      />
      <span style={{ fontSize: 12, opacity: 0.7 }}>s</span>
    </span>
  );
}

function Slider({
  seconds,
  onChange,
  max = 300,
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
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, opacity: 0.85 }}>
        <span>{label}</span>
        <HoldSeconds seconds={seconds} onChange={onChange} />
      </span>
      <Slider seconds={seconds} onChange={onChange} max={300} />
    </div>
  );
}

export default function DirectorHolds({
  sceneId,
  config,
  update,
}: {
  sceneId: string;
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

  const enabled = SEGMENT_KINDS.filter((k) => !!config.kinds[k]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4, display: "flex", alignItems: "center" }}>
        Hold per shot:
        <InfoTip text="Drag a slider for how long each enabled shot type holds when it airs — or type a number in the seconds box for holds beyond the slider's range. Quakes/storms/volcanoes hold per severity tier instead of one slider." />
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>
        Only slide types enabled for this channel appear here — manage them in{" "}
        <a href={`/admin/scenes/${encodeURIComponent(sceneId)}`} style={{ color: "#7fb3ff" }}>
          Channel settings
        </a>
        .
      </div>
      {enabled.map((k) => {
        const levelled = LEVELLED_KINDS.has(k);
        return (
          <div key={k} style={{ marginBottom: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{KIND_LABEL[k]}</span>
              {!levelled ? (
                <HoldSeconds
                  seconds={config.kindHoldSeconds[k]}
                  onChange={(s) =>
                    update({ kindHoldSeconds: { [k]: s } as DirectorConfig["kindHoldSeconds"] })
                  }
                />
              ) : null}
            </span>

            {/* Plain kinds: one slider. */}
            {!levelled ? (
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
            {k === "quake" ? (
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
            {k === "storm" ? (
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

            {/* Volcanoes: one hold per status level instead of a kind slider. */}
            {k === "volcano" ? (
              <div style={{ paddingLeft: 22, marginTop: 4 }}>
                {VOLCANO_LEVELS.map((l) => (
                  <LevelRow
                    key={l.key}
                    label={l.label}
                    seconds={config.volcanoHoldSeconds[l.key]}
                    onChange={(s) =>
                      update({ volcanoHoldSeconds: { [l.key]: s } as DirectorConfig["volcanoHoldSeconds"] })
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {enabled.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>No slide types are enabled for this channel yet.</div>
      ) : null}
    </div>
  );
}
