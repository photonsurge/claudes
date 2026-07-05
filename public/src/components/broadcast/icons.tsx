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
