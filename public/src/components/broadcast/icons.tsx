"use client";

/**
 * Tiny inline glyphs shared by the seismic/tsunami readouts (globe overlay +
 * broadcast panels) so both surfaces read as the same "kind" of instrument at
 * a glance: a heartbeat/EKG pulse for ground-motion, a sine swell for water
 * level.
 */

export function HeartbeatIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}>
      <path
        d="M1 8 L4 8 L5.5 3 L8 13 L10 5 L11.5 8 L15 8"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WaveIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}>
      <path
        d="M1 10.5 C2.5 6.5 4.5 6.5 6 10.5 C7.5 14.5 9.5 14.5 11 10.5 C12.5 6.5 14.5 6.5 15 10.5"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WindIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}>
      <path
        d="M1 5 H9 C11.5 5 11.5 2 9 2 M1 8.2 H12.3 C15 8.2 15 11.5 12.3 11.5 M1 11.5 H7"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GaugeIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}>
      <path d="M2 12.5 A6 6 0 0 1 14 12.5" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 12.5 L11 7.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="12.5" r="1.1" fill={color} />
    </svg>
  );
}
