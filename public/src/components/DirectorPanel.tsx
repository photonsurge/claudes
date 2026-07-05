"use client";

/**
 * Operator controls for the per-scene auto-director. Off/Auto toggle, per-kind
 * (and per-event-level) hold times, which kinds are eligible, event thresholds,
 * a Skip button, which basemap "map types" each touring kind (intro/ocean/quake)
 * cycles through, per-kind overlay on/off overrides — plus a live "on air / up
 * next" readout fed by the worker's director:state. `config`/`update` are lifted
 * to the parent (/control) so the live preview shares the exact same config the
 * operator is editing here; edits PATCH the scene's director config and the
 * worker picks them up within ~1s.
 */
import { useEffect, useState } from "react";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import {
  INTRO_MAP_TYPES,
  OCEAN_MAP_TYPES,
  QUAKE_MAP_TYPES,
  PRESETS,
  OVERLAY_KEYS,
  type GlobalMapType,
} from "@photonsurge/shared/director-rois";
import type { DirectorConfig, SegmentKind } from "@photonsurge/shared/director";
import { useDirector } from "../lib/director";
import DirectorHolds from "./DirectorHolds";

const box: React.CSSProperties = {
  background: "#0a0e16",
  color: "#fff",
  border: "1px solid #2a3344",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
};

/** Kinds whose "map type" tour catalog the operator can subset (see globalMapTour). */
const TOURED_KINDS: { kind: SegmentKind; label: string; catalog: GlobalMapType[] }[] = [
  { kind: "intro", label: "Global spin (intro)", catalog: INTRO_MAP_TYPES },
  { kind: "ocean", label: "Ocean spin", catalog: OCEAN_MAP_TYPES },
  { kind: "quake", label: "Earthquake terrain looks", catalog: QUAKE_MAP_TYPES },
];

/** The enabled map-type ids for a kind — an absent/empty list means "all enabled". */
function enabledMapTypeIds(config: DirectorConfig, kind: SegmentKind, catalog: GlobalMapType[]): string[] {
  const ids = config.mapTypes[kind];
  return ids && ids.length ? ids : catalog.map((t) => t.id);
}

/** The overlay-toggle keys a kind's preset actually turns on — the only ones worth exposing. */
function overlayTogglesFor(kind: SegmentKind): string[] {
  const preset = PRESETS[kind] as Record<string, unknown>;
  return OVERLAY_KEYS.filter((k) => preset[k] === true);
}

/** "showTrackLabels" -> "Track labels". */
function humanizeOverlayKey(key: string): string {
  return key.replace(/^show/, "").replace(/([A-Z])/g, " $1").trim();
}

/** Kinds worth showing an overlay-override editor for (only ones with any togglable key). */
const OVERLAY_KIND_ORDER: SegmentKind[] = [
  "intro",
  "ocean",
  "orbital",
  "tour",
  "country",
  "weather",
  "storm",
  "quake",
  "flight",
  "ship",
];

export default function DirectorPanel({
  sceneId,
  config,
  update,
}: {
  sceneId: string;
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
}) {
  const live = useDirector(sceneId);
  const auto = config.mode === "auto";

  // Live countdown for the on-air readout.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const remaining = live?.endsAt ? Math.max(0, Math.round((live.endsAt - now) / 1000)) : 0;

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid #1b2030", paddingBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Auto-director</h3>
        <span style={{ fontSize: 11, opacity: 0.6 }}>scene: {sceneId}</span>
      </div>

      {/* Mode + skip */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => update({ mode: auto ? "off" : "auto" })}
          style={{
            ...box,
            cursor: "pointer",
            flex: 1,
            fontWeight: 700,
            background: auto ? "#1f7a3f" : "#1a2030",
            borderColor: auto ? "#2bbe63" : "#2a3344",
          }}
        >
          {auto ? "● AUTO — ON" : "○ Auto — Off"}
        </button>
        <button
          onClick={() => update({ skipNonce: config.skipNonce + 1 })}
          disabled={!auto}
          style={{ ...box, cursor: auto ? "pointer" : "not-allowed", opacity: auto ? 1 : 0.5 }}
          title="Cut to the next shot now"
        >
          Skip ⏭
        </button>
      </div>

      {/* On-air readout */}
      {auto && live?.segment ? (
        <div style={{ ...box, marginBottom: 12, padding: 10, borderColor: "#3a4a66" }}>
          <div style={{ fontSize: 11, color: "#ff6a6a", fontWeight: 700, letterSpacing: 1 }}>
            ON AIR · {remaining}s
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{live.segment.title}</div>
          {live.segment.subtitle ? (
            <div style={{ fontSize: 12, opacity: 0.8 }}>{live.segment.subtitle}</div>
          ) : null}
          {live.upNext.length ? (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              Up next: {live.upNext.map((u) => u.title).join(" · ")}
            </div>
          ) : null}
        </div>
      ) : auto ? (
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Starting up…</div>
      ) : null}

      {/* Transition time — the deliberate, set camera move between shots */}
      <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
        Transition: <strong>{config.transitionSeconds}s</strong>
        <input
          type="range"
          min={1}
          max={12}
          step={0.5}
          value={config.transitionSeconds}
          onChange={(e) => update({ transitionSeconds: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>

      {/* Eligible kinds, each checkbox inline with its hold slider(s) —
          quake/storm split into per-level holds */}
      <DirectorHolds config={config} update={update} />

      {/* Map-type tours — which basemaps/looks each touring kind cycles through */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Map types shown:</div>
        {TOURED_KINDS.filter((t) => config.kinds[t.kind]).map(({ kind, label, catalog }) => {
          const enabled = enabledMapTypeIds(config, kind, catalog);
          return (
            <div key={kind} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                {catalog.map((t) => {
                  const on = enabled.includes(t.id);
                  return (
                    <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          update({
                            mapTypes: {
                              ...config.mapTypes,
                              [kind]: on ? enabled.filter((id) => id !== t.id) : [...enabled, t.id],
                            },
                          })
                        }
                      />
                      {t.title}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Favourite countries — the spotlights the country kind rotates through */}
      {config.kinds.country ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
            Favourite countries ({config.countries.length}):
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "2px 10px",
              maxHeight: 180,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {COUNTRY_SHOTS.map((c) => {
              const on = config.countries.includes(c.id);
              return (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      update({
                        countries: on
                          ? config.countries.filter((id) => id !== c.id)
                          : [...config.countries, c.id],
                      })
                    }
                  />
                  {c.flag} {c.name}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Overlay overrides — per-kind on/off for the layers that kind's preset uses */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Overlays per shot type:</div>
        {OVERLAY_KIND_ORDER.filter((k) => config.kinds[k] && overlayTogglesFor(k).length > 0).map((kind) => {
          const keys = overlayTogglesFor(kind);
          return (
            <div key={kind} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2, textTransform: "capitalize" }}>{kind}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                {keys.map((key) => {
                  const current = config.overlayOverrides[kind]?.[key] ?? true;
                  return (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={current}
                        onChange={() =>
                          update({
                            overlayOverrides: {
                              ...config.overlayOverrides,
                              [kind]: { ...config.overlayOverrides[kind], [key]: !current },
                            },
                          })
                        }
                      />
                      {humanizeOverlayKey(key)}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ad cadence — only relevant when Sponsor ads are enabled */}
      {config.kinds.ad ? (
        <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
          Ad break every: <strong>{config.adEveryNShots} shots</strong>
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

      {/* Thresholds */}
      <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
        Min quake magnitude: <strong>M{config.minQuakeMag.toFixed(1)}</strong>
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
    </section>
  );
}
