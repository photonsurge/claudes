"use client";

/**
 * The operator console. Composes all the pickers/toggles and reports a new full
 * ControlState up via onChange (the /control page emits it live + persists).
 */
import type {
  ControlState,
  TrackStyle,
  TrackColorMode,
  TrackIconMode,
  ElevationLineColor,
  AudioMode,
} from "@photonsurge/shared/control";
import { AUDIO_MODES } from "@photonsurge/shared/control";
import { SATIMG_FEEDS, SATIMG_LOOKS } from "@photonsurge/shared/satimg/types";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { mapFreshness } from "../lib/manifest";
import { legendVariableFor } from "../lib/legend";
import { SATELLITE_GROUPS } from "../lib/tracks/celestrak";
import { severityLabel } from "../lib/alerts";
import VariablePicker from "./VariablePicker";
import BasemapPicker from "./BasemapPicker";
import BasemapColorPicker from "./BasemapColorPicker";
import WindControls from "./WindControls";
import Timeline from "./Timeline";
import Legend from "./Legend";
import SearchFlyTo from "./SearchFlyTo";
import AlertHazardChips from "./AlertHazardChips";
import { THEME_OPTIONS } from "./broadcast/config";

/**
 * Spin speed uses a LOG scale so the slow, cinematic 0.1–1°/s range — where a
 * linear 0.1–30 slider gives almost no travel — gets ~40% of the track and is
 * easy to dial in. Position 0..1 ↔ speed via 10^lerp(log10(min),log10(max),t).
 */
const SPIN_MIN = 0.1;
const SPIN_MAX = 30;
const spinPosToSpeed = (pos: number): number => {
  const lo = Math.log10(SPIN_MIN);
  const raw = Math.pow(10, lo + pos * (Math.log10(SPIN_MAX) - lo));
  // Round finely below 1°/s (0.05 steps), coarser above (0.5 steps).
  return raw < 1 ? Math.round(raw * 20) / 20 : Math.round(raw * 2) / 2;
};
const spinSpeedToPos = (speed: number): number => {
  const lo = Math.log10(SPIN_MIN);
  const clamped = Math.min(SPIN_MAX, Math.max(SPIN_MIN, speed));
  return (Math.log10(clamped) - lo) / (Math.log10(SPIN_MAX) - lo);
};
/** Wrap any longitude into the -180..180 range for the position slider. */
const normaliseLng = (lng: number): number => (((lng + 180) % 360) + 360) % 360 - 180;

/** Operator-facing labels for the audio bed's modes (see shared AUDIO_MODES). */
const AUDIO_MODE_LABELS: Record<AudioMode, string> = {
  auto: "Auto — follows broadcast",
  chill: "Chill Out",
  lounge: "Lounge House",
  deep: "Deep House",
  minimal: "Minimal Techno",
  breaks: "Breaks · Severe",
};

export interface ControlPanelProps {
  state: ControlState;
  manifest: WeatherManifest | null;
  onChange: (next: ControlState) => void;
  onFitBounds: (bbox: [number, number, number, number]) => void;
  onFlyTo?: (center: [number, number], zoom?: number) => void;
}

export default function ControlPanel({
  state,
  manifest,
  onChange,
  onFitBounds,
  onFlyTo,
}: ControlPanelProps) {
  const patch = (p: Partial<ControlState>) => onChange({ ...state, ...p });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section title="Variable">
        <VariablePicker
          value={state.activeVariable}
          onChange={(activeVariable) => patch({ activeVariable })}
        />
        {(() => {
          // Which supplier feeds the active map, and when it last updated.
          const f = mapFreshness(manifest, state.activeVariable, Date.now());
          if (!f) return null;
          return (
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.6)", display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{f.source}</span>
              <span>· run {f.runLabel}</span>
              <span>· updated {f.updatedLabel}</span>
            </div>
          );
        })()}
      </Section>

      <Section title="Layers">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Toggle label="Wind" checked={state.showWind} onChange={(showWind) => patch({ showWind })} />
          <Toggle
            label="Pressure"
            checked={state.showPressure}
            onChange={(showPressure) => patch({ showPressure })}
          />
          <Toggle
            label="Contours"
            checked={state.showContours}
            onChange={(showContours) => patch({ showContours })}
          />
          <Toggle label="Radar" checked={state.showRadar} onChange={(showRadar) => patch({ showRadar })} />
          <Toggle label="Cities" checked={state.showCities} onChange={(showCities) => patch({ showCities })} />
          <Toggle
            label="Atmosphere"
            checked={state.showAtmosphere}
            onChange={(showAtmosphere) => patch({ showAtmosphere })}
          />
          <Toggle
            label="Day/Night"
            checked={state.showDayNight}
            onChange={(showDayNight) => patch({ showDayNight })}
          />
          <Toggle
            label="Broadcast chrome"
            checked={state.showBroadcastChrome}
            onChange={(showBroadcastChrome) => patch({ showBroadcastChrome })}
          />
        </div>
        {state.showBroadcastChrome && (
          <div style={{ marginTop: 8 }}>
            <Field label="Theme">
              <select
                value={state.broadcastTheme}
                onChange={(e) => patch({ broadcastTheme: e.target.value })}
                aria-label="Broadcast theme"
                style={miniSelect}
              >
                {THEME_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Section>

      <Section title="Audio bed">
        {(() => {
          const audio = state.audio;
          const setAudio = (p: Partial<typeof audio>) => patch({ audio: { ...audio, ...p } });
          return (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                <Toggle label="Music" checked={audio.enabled} onChange={(enabled) => setAudio({ enabled })} />
                {audio.enabled && (
                  <>
                    <Field label="Mode">
                      <select
                        value={audio.mode}
                        onChange={(e) => setAudio({ mode: e.target.value as AudioMode })}
                        aria-label="Audio mode"
                        style={miniSelect}
                      >
                        {AUDIO_MODES.map((m) => (
                          <option key={m} value={m}>
                            {AUDIO_MODE_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <PillToggle label="🔇 Mute" checked={audio.muted} onChange={(muted) => setAudio({ muted })} />
                    <Field label="Volume">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={audio.volume}
                        onChange={(e) => setAudio({ volume: Number(e.target.value) })}
                        aria-label="Audio volume"
                      />
                      <span style={{ color: "#fff", width: 34, textAlign: "right" }}>
                        {Math.round(audio.volume * 100)}%
                      </span>
                    </Field>
                  </>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#8b95a7" }}>
                Generative music on <b>/watch</b> — Auto follows the on-air segment; browsers need one
                click on the watch page before audio can start (OBS plays immediately).
              </div>
            </>
          );
        })()}
      </Section>

      {state.showWind && (
        <Section title="Wind">
          <WindControls
            wind={state.wind}
            mode={state.windMode}
            onWind={(wind) => patch({ wind })}
            onMode={(windMode) => patch({ windMode })}
          />
        </Section>
      )}

      <Section title="Live tracks">
        <div style={{ display: "grid", gap: 8 }}>
          <TrackTypeCard
            kind="satellite"
            label="🛰 Satellites"
            enabled={state.showSatellites}
            onToggle={(showSatellites) => patch({ showSatellites })}
            style={state.satelliteStyle}
            onStyle={(satelliteStyle) => patch({ satelliteStyle })}
            colorModes={["kind", "altitude", "custom"]}
          >
            <Field label="Group">
              <select
                value={state.satelliteGroup}
                onChange={(e) => patch({ satelliteGroup: e.target.value })}
                aria-label="Satellite group"
                style={miniSelect}
              >
                {SATELLITE_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle
              label="Orbit rings"
              checked={state.showOrbits}
              onChange={(showOrbits) => patch({ showOrbits })}
            />
          </TrackTypeCard>

          <TrackTypeCard
            kind="aircraft"
            label="✈ Aircraft"
            enabled={state.showAircraft}
            onToggle={(showAircraft) => patch({ showAircraft })}
            style={state.aircraftStyle}
            onStyle={(aircraftStyle) => patch({ aircraftStyle })}
            colorModes={["kind", "speed", "altitude", "country", "custom"]}
          />

          <TrackTypeCard
            kind="ship"
            label="⛴ Ships"
            enabled={state.showShips}
            onToggle={(showShips) => patch({ showShips })}
            style={state.shipStyle}
            onStyle={(shipStyle) => patch({ shipStyle })}
            colorModes={["kind", "speed", "country", "custom"]}
          />
        </div>

        {(state.showSatellites || state.showAircraft || state.showShips) && (
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid #232a38",
            }}
          >
            <PillToggle
              label="🏷 Names"
              checked={state.showTrackLabels}
              onChange={(showTrackLabels) => patch({ showTrackLabels })}
            />
            {(state.showAircraft || state.showShips) && (
              <Toggle
                label="Trails"
                checked={state.showTrails}
                onChange={(showTrails) => patch({ showTrails })}
              />
            )}
            {(state.showAircraft || state.showShips) && state.showTrails && (
              <Field label="Length">
                <select
                  value={state.trailMinutes}
                  onChange={(e) => patch({ trailMinutes: Number(e.target.value) })}
                  aria-label="Trail length"
                  style={miniSelect}
                >
                  {[15, 30, 60, 120, 180].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {(state.showAircraft || state.showShips) && state.showTrails && (
              <Field label="Trail opacity">
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={state.trailOpacity}
                  onChange={(e) => patch({ trailOpacity: Number(e.target.value) })}
                  aria-label="Trail opacity"
                />
                <span style={{ color: "#fff", width: 32, textAlign: "right" }}>
                  {Math.round(state.trailOpacity * 100)}%
                </span>
              </Field>
            )}
          </div>
        )}
      </Section>

      <Section title="Alerts">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle
            label="Show alerts"
            checked={state.showAlerts}
            onChange={(showAlerts) => patch({ showAlerts })}
          />
          {state.showAlerts && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", color: "#8b95a7", fontSize: 12 }}>
              Min severity
              <select
                value={state.alertSeverityMin}
                onChange={(e) => patch({ alertSeverityMin: Number(e.target.value) })}
                aria-label="Alert min severity"
                style={{
                  background: "#1a1f2b",
                  color: "#fff",
                  border: "1px solid #333",
                  borderRadius: 5,
                  padding: "4px 6px",
                }}
              >
                {[0, 1, 2, 3, 4].map((r) => (
                  <option key={r} value={r}>
                    {r} — {severityLabel(r as 0)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {state.showAlerts && (
          <div style={{ marginTop: 10 }}>
            <AlertHazardChips
              hazardsOff={state.alertHazardsOff}
              onChange={(alertHazardsOff) => patch({ alertHazardsOff })}
            />
          </div>
        )}
      </Section>

      <Section title="Seismic">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle
            label="Earthquakes"
            checked={state.showSeismic}
            onChange={(showSeismic) => patch({ showSeismic })}
          />
          {state.showSeismic && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", color: "#8b95a7", fontSize: 12 }}>
              Min magnitude
              <select
                value={state.seismicMinMag}
                onChange={(e) => patch({ seismicMinMag: Number(e.target.value) })}
                aria-label="Seismic min magnitude"
                style={{
                  background: "#1a1f2b",
                  color: "#fff",
                  border: "1px solid #333",
                  borderRadius: 5,
                  padding: "4px 6px",
                }}
              >
                {[0, 1, 2.5, 4, 4.5, 5, 6].map((m) => (
                  <option key={m} value={m}>
                    M{m.toFixed(1)}+
                  </option>
                ))}
              </select>
            </label>
          )}
          <Toggle
            label="🔥 Wildfires"
            checked={state.showFires}
            onChange={(showFires) => patch({ showFires })}
          />
        </div>
      </Section>

      <Section title="Connectivity">
        <Toggle
          label="Submarine cables"
          checked={state.showCables}
          onChange={(showCables) => patch({ showCables })}
        />
        {state.showCables && (
          <div style={{ paddingLeft: 16 }}>
            <Toggle
              label="Cable names"
              checked={state.showCableLabels}
              onChange={(showCableLabels) => patch({ showCableLabels })}
            />
          </div>
        )}
      </Section>

      <Section title="Tectonics">
        <Toggle
          label="Plate boundaries"
          checked={state.showFaults}
          onChange={(showFaults) => patch({ showFaults })}
        />
      </Section>

      <Section title="Space weather">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle
            label="Aurora oval (magnetic activity)"
            checked={state.showAurora}
            onChange={(showAurora) => patch({ showAurora })}
          />
          <Toggle
            label="Magnetic field (global)"
            checked={state.showMagneticField}
            onChange={(showMagneticField) => patch({ showMagneticField })}
          />
        </div>
      </Section>

      <Section title="Satellite clouds">
        <Toggle
          label="Show cloud feeds"
          checked={state.showSatImg}
          onChange={(showSatImg) => patch({ showSatImg })}
        />
        {state.showSatImg && (
          <Field label="Look">
            <select
              aria-label="Satellite look"
              value={state.satImgLook}
              onChange={(e) => patch({ satImgLook: e.target.value })}
              style={{
                background: "#0a0e16",
                color: "#fff",
                border: "1px solid #2a3344",
                borderRadius: 6,
                padding: "3px 6px",
                fontSize: 12,
              }}
            >
              {SATIMG_LOOKS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {state.showSatImg && (
          <div style={{ fontSize: 11, color: "#8b95a7", margin: "2px 0 6px 2px" }}>
            Look applies to the live discs (GOES · Meteosat · Himawari); each falls back to
            IR where it lacks that composite.
          </div>
        )}
        {state.showSatImg &&
          SATIMG_FEEDS.map((feed) => {
            const fs = state.satImgFeeds[feed.id] ?? { on: false, opacity: 0.85 };
            const setFeed = (p: Partial<typeof fs>) =>
              patch({ satImgFeeds: { ...state.satImgFeeds, [feed.id]: { ...fs, ...p } } });
            return (
              <div key={feed.id} style={{ marginTop: 6 }}>
                <Toggle label={feed.label} checked={fs.on} onChange={(on) => setFeed({ on })} />
                <div style={{ fontSize: 11, color: "#8b95a7", margin: "2px 0 0 2px" }}>{feed.region}</div>
                {fs.on && (
                  <Field label="Opacity">
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={fs.opacity}
                      onChange={(e) => setFeed({ opacity: Number(e.target.value) })}
                      aria-label={`${feed.label} opacity`}
                    />
                    <span style={{ color: "#fff", width: 32, textAlign: "right" }}>
                      {Math.round(fs.opacity * 100)}%
                    </span>
                  </Field>
                )}
              </div>
            );
          })}
      </Section>

      <Section title="Debug">
        <Toggle
          label="Show map source (bbox + name)"
          checked={state.showMapSource}
          onChange={(showMapSource) => patch({ showMapSource })}
        />
      </Section>

      <Section title="Terrain">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle
            label="Elevation contours"
            checked={state.showElevation}
            onChange={(showElevation) => patch({ showElevation })}
          />
          {state.showElevation && (() => {
            const el = state.elevation;
            const setElev = (p: Partial<typeof el>) => patch({ elevation: { ...el, ...p } });
            return (
              <>
                <Field label="Colour">
                  <select
                    value={el.colorMode}
                    onChange={(e) => setElev({ colorMode: e.target.value as ElevationLineColor })}
                    aria-label="Contour colour mode"
                    style={miniSelect}
                  >
                    <option value="default">Default</option>
                    <option value="elevation">By height</option>
                    <option value="custom">Custom</option>
                  </select>
                  {el.colorMode === "custom" && (
                    <input
                      type="color"
                      value={el.color}
                      onChange={(e) => setElev({ color: e.target.value })}
                      aria-label="Contour colour"
                      style={{ width: 28, height: 22, padding: 0, border: "1px solid #333", borderRadius: 4, background: "none" }}
                    />
                  )}
                </Field>
                <Field label="Width">
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.5}
                    value={el.width}
                    onChange={(e) => setElev({ width: Number(e.target.value) })}
                    aria-label="Contour line width"
                  />
                  <span style={{ color: "#fff", width: 30, textAlign: "right" }}>{el.width}px</span>
                </Field>
                <Field label="Opacity">
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={el.opacity}
                    onChange={(e) => setElev({ opacity: Number(e.target.value) })}
                    aria-label="Contour opacity"
                  />
                  <span style={{ color: "#fff", width: 34, textAlign: "right" }}>{Math.round(el.opacity * 100)}%</span>
                </Field>
                <Field label="Line every">
                  <select
                    value={el.interval}
                    onChange={(e) => setElev({ interval: Number(e.target.value) })}
                    aria-label="Elevation contour interval"
                    style={miniSelect}
                  >
                    {[100, 250, 500, 1000, 2000].map((m) => (
                      <option key={m} value={m}>
                        {m >= 1000 ? `${m / 1000} km` : `${m} m`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bold every">
                  <select
                    value={el.majorInterval}
                    onChange={(e) => setElev({ majorInterval: Number(e.target.value) })}
                    aria-label="Elevation major contour interval"
                    style={miniSelect}
                  >
                    {[1000, 2000, 5000, 10000].map((m) => (
                      <option key={m} value={m}>
                        {m / 1000} km
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            );
          })()}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#8b95a7" }}>
          Tip: pick the <b>Relief</b> basemap below for the full shaded-relief terrain map.
        </div>
      </Section>

      <Section title="Graticule">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle
            label="Grid lines"
            checked={state.showGraticule}
            onChange={(showGraticule) => patch({ showGraticule })}
          />
          {state.showGraticule && (
            <>
              <label style={miniLabel}>
                Colour
                <input
                  type="color"
                  value={state.graticuleColor}
                  onChange={(e) => patch({ graticuleColor: e.target.value })}
                  aria-label="Graticule colour"
                  style={{ width: 28, height: 22, padding: 0, border: "1px solid #333", borderRadius: 4, background: "none" }}
                />
              </label>
              <Toggle
                label="Labels"
                checked={state.graticuleLabels}
                onChange={(graticuleLabels) => patch({ graticuleLabels })}
              />
            </>
          )}
        </div>
      </Section>

      <Section title="Timeline">
        <Timeline
          manifest={manifest}
          fhr={state.fhr}
          activeVariable={state.activeVariable}
          showWind={state.showWind}
          onChange={(fhr) => patch({ fhr })}
        />
      </Section>

      <Section title="Basemap">
        <BasemapPicker value={state.basemap} onChange={(basemap) => patch({ basemap })} />
      </Section>

      {state.basemap === "dark" && (
        <Section title="Basemap colours">
          <BasemapColorPicker
            value={state.basemapColors}
            onChange={(basemapColors) => patch({ basemapColors })}
          />
        </Section>
      )}

      <Section title="Camera">
        <SearchFlyTo onFitBounds={onFitBounds} onFlyTo={onFlyTo} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <Toggle
            label="Auto-spin"
            checked={state.autoSpin}
            // Stamp the spin epoch on enable so /control + /watch share the phase.
            onChange={(autoSpin) => patch(autoSpin ? { autoSpin, spinEpoch: Date.now() } : { autoSpin })}
          />
          {state.autoSpin ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b95a7", fontSize: 12 }}>
              Speed
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={spinSpeedToPos(state.spinSpeed)}
                // Re-anchor on speed change: the live longitude is
                // anchor + spinSpeed·(now − epoch), so changing spinSpeed alone
                // would jump the globe by the whole accumulated offset. Bake the
                // current longitude into the anchor and restart the epoch so only
                // the rate changes — position stays continuous.
                onChange={(e) => {
                  const now = Date.now();
                  const lng =
                    state.camera.center[0] +
                    state.spinSpeed * ((now - (state.spinEpoch || now)) / 1000);
                  patch({
                    spinSpeed: spinPosToSpeed(Number(e.target.value)),
                    spinEpoch: now,
                    camera: {
                      center: [normaliseLng(lng), state.camera.center[1]],
                      zoom: state.camera.zoom,
                    },
                  });
                }}
                aria-label="Spin speed"
              />
              <span style={{ color: "#fff", width: 44, textAlign: "right" }}>{state.spinSpeed}°/s</span>
            </label>
          ) : (
            // Auto-spin off: hold the globe at a chosen longitude (rotate by hand).
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b95a7", fontSize: 12 }}>
              Position
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={normaliseLng(state.camera.center[0])}
                onChange={(e) =>
                  patch({
                    camera: {
                      center: [Number(e.target.value), state.camera.center[1]],
                      zoom: state.camera.zoom,
                    },
                  })
                }
                aria-label="Globe longitude"
              />
              <span style={{ color: "#fff", width: 44, textAlign: "right" }}>
                {Math.round(normaliseLng(state.camera.center[0]))}°
              </span>
            </label>
          )}
        </div>
      </Section>

      {legendVariableFor(state) && (
        <Section title="Legend">
          <Legend
            variableId={legendVariableFor(state)}
            units={state.units}
            onUnitsChange={(units) => patch({ units })}
          />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 6px", fontSize: 12, textTransform: "uppercase", color: "#8b95a7", letterSpacing: 0.5 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

const COLOR_LABELS: Record<TrackColorMode, string> = {
  kind: "Default",
  speed: "Speed",
  altitude: "Altitude",
  country: "Country",
  custom: "Custom",
};
const ICON_LABELS: Record<TrackIconMode, string> = { dot: "Dots", arrow: "Arrows", glyph: "Glyphs" };
const miniSelect: React.CSSProperties = {
  background: "#1a1f2b",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 5,
  padding: "3px 5px",
  fontSize: 12,
};
const miniLabel: React.CSSProperties = { display: "flex", gap: 5, alignItems: "center", color: "#8b95a7", fontSize: 12 };
const textInput: React.CSSProperties = { ...miniSelect, width: 120 };

/** Labelled control row used throughout the track cards. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={miniLabel}>
      {label}
      {children}
    </label>
  );
}

/** Satellite altitude bands → [minAltM, maxAltM]. GEO ≈ 35,786 km. */
const SAT_BANDS: Record<string, [number, number]> = {
  all: [0, 0],
  leo: [0, 2_000_000],
  meo: [2_000_000, 35_000_000],
  geo: [35_000_000, 0],
};
const satBandOf = (s: TrackStyle): string => {
  const min = s.minAltM ?? 0;
  const max = s.maxAltM ?? 0;
  if (!min && !max) return "all";
  if (!min && max <= 2_000_000) return "leo";
  if (min >= 35_000_000) return "geo";
  return "meo";
};

/**
 * Per-type live-track card: an enable toggle in line with its style + filter
 * controls (colour mode + custom swatch, icon, opacity, and display filters).
 * `children` carries type-specific extras (satellite group/orbit rings).
 */
function TrackTypeCard({
  kind,
  label,
  enabled,
  onToggle,
  style,
  onStyle,
  colorModes,
  children,
}: {
  kind: "satellite" | "aircraft" | "ship";
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  style: TrackStyle;
  onStyle: (s: TrackStyle) => void;
  colorModes: TrackColorMode[];
  children?: React.ReactNode;
}) {
  const set = (p: Partial<TrackStyle>) => onStyle({ ...style, ...p });
  const swatch = style.color === "custom" ? style.customColor ?? "#ffffff" : undefined;
  return (
    <div
      style={{
        border: "1px solid #232a38",
        borderRadius: 8,
        padding: enabled ? "8px 10px 10px" : "8px 10px",
        background: enabled ? "#141a25" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Toggle label={label} checked={enabled} onChange={onToggle} />
        {swatch && (
          <span
            aria-hidden
            style={{ width: 12, height: 12, borderRadius: 3, background: swatch, border: "1px solid #0006" }}
          />
        )}
      </div>

      {enabled && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <Field label="Color">
            <select
              value={style.color}
              onChange={(e) => set({ color: e.target.value as TrackColorMode })}
              aria-label={`${label} colour mode`}
              style={miniSelect}
            >
              {colorModes.map((m) => (
                <option key={m} value={m}>
                  {COLOR_LABELS[m]}
                </option>
              ))}
            </select>
            {style.color === "custom" && (
              <input
                type="color"
                value={style.customColor ?? "#ffffff"}
                onChange={(e) => set({ customColor: e.target.value })}
                aria-label={`${label} custom colour`}
                style={{ width: 28, height: 22, padding: 0, border: "1px solid #333", borderRadius: 4, background: "none" }}
              />
            )}
          </Field>

          {kind !== "satellite" && (
            <Field label="Icon">
              <select
                value={style.icon}
                onChange={(e) => set({ icon: e.target.value as TrackIconMode })}
                aria-label={`${label} icon mode`}
                style={miniSelect}
              >
                {(["dot", "arrow", "glyph"] as TrackIconMode[]).map((m) => (
                  <option key={m} value={m}>
                    {ICON_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Opacity">
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={style.opacity ?? 1}
              onChange={(e) => set({ opacity: Number(e.target.value) })}
              aria-label={`${label} opacity`}
            />
            <span style={{ color: "#fff", width: 32, textAlign: "right" }}>
              {Math.round((style.opacity ?? 1) * 100)}%
            </span>
          </Field>

          {children}

          {/* ── Filters ── */}
          {kind === "satellite" ? (
            <Field label="Altitude">
              <select
                value={satBandOf(style)}
                onChange={(e) => {
                  const [minAltM, maxAltM] = SAT_BANDS[e.target.value] ?? [0, 0];
                  set({ minAltM, maxAltM });
                }}
                aria-label="Satellite altitude band"
                style={miniSelect}
              >
                <option value="all">All orbits</option>
                <option value="leo">LEO (&lt;2,000 km)</option>
                <option value="meo">MEO (2k–35k km)</option>
                <option value="geo">GEO (&gt;35,000 km)</option>
              </select>
            </Field>
          ) : (
            <>
              {kind === "aircraft" && (
                <Field label="Min alt">
                  <input
                    type="range"
                    min={0}
                    max={13000}
                    step={250}
                    value={style.minAltM ?? 0}
                    onChange={(e) => set({ minAltM: Number(e.target.value) })}
                    aria-label="Aircraft minimum altitude"
                  />
                  <span style={{ color: "#fff", width: 52, textAlign: "right" }}>
                    {(style.minAltM ?? 0) === 0 ? "off" : `${Math.round((style.minAltM ?? 0) / 100) / 10}km`}
                  </span>
                </Field>
              )}
              <Field label={kind === "ship" ? "Min kn" : "Min m/s"}>
                <input
                  type="range"
                  min={0}
                  max={kind === "ship" ? 30 : 300}
                  step={kind === "ship" ? 1 : 5}
                  value={style.minSpeed ?? 0}
                  onChange={(e) => set({ minSpeed: Number(e.target.value) })}
                  aria-label={`${label} minimum speed`}
                />
                <span style={{ color: "#fff", width: 40, textAlign: "right" }}>
                  {(style.minSpeed ?? 0) === 0 ? "off" : style.minSpeed}
                </span>
              </Field>
              {kind === "aircraft" && (
                <Toggle
                  label="Hide on-ground"
                  checked={!!style.hideGround}
                  onChange={(hideGround) => set({ hideGround })}
                />
              )}
            </>
          )}

          <Field label="Country">
            <input
              type="text"
              value={style.country ?? ""}
              placeholder="any (e.g. United States, China)"
              onChange={(e) => set({ country: e.target.value })}
              aria-label={`${label} country filter`}
              style={textInput}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: 6, alignItems: "center", color: "#fff", fontSize: 13 }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      {label}
    </label>
  );
}

/**
 * A high-visibility pill toggle for controls that are easy to overlook as a
 * bare checkbox (e.g. track name labels). Reads as a filled cyan button when on,
 * a dim outlined one when off, so its state is obvious at a glance.
 */
function PillToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        border: checked ? "1px solid #38bdf8" : "1px solid #38414f",
        background: checked ? "#38bdf8" : "transparent",
        color: checked ? "#0a0e16" : "#8b95a5",
        boxShadow: checked ? "0 0 10px rgba(56,189,248,0.45)" : "none",
        transition: "all 120ms ease",
      }}
    >
      {label}
    </button>
  );
}
