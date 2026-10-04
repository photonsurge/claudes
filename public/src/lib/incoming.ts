/**
 * The on-air INCOMING pre-roll for a breaking cut: while the camera flies to
 * the event the reticle reads "acquiring", then locks on. The worker stamps the
 * pre-roll length on the cut (`Segment.incomingMs`, see the channel's
 * Break-ins card); the phase is derived from the cut's own `spinEpoch`, so
 * /watch, /control and every OBS source agree with no traffic.
 */
import { useEffect, useState } from "react";
import type { Segment } from "@photonsurge/shared/director";

export type IncomingPhase = "incoming" | "locked";

/** Pure: the phase of `segment` at `now`, or null when it has no pre-roll. */
export function incomingPhaseAt(segment: Segment | null | undefined, now: number): IncomingPhase | null {
  const ms = segment?.incomingMs;
  if (!segment || !ms || ms <= 0) return null;
  const epoch = segment.patch?.spinEpoch;
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return null;
  return now < epoch + ms ? "incoming" : "locked";
}

/** When the pre-roll ends, ms epoch (null without one). */
export function incomingEndsAt(segment: Segment | null | undefined): number | null {
  const ms = segment?.incomingMs;
  const epoch = segment?.patch?.spinEpoch;
  return ms && ms > 0 && typeof epoch === "number" ? epoch + ms : null;
}

/** The live phase, re-rendering once at the flip (a single timeout, no interval). */
export function useIncomingPhase(segment: Segment | null | undefined): IncomingPhase | null {
  const [now, setNow] = useState(() => Date.now());
  const endsAt = incomingEndsAt(segment);
  useEffect(() => {
    setNow(Date.now());
    if (endsAt == null) return;
    const wait = endsAt - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 16);
    return () => clearTimeout(t);
  }, [endsAt, segment?.id]);
  return incomingPhaseAt(segment, now);
}
