"use client";

/**
 * Operator controls for the per-scene auto-director. Off/Auto toggle, per-kind
 * (and per-event-level) hold times, which kinds are eligible, event thresholds,
 * a Skip button, which basemap "map types" each touring kind (intro/ocean/quake)
 * cycles through, per-kind overlay on/off overrides, and a saved-"slide"
 * library per kind (save/load/update/delete a named snapshot of the live
 * map) — plus a live "on air / up next" readout fed by the worker's
 * director:state. `config`/`update` are lifted
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
import { SEGMENT_KINDS, type DirectorConfig, type KindSlide, type SegmentKind } from "@photonsurge/shared/director";
import { BASEMAPS } from "@photonsurge/shared/basemaps";
import { SATIMG_LOOKS } from "@photonsurge/shared/satimg/types";
import { DEFAULT_WIND_SETTINGS, type ControlState } from "@photonsurge/shared/control";
import { useDirector } from "../lib/director";
import DirectorHolds, { KIND_LABEL } from "./DirectorHolds";
import WindControls from "./WindControls";

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

/** Snapshot the live operator map into a slide's look + overlay toggles for `kind`. */
function slideFromLive(kind: SegmentKind, live: ControlState): Pick<KindSlide, "look" | "overlays"> {
  const overlays: Partial<Record<string, boolean>> = {};
  for (const key of overlayTogglesFor(kind)) {
    overlays[key] = Boolean((live as unknown as Record<string, boolean>)[key]);
  }
  return {
    look: {
      basemap: live.basemap,
      windMode: live.windMode,
      wind: { ...live.wind },
      showSatImg: live.showSatImg,
    },
    overlays,
  };
}

export default function DirectorPanel({
  sceneId,
  config,
  update,
  liveState,
}: {
  sceneId: string;
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
  liveState: ControlState;
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
    <section className="director-panel" style={{ marginBottom: 18, borderBottom: "1px solid #1b2030", paddingBottom: 16 }}>
      <style>{`
        .director-panel input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 10px; border-radius: 6px; background: #2a3344; outline: none; cursor: pointer; }
        .director-panel input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 3px solid #3a7bd5; cursor: pointer; }
        .director-panel input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 3px solid #3a7bd5; cursor: pointer; }
        .director-panel input[type=range]:focus-visible { box-shadow: 0 0 0 2px #3a7bd5; }
      `}</style>
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
        Transition: <strong style={{ fontSize: 15 }}>{config.transitionSeconds}s</strong>
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

      {/* Look per shot type — per-kind overlay on/off, basemap, and wind look,
          layered onto that kind's preset (see DirectorConfig.overlayOverrides
          / kindLooks). Every eligible kind gets a block, even ones with no
          overlay toggles (ad/summary), since basemap + wind still apply. */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Look per shot type:</div>
        {SEGMENT_KINDS.filter((k) => config.kinds[k]).map((kind) => {
          const keys = overlayTogglesFor(kind);
          const look = config.kindLooks[kind];
          const hasCustomWind = !!look?.wind || !!look?.windMode;
          return (
            <div
              key={kind}
              style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #1b2030" }}
            >
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{KIND_LABEL[kind]}</div>

              {(() => {
                const slides = config.kindSlides[kind] ?? [];
                const activeId = config.activeSlideId[kind];
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ opacity: 0.7, fontSize: 12 }}>Slide:</span>
                    <select
                      value={activeId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        const slide = slides.find((s) => s.id === id);
                        update({
                          kindLooks: { ...config.kindLooks, [kind]: slide ? { ...slide.look } : {} },
                          overlayOverrides: { ...config.overlayOverrides, [kind]: slide ? { ...slide.overlays } : {} },
                          activeSlideId: { ...config.activeSlideId, [kind]: id || null },
                        });
                      }}
                      style={{ ...box, padding: "3px 6px" }}
                    >
                      <option value="">— custom (unsaved) —</option>
                      {slides.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const name = window.prompt("Name this slide:");
                        if (!name) return;
                        const snapshot = slideFromLive(kind, liveState);
                        const newSlide: KindSlide = { id: crypto.randomUUID(), name, ...snapshot };
                        update({
                          kindSlides: { ...config.kindSlides, [kind]: [...slides, newSlide] },
                          kindLooks: { ...config.kindLooks, [kind]: newSlide.look },
                          overlayOverrides: { ...config.overlayOverrides, [kind]: newSlide.overlays },
                          activeSlideId: { ...config.activeSlideId, [kind]: newSlide.id },
                        });
                      }}
                      style={{ ...box, cursor: "pointer", padding: "3px 8px" }}
                      title="Save the current live map as a new slide for this shot type"
                    >
                      + Save as new
                    </button>
                    {activeId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const snapshot = slideFromLive(kind, liveState);
                            update({
                              kindSlides: {
                                ...config.kindSlides,
                                [kind]: slides.map((s) => (s.id === activeId ? { ...s, ...snapshot } : s)),
                              },
                              kindLooks: { ...config.kindLooks, [kind]: snapshot.look },
                              overlayOverrides: { ...config.overlayOverrides, [kind]: snapshot.overlays },
                            });
                          }}
                          style={{ ...box, cursor: "pointer", padding: "3px 8px" }}
                          title="Overwrite this slide with the current live map"
                        >
                          ⟳ Update
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm("Delete this slide?")) return;
                            update({
                              kindSlides: { ...config.kindSlides, [kind]: slides.filter((s) => s.id !== activeId) },
                              activeSlideId: { ...config.activeSlideId, [kind]: null },
                            });
                          }}
                          style={{ ...box, cursor: "pointer", padding: "3px 8px", color: "#ff6a6a" }}
                        >
                          ✕ Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                );
              })()}

              {keys.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginBottom: 6 }}>
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
              ) : null}

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6 }}>
                <span style={{ opacity: 0.7 }}>Basemap:</span>
                <select
                  value={look?.basemap ?? ""}
                  onChange={(e) =>
                    update({
                      kindLooks: {
                        ...config.kindLooks,
                        [kind]: { ...config.kindLooks[kind], basemap: e.target.value || null },
                      },
                    })
                  }
                  style={{ ...box, padding: "3px 6px" }}
                >
                  <option value="">Auto (kind default)</option>
                  {BASEMAPS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6 }}>
                <span style={{ opacity: 0.7 }}>Satellite:</span>
                <select
                  value={look?.showSatImg === false ? "off" : look?.satImgLook ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const sat: Partial<typeof look> =
                      v === ""
                        ? { showSatImg: null, satImgLook: null } // inherit live
                        : v === "off"
                          ? { showSatImg: false, satImgLook: null }
                          : { showSatImg: true, satImgLook: v };
                    update({
                      kindLooks: { ...config.kindLooks, [kind]: { ...config.kindLooks[kind], ...sat } },
                    });
                  }}
                  style={{ ...box, padding: "3px 6px" }}
                >
                  <option value="">Auto (inherit)</option>
                  <option value="off">Off</option>
                  {SATIMG_LOOKS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={hasCustomWind}
                  onChange={(e) =>
                    update({
                      kindLooks: {
                        ...config.kindLooks,
                        [kind]: e.target.checked
                          ? { ...config.kindLooks[kind], wind: { ...DEFAULT_WIND_SETTINGS }, windMode: "particles" }
                          : { ...config.kindLooks[kind], wind: null, windMode: null },
                      },
                    })
                  }
                />
                Custom wind for this shot type
              </label>

              {hasCustomWind ? (
                <div style={{ paddingLeft: 22, marginTop: 6 }}>
                  <WindControls
                    wind={{ ...DEFAULT_WIND_SETTINGS, ...look?.wind }}
                    mode={look?.windMode ?? "particles"}
                    onWind={(w) =>
                      update({
                        kindLooks: { ...config.kindLooks, [kind]: { ...config.kindLooks[kind], wind: w } },
                      })
                    }
                    onMode={(m) =>
                      update({
                        kindLooks: { ...config.kindLooks, [kind]: { ...config.kindLooks[kind], windMode: m } },
                      })
                    }
                  />
                </div>
              ) : null}
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
