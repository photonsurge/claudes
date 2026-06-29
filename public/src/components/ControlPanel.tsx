"use client";

/**
 * The operator console. Composes all the pickers/toggles and reports a new full
 * ControlState up via onChange (the /control page emits it live + persists).
 */
import type { ControlState } from "@photonsurge/shared/control";
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
        </div>
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
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle
            label="Satellites"
            checked={state.showSatellites}
            onChange={(showSatellites) => patch({ showSatellites })}
          />
          <Toggle
            label="Aircraft"
            checked={state.showAircraft}
            onChange={(showAircraft) => patch({ showAircraft })}
          />
          <Toggle label="Ships" checked={state.showShips} onChange={(showShips) => patch({ showShips })} />
          {state.showSatellites && (
            <select
              value={state.satelliteGroup}
              onChange={(e) => patch({ satelliteGroup: e.target.value })}
              aria-label="Satellite group"
              style={{
                background: "#1a1f2b",
                color: "#fff",
                border: "1px solid #333",
                borderRadius: 5,
                padding: "4px 6px",
                fontSize: 12,
              }}
            >
              {SATELLITE_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
        </div>
        {(state.showSatellites || state.showAircraft || state.showShips) && (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <Toggle
              label="Labels"
              checked={state.showTrackLabels}
              onChange={(showTrackLabels) => patch({ showTrackLabels })}
            />
            {state.showSatellites && (
              <Toggle
                label="Orbit rings"
                checked={state.showOrbits}
                onChange={(showOrbits) => patch({ showOrbits })}
              />
            )}
            {(state.showAircraft || state.showShips) && (
              <Toggle
                label="Trails"
                checked={state.showTrails}
                onChange={(showTrails) => patch({ showTrails })}
              />
            )}
            {(state.showAircraft || state.showShips) && state.showTrails && (
              <label
                style={{ display: "flex", gap: 6, alignItems: "center", color: "#8b95a7", fontSize: 12 }}
              >
                Length
                <select
                  value={state.trailMinutes}
                  onChange={(e) => patch({ trailMinutes: Number(e.target.value) })}
                  aria-label="Trail length"
                  style={{
                    background: "#1a1f2b",
                    color: "#fff",
                    border: "1px solid #333",
                    borderRadius: 5,
                    padding: "4px 6px",
                    fontSize: 12,
                  }}
                >
                  {[15, 30, 60, 120, 180].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(state.showAircraft || state.showShips) && state.showTrails && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", color: "#8b95a7", fontSize: 12 }}>
                Opacity
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={state.trailOpacity}
                  onChange={(e) => patch({ trailOpacity: Number(e.target.value) })}
                  aria-label="Trail opacity"
                />
                <span style={{ color: "#fff", width: 30, textAlign: "right" }}>
                  {Math.round(state.trailOpacity * 100)}%
                </span>
              </label>
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
          {state.autoSpin && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b95a7", fontSize: 12 }}>
              Speed
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={state.spinSpeed}
                onChange={(e) => patch({ spinSpeed: Number(e.target.value) })}
                aria-label="Spin speed"
              />
              <span style={{ color: "#fff", width: 36, textAlign: "right" }}>{state.spinSpeed}°/s</span>
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
