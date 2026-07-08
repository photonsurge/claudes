"use client";

// components/forecast/ForecastTimeline.tsx
// Presentational 3-hourly forecast timeline (today..+72h). Takes already-built
// steps so it stays decoupled from where they come from — the city page fetches
// them via usePointForecastSteps, director mode can feed the on-air focus
// point's steps straight in. No data fetching happens here.
//
// Two densities: the default boxed cells, and `slim` — a thin single strip
// (condition accent bar + temp + sparse hour tick) for compact panels.

import type { ForecastStep } from "../../lib/forecast-client";

const muted = "#8b95a7";

const CONDITION_GLYPH: Record<ForecastStep["condition"], string> = {
  sunny: "☀",
  "partly-cloudy": "⛅",
  cloudy: "☁",
  rain: "🌧",
  snow: "❄",
  storm: "⛈",
};

/** Accent-bar colour per condition, used by the slim strip. */
const CONDITION_COLOR: Record<ForecastStep["condition"], string> = {
  sunny: "#fbbf24",
  "partly-cloudy": "#93c5fd",
  cloudy: "#94a3b8",
  rain: "#38bdf8",
  snow: "#e0f2fe",
  storm: "#a78bfa",
};

function round(value: number | null): string {
  return value == null ? "--" : `${Math.round(value)}`;
}

/** Consecutive steps sharing a dayKey, in order — one day column group. */
function groupByDay(steps: ForecastStep[]): { dayKey: string; dayLabel: string; steps: ForecastStep[] }[] {
  const groups: { dayKey: string; dayLabel: string; steps: ForecastStep[] }[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === step.dayKey) last.steps.push(step);
    else groups.push({ dayKey: step.dayKey, dayLabel: step.dayLabel, steps: [step] });
  }
  return groups;
}

/** Full boxed cell: hour · glyph · temp · rain · wind · hazard. */
function StepCell({ step, compact }: { step: ForecastStep; compact: boolean }) {
  const wet = step.rain != null && step.rain >= 0.1;
  return (
    <div
      title={`${step.dayLabel} ${step.hourLabel} · ${step.condition.replace(/-/g, " ")}`}
      style={{
        flexShrink: 0,
        width: compact ? 46 : 54,
        border: "1px solid #1b2030",
        borderRadius: 6,
        background: "#070c15",
        padding: compact ? "6px 4px" : "8px 5px",
        textAlign: "center",
      }}
    >
      <div style={{ color: muted, fontSize: 10 }}>{step.hourLabel}</div>
      <div style={{ fontSize: compact ? 15 : 18, lineHeight: 1.2, margin: "3px 0" }}>
        {CONDITION_GLYPH[step.condition]}
      </div>
      <div style={{ color: "#f8fafc", fontSize: compact ? 13 : 15, fontWeight: 700 }}>{round(step.temp)}°</div>
      <div style={{ color: wet ? "#7dd3fc" : "#334155", fontSize: 9, marginTop: 2 }}>
        {wet ? `${step.rain!.toFixed(1)}mm` : "dry"}
      </div>
      <div style={{ color: muted, fontSize: 9, marginTop: 1 }}>{round(step.wind)}m/s</div>
      {step.hazards.length > 0 && (
        <div title={step.hazards[0].label} style={{ color: "#fbbf24", fontSize: 12, marginTop: 2, lineHeight: 1 }}>
          ▲
        </div>
      )}
    </div>
  );
}

/** Slim tick: condition accent bar · temp · a 6-hourly hour tick. */
function SlimStep({ step }: { step: ForecastStep }) {
  const hazard = step.hazards.length > 0;
  const showHour = /^(00|06|12|18):/.test(step.hourLabel);
  return (
    <div
      title={`${step.dayLabel} ${step.hourLabel} · ${step.condition.replace(/-/g, " ")}${hazard ? ` · ${step.hazards[0].label}` : ""}`}
      style={{ flexShrink: 0, width: 26, textAlign: "center" }}
    >
      <div style={{ height: 3, borderRadius: 2, background: hazard ? "#fbbf24" : CONDITION_COLOR[step.condition], marginBottom: 3 }} />
      <div style={{ color: hazard ? "#fbbf24" : "#f8fafc", fontSize: 11, fontWeight: 600 }}>{round(step.temp)}°</div>
      <div style={{ color: muted, fontSize: 8, marginTop: 1, height: 10 }}>{showHour ? step.hourLabel.slice(0, 2) : ""}</div>
    </div>
  );
}

export default function ForecastTimeline({
  steps,
  loading = false,
  title = "72-hour timeline",
  compact = false,
  slim = false,
}: {
  steps: ForecastStep[];
  loading?: boolean;
  title?: string;
  compact?: boolean;
  slim?: boolean;
}) {
  const days = groupByDay(steps);

  return (
    <section
      aria-label={title}
      style={{
        marginTop: slim ? 10 : compact ? 12 : 18,
        border: "1px solid #223047",
        borderRadius: 8,
        background: "#0a1220",
        padding: slim ? "8px 10px" : compact ? 10 : 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ color: "#e2e8f0", fontSize: slim ? 12 : compact ? 13 : 15 }}>{title}</strong>
        {!slim && <span style={{ color: muted, fontSize: 10 }}>3-hourly · temp° · wind m/s · rain mm/h</span>}
      </div>

      {loading && steps.length === 0 && (
        <div style={{ color: muted, fontSize: 12, marginTop: 8 }}>Loading timeline…</div>
      )}
      {!loading && steps.length === 0 && (
        <div style={{ color: muted, fontSize: 12, marginTop: 8 }}>No timeline forecast available.</div>
      )}

      {steps.length > 0 && (
        <div style={{ display: "flex", gap: slim ? 8 : 14, marginTop: slim ? 8 : 10, overflowX: "auto", paddingBottom: 6 }}>
          {days.map((day) => (
            <div key={day.dayKey} style={{ flexShrink: 0 }}>
              <div style={{ color: "#bfdbfe", fontSize: slim ? 10 : 12, fontWeight: 700, marginBottom: slim ? 4 : 6, paddingLeft: 2 }}>
                {day.dayLabel}
              </div>
              <div style={{ display: "flex", gap: slim ? 2 : 4 }}>
                {day.steps.map((step) =>
                  slim ? <SlimStep key={step.t} step={step} /> : <StepCell key={step.t} step={step} compact={compact} />,
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
