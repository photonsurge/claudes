"use client";

/**
 * BroadcastBed — the /watch-side player for the generative audio bed.
 *
 * Purely settings-driven: the operator's AudioSettings arrive inside the synced
 * ControlState (no audio travels over the socket — every watcher synthesizes the
 * same style locally via AuroraBed). In "auto" mode the energy follows the
 * on-air director segment: event kinds map to a severity and a fresh storm/quake
 * cut fires a one-shot riser. Fixed modes pin the section regardless.
 *
 * Browser autoplay: OBS browser sources allow autoplay so the bed just starts;
 * a normal browser tab keeps the AudioContext suspended until a user gesture, so
 * while blocked we show a small badge and resume on the first pointerdown.
 */
import { useEffect, useRef, useState } from "react";
import type { AudioSettings } from "@photonsurge/shared/control";
import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import { AuroraBed } from "../../lib/audio/engine";

/**
 * How intense each on-air segment kind reads, 0..1 — the "auto" mode's driver.
 * Calm establishing shots stay chill; severe weather / quakes push into breaks.
 */
export const KIND_SEVERITY: Partial<Record<SegmentKind, number>> = {
  intro: 0.05,
  global: 0.05,
  ocean: 0.1,
  orbital: 0.25,
  country: 0.35,
  weather: 0.4,
  flight: 0.35,
  ship: 0.35,
  storm: 0.9,
  volcano: 0.85,
  quake: 0.85,
  ad: 0,
};

/** Idle severity when no director segment is on air (manual operator driving). */
const IDLE_SEVERITY = 0.15;

/** Event kinds whose arrival fires a one-shot energy spike + riser. */
const PULSE_KINDS = new Set<SegmentKind>(["storm", "quake", "volcano"]);

/** How long after start() before concluding the browser blocked autoplay. */
const BLOCK_PROBE_MS = 600;

export interface BroadcastBedProps {
  audio: AudioSettings;
  /** On-air director segment (drives severity/pulses in "auto" mode), or null. */
  segment?: Segment | null;
}

export default function BroadcastBed({ audio, segment }: BroadcastBedProps) {
  const bedRef = useRef<AuroraBed | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const bed = new AuroraBed();
    bedRef.current = bed;
    // Debug handle — lets the console / headless checks inspect the live bed
    // (playing, energy, section, spectrum) the way DebugButton exposes state.
    (window as unknown as { __auroraBed?: AuroraBed }).__auroraBed = bed;
    return () => {
      bed.stop();
      bedRef.current = null;
      delete (window as unknown as { __auroraBed?: AuroraBed }).__auroraBed;
    };
  }, []);

  // Transport. The probe re-checks the context after resume() had its chance;
  // "suspended" while playing means autoplay was blocked pending a gesture.
  useEffect(() => {
    const bed = bedRef.current;
    if (!bed) return;
    if (audio.enabled && !bed.playing) bed.start();
    if (!audio.enabled && bed.playing) bed.stop();
    if (!audio.enabled) {
      setBlocked(false);
      return;
    }
    const t = setTimeout(() => setBlocked(bed.contextState() === "suspended"), BLOCK_PROBE_MS);
    return () => clearTimeout(t);
  }, [audio.enabled]);

  // Mixer/mode. Mute keeps the engine running at zero gain so unmute is instant
  // and stays in sync with the groove. Re-applied after enable (deps include it)
  // because setMasterVolume no-ops before the graph exists.
  useEffect(() => {
    const bed = bedRef.current;
    if (!bed) return;
    bed.setMasterVolume(audio.muted ? 0 : audio.volume);
    bed.setMode(audio.mode);
  }, [audio.enabled, audio.muted, audio.volume, audio.mode]);

  // Auto-mode reactivity: severity from the on-air kind (the engine ignores it
  // while a fixed mode pins the energy, so this is safe to set unconditionally).
  const kind = segment?.kind ?? null;
  useEffect(() => {
    bedRef.current?.setSeverity(kind ? KIND_SEVERITY[kind] ?? 0.3 : IDLE_SEVERITY);
  }, [kind]);

  // One-shot riser when a new severe event lands on air (id change = new event).
  const pulseId = segment && PULSE_KINDS.has(segment.kind) ? segment.id : null;
  useEffect(() => {
    if (pulseId) bedRef.current?.triggerEvent();
  }, [pulseId]);

  // While blocked, any gesture on the page unlocks the context.
  useEffect(() => {
    if (!blocked || !audio.enabled) return;
    const unlock = () => {
      bedRef.current?.start();
      setTimeout(() => setBlocked(bedRef.current?.contextState() === "suspended"), 300);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [blocked, audio.enabled]);

  if (!audio.enabled || !blocked) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        zIndex: 6,
        padding: "6px 12px",
        borderRadius: 999,
        background: "rgba(10,14,22,0.85)",
        border: "1px solid #2a3344",
        color: "#8b95a7",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        pointerEvents: "none",
      }}
    >
      🔇 Audio bed blocked — click anywhere to enable
    </div>
  );
}
