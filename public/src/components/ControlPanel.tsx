"use client";

/**
 * The operator console. Composes all the pickers/toggles and reports a new full
 * ControlState up via onChange (the /control page emits it live + persists).
 */
import type { ControlState } from "@photonsurge/shared/control";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import VariablePicker from "./VariablePicker";
import BasemapPicker from "./BasemapPicker";
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
          <Toggle label="Cities" checked={state.showCities} onChange={(showCities) => patch({ showCities })} />
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

      <Section title="Camera">
        <SearchFlyTo onFitBounds={onFitBounds} onFlyTo={onFlyTo} />
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
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      {label}
    </label>
  );
}
