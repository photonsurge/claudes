"use client";

/**
 * Operator controls for the per-scene auto-director. Off/Auto toggle, per-kind
 * (and per-event-level) hold times, which kinds are eligible, event thresholds,
 * a Skip button, which basemap "map types" each touring kind (intro/ocean/quake)
 * cycles through, and a saved-"slide" library per kind (save/load/update/
 * delete a named snapshot of the live map's basemap, satellite, wind, and
 * overlay toggles) — plus a live "on air / up next" readout fed by the
 * worker's director:state. `config`/`update` are lifted
 * to the parent (/control) so the live preview shares the exact same config the
 * operator is editing here; edits PATCH the scene's director config and the
 * worker picks them up within ~1s.
 *
 * While auto is actually running, the setup form below the on-air readout is
 * replaced by a "Recently aired" session log (client-only, resets on reload) —
 * the operator glances at what's played rather than re-fiddling the setup form
 * mid-broadcast. "⚙ Settings" swaps back to the full form without leaving auto.
 */
import { useEffect, useRef, useState } from "react";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import {
  INTRO_MAP_TYPES,
  OCEAN_MAP_TYPES,
  QUAKE_MAP_TYPES,
  OVERLAY_KEYS,
  type GlobalMapType,
} from "@photonsurge/shared/director-rois";
import { SEGMENT_KINDS, type DirectorConfig, type KindSlide, type SegmentKind } from "@photonsurge/shared/director";
import { mergeControlState, type ControlState } from "@photonsurge/shared/control";
import { useDirector } from "../lib/director";
import DirectorHolds, { KIND_LABEL } from "./DirectorHolds";

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

/**
 * Snapshot the live operator map into a slide's look + every toggleable
 * overlay (see OVERLAY_KEYS) — a slide should reproduce the whole look
 * exactly, not just the layers this kind's preset happens to default on.
 */
function slideFromLive(live: ControlState): Pick<KindSlide, "look" | "overlays"> {
  const overlays: Partial<Record<string, boolean>> = {};
  for (const key of OVERLAY_KEYS) {
    overlays[key] = Boolean((live as unknown as Record<string, boolean>)[key]);
  }
  const satImgFeeds: Record<string, ControlState["satImgFeeds"][string]> = {};
  for (const [id, feed] of Object.entries(live.satImgFeeds ?? {})) satImgFeeds[id] = { ...feed };
  return {
    look: {
      basemap: live.basemap,
      windMode: live.windMode,
      wind: { ...live.wind },
      showSatImg: live.showSatImg,
      activeVariable: live.activeVariable,
      satImgFeeds,
    },
    overlays,
  };
}

/** The live-map patch a slide would apply — the inverse of slideFromLive. */
function controlPatchFromSlide(slide: KindSlide, live: ControlState): Partial<ControlState> {
  const patch: Partial<ControlState> = { ...slide.overlays };
  if (slide.look.basemap) patch.basemap = slide.look.basemap;
  if (slide.look.windMode) patch.windMode = slide.look.windMode;
  if (slide.look.wind) patch.wind = { ...live.wind, ...slide.look.wind };
  if (typeof slide.look.showSatImg === "boolean") patch.showSatImg = slide.look.showSatImg;
  if (slide.look.activeVariable) patch.activeVariable = slide.look.activeVariable;
  if (slide.look.satImgFeeds) patch.satImgFeeds = slide.look.satImgFeeds as ControlState["satImgFeeds"];
  return patch;
}

function shallowEqual(a: Record<string, unknown> | undefined | null, b: Record<string, unknown> | undefined | null): boolean {
  const ao = a ?? {};
  const bo = b ?? {};
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if ((ao as Record<string, unknown>)[k] !== (bo as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Per-feed satImgFeeds equality — each feed compared field-by-field, not by reference. */
function satImgFeedsEqual(
  a: Partial<Record<string, unknown>> | null | undefined,
  b: Partial<Record<string, unknown>> | null | undefined,
): boolean {
  const ao = a ?? {};
  const bo = b ?? {};
  const ids = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const id of ids) {
    if (!shallowEqual(ao[id] as Record<string, unknown>, bo[id] as Record<string, unknown>)) return false;
  }
  return true;
}

/**
 * Whether a slide's saved look+overlays exactly match the current live
 * snapshot — used so the "active" highlight reflects reality (settings match)
 * rather than a stale remembered id (e.g. after loading a different kind's
 * slide changed the one shared live map, or after hand-tweaking the globe).
 */
function slideIsLive(slide: KindSlide, live: ControlState): boolean {
  const current = slideFromLive(live);
  return (
    (slide.look.basemap ?? null) === (current.look.basemap ?? null) &&
    (slide.look.windMode ?? null) === (current.look.windMode ?? null) &&
    (slide.look.showSatImg ?? null) === (current.look.showSatImg ?? null) &&
    (slide.look.activeVariable ?? null) === (current.look.activeVariable ?? null) &&
    shallowEqual(slide.look.wind, current.look.wind) &&
    satImgFeedsEqual(slide.look.satImgFeeds, current.look.satImgFeeds) &&
    shallowEqual(slide.overlays, current.overlays)
  );
}

/** Compact "how long ago" for the session log (seconds/minutes only — this is a
 *  recent-history glance, not a durable timestamped record). */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export default function DirectorPanel({
  sceneId,
  config,
  update,
  liveState,
  applyLive,
}: {
  sceneId: string;
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
  liveState: ControlState;
  applyLive: (next: ControlState) => void;
}) {
  const live = useDirector(sceneId);
  const auto = config.mode === "auto";

  // Brief "Updated ✓" flash per kind after hitting the slide Update button —
  // otherwise the action is silent and looks like it did nothing.
  const [justUpdated, setJustUpdated] = useState<Partial<Record<SegmentKind, boolean>>>({});
  const flashUpdated = (kind: SegmentKind) => {
    setJustUpdated((prev) => ({ ...prev, [kind]: true }));
    setTimeout(() => setJustUpdated((prev) => ({ ...prev, [kind]: false })), 1500);
  };

  // Live countdown for the on-air readout.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const remaining = live?.endsAt ? Math.max(0, Math.round((live.endsAt - now) / 1000)) : 0;

  // Session log: every kind/title that's aired, newest first — a lightweight,
  // client-only history (resets on page reload, this isn't a durable record).
  // While the show is actually playing the operator mostly wants to glance at
  // what's already run + what's up next, not re-fiddle the setup form, so this
  // replaces the full config form below (toggle back with "⚙ Settings").
  const [history, setHistory] = useState<{ kind: SegmentKind; title: string; ts: number }[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const lastLoggedRef = useRef<{ seq: number; kind: SegmentKind; title: string } | null>(null);
  useEffect(() => {
    if (!live?.segment) return;
    const prior = lastLoggedRef.current;
    if (prior && prior.seq !== live.seq) {
      setHistory((h) => [{ kind: prior.kind, title: prior.title, ts: Date.now() }, ...h].slice(0, 10));
    }
    lastLoggedRef.current = { seq: live.seq, kind: live.segment.kind, title: live.segment.title };
  }, [live?.seq, live?.segment]);
  // Auto mode just switched on/off — reset the log-vs-settings toggle so it
  // doesn't come back up already showing settings from a prior session.
  useEffect(() => {
    setShowSettings(false);
  }, [auto]);

  // Pre-broadcast countdown (ControlState.startAt) — a "starting in…" screen
  // on /watch, independent of auto-director mode.
  const [countdownSecs, setCountdownSecs] = useState(30);
  const countdownRemaining = liveState.startAt ? Math.max(0, Math.ceil((liveState.startAt - now) / 1000)) : 0;
  const countdownActive = liveState.startAt != null && countdownRemaining > 0;

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
        {auto ? (
          <button
            onClick={() => setShowSettings((s) => !s)}
            style={{ ...box, cursor: "pointer" }}
            title={showSettings ? "Back to the session log" : "Edit setup while the show is running"}
          >
            {showSettings ? "📜 Log" : "⚙ Settings"}
          </button>
        ) : null}
      </div>

      {/* Pre-broadcast countdown */}
      <div style={{ ...box, marginBottom: 12, padding: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.7, marginBottom: 8 }}>
          PRE-BROADCAST COUNTDOWN
        </div>
        {countdownActive ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 20, fontWeight: 800 }}>{countdownRemaining}s</span>
            <button
              onClick={() => applyLive(mergeControlState(liveState, { startAt: null }))}
              style={{ ...box, cursor: "pointer" }}
            >
              Go live now
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min={5}
              max={600}
              value={countdownSecs}
              onChange={(e) => setCountdownSecs(Math.max(5, Number(e.target.value) || 30))}
              style={{ ...box, width: 64 }}
            />
            <span style={{ fontSize: 12, opacity: 0.7 }}>seconds</span>
            <button
              onClick={() => applyLive(mergeControlState(liveState, { startAt: Date.now() + countdownSecs * 1000 }))}
              style={{ ...box, cursor: "pointer", fontWeight: 700, flex: 1, background: "#1f7a3f", borderColor: "#2bbe63" }}
            >
              Start countdown ▶
            </button>
          </div>
        )}
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

      {/* While auto is actually running, the operator mostly wants a glance at
          what's aired + what's next, not the full setup form — that's one
          "⚙ Settings" click away. Off (or "⚙ Settings" clicked), show the form. */}
      {auto && !showSettings ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Recently aired:</div>
          {history.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {history.map((h, i) => (
                <div
                  key={i}
                  style={{ fontSize: 12, opacity: 0.75, display: "flex", justifyContent: "space-between", gap: 8 }}
                >
                  <span>
                    {KIND_LABEL[h.kind]} · {h.title}
                  </span>
                  <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>{agoLabel(now - h.ts)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, opacity: 0.5 }}>Nothing aired yet this session.</div>
          )}
        </div>
      ) : (
        <>
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

      {/* Look per shot type — a saved-slide library per kind (see
          DirectorConfig.kindSlides/activeSlideId). Save/Update snapshot the
          live map (basemap, satellite, wind, this kind's overlay toggles)
          into a named slide; clicking a slide loads it via that kind's
          kindLooks/overlayOverrides. */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Look per shot type:</div>
        {/* Round-up (summary) tours its own generated stops rather than holding
            one fixed look, so a saved slide wouldn't mean anything for it. */}
        {SEGMENT_KINDS.filter((k) => config.kinds[k] && k !== "summary").map((kind) => {
          const slides = config.kindSlides[kind] ?? [];
          const activeId = config.activeSlideId[kind];
          const load = (id: string) => {
            const slide = slides.find((s) => s.id === id);
            update({
              kindLooks: { ...config.kindLooks, [kind]: slide ? { ...slide.look } : {} },
              overlayOverrides: { ...config.overlayOverrides, [kind]: slide ? { ...slide.overlays } : {} },
              activeSlideId: { ...config.activeSlideId, [kind]: id },
            });
            // Also push it onto the live map immediately — kindLooks/overlayOverrides
            // above only take effect once the director actually cuts to this kind,
            // so without this a slide switch shows no visible change while idle.
            if (slide) applyLive(mergeControlState(liveState, controlPatchFromSlide(slide, liveState)));
          };
          const saveNew = () => {
            const name = window.prompt("Name this slide:");
            if (!name) return;
            const snapshot = slideFromLive(liveState);
            const newSlide: KindSlide = { id: crypto.randomUUID(), name, ...snapshot };
            update({
              kindSlides: { ...config.kindSlides, [kind]: [...slides, newSlide] },
              kindLooks: { ...config.kindLooks, [kind]: newSlide.look },
              overlayOverrides: { ...config.overlayOverrides, [kind]: newSlide.overlays },
              activeSlideId: { ...config.activeSlideId, [kind]: newSlide.id },
            });
          };
          const updateSelected = () => {
            if (!activeId) return;
            const snapshot = slideFromLive(liveState);
            update({
              kindSlides: {
                ...config.kindSlides,
                [kind]: slides.map((s) => (s.id === activeId ? { ...s, ...snapshot } : s)),
              },
              kindLooks: { ...config.kindLooks, [kind]: snapshot.look },
              overlayOverrides: { ...config.overlayOverrides, [kind]: snapshot.overlays },
            });
            flashUpdated(kind);
          };
          const renameSlide = (id: string) => {
            const current = slides.find((s) => s.id === id);
            const name = window.prompt("Rename this slide:", current?.name ?? "");
            if (!name) return;
            update({
              kindSlides: { ...config.kindSlides, [kind]: slides.map((s) => (s.id === id ? { ...s, name } : s)) },
            });
          };
          const deleteSlide = (id: string) => {
            if (!window.confirm("Delete this slide?")) return;
            update({
              kindSlides: { ...config.kindSlides, [kind]: slides.filter((s) => s.id !== id) },
              activeSlideId: activeId === id ? { ...config.activeSlideId, [kind]: null } : config.activeSlideId,
            });
          };
          const copyTo = (slide: KindSlide, target: SegmentKind) => {
            const copy: KindSlide = { ...slide, id: crypto.randomUUID() };
            update({
              kindSlides: { ...config.kindSlides, [target]: [...(config.kindSlides[target] ?? []), copy] },
            });
          };
          return (
            <div key={kind} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #1b2030" }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{KIND_LABEL[kind]}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {slides.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.5 }}>No saved slides yet</div>
                ) : (
                  slides.map((s) => {
                    const selected = s.id === activeId;
                    // Only glow green when the live map still exactly matches this
                    // slide — selecting it (or another kind's slide) can drift the
                    // shared live map away without clearing the stale id.
                    const isLive = selected && slideIsLive(s, liveState);
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => load(s.id)}
                          style={{
                            ...box,
                            flex: 1,
                            textAlign: "left",
                            cursor: "pointer",
                            background: isLive ? "#1f7a3f" : box.background,
                            borderColor: isLive ? "#2bbe63" : selected ? "#3a7bd5" : "#2a3344",
                          }}
                        >
                          {s.name}
                          {selected && !isLive ? (
                            <span style={{ opacity: 0.6, fontSize: 11 }}> (modified)</span>
                          ) : null}
                        </button>
                        {selected ? (
                          <button
                            type="button"
                            onClick={updateSelected}
                            style={{ ...box, cursor: "pointer", padding: "3px 8px" }}
                            title="Overwrite this slide with the current live map"
                          >
                            {justUpdated[kind] ? "✓ Updated" : "⟳ Update"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => renameSlide(s.id)}
                          style={{ ...box, cursor: "pointer", padding: "3px 8px" }}
                          title="Rename this slide"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSlide(s.id)}
                          style={{ ...box, cursor: "pointer", padding: "3px 8px", color: "#ff6a6a" }}
                          title="Delete this slide"
                        >
                          ✕
                        </button>
                        <select
                          value=""
                          onChange={(e) => {
                            const target = e.target.value as SegmentKind;
                            if (target) copyTo(s, target);
                          }}
                          style={{ ...box, padding: "3px 4px", fontSize: 12 }}
                          title="Copy this slide to another shot type"
                        >
                          <option value="">⧉ Copy to…</option>
                          {SEGMENT_KINDS.filter((k) => k !== kind && config.kinds[k]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })
                )}
                <button
                  type="button"
                  onClick={saveNew}
                  style={{ ...box, cursor: "pointer", alignSelf: "flex-start" }}
                  title="Save the current live map as a new slide for this shot type"
                >
                  + Save current look as new slide
                </button>
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
        </>
      )}
    </section>
  );
}
