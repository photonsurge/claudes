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
} from "@photonsurge/shared/control";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { SATELLITE_GROUPS } from "../lib/tracks/celestrak";
import { severityLabel } from "../lib/alerts";
import VariablePicker from "./VariablePicker";
import BasemapPicker from "./BasemapPicker";
import BasemapColorPicker from "./BasemapColorPicker";
import WindControls from "./WindControls";
import Timeline from "./Timeline";
import Legend from "./Legend";
import SearchFlyTo from "./SearchFlyTo";
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
            <Toggle
              label="Labels"
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
        </div>
      </Section>

      <Section title="Connectivity">
        <Toggle
          label="Submarine cables"
          checked={state.showCables}
          onChange={(showCables) => patch({ showCables })}
        />
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

      {state.activeVariable && (
        <Section title="Legend">
          <Legend
            variableId={state.activeVariable}
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
