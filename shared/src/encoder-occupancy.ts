/**
 * "This encoder is in use" (docs/short-video-plan.md §6.2): what each OBS
 * instance is doing right now, for the encoder picker on the Render form and
 * /admin/streams. Pure — the /api/streams snapshot computes it from the docs it
 * already loads and returns it per encoder.
 *
 * Advisory only: the render queue checks again when a video reaches the front.
 */
import { ENV_ENCODER_ID, runIsActive, type RunStatus, type StreamSlot } from "./runs";
import type { ShortRender } from "./short-render";
import { VIDEO_TEXT_TIMEZONE } from "./video-text";

/** Only what occupancy reads from an encoder (StreamEncoder and its Info both fit). */
export interface OccupancyEncoder {
  id: string;
  name?: string;
  sceneId?: string;
  enabled: boolean;
}

/** Only what occupancy reads from a run (Run and RunState both fit). */
export interface OccupancyRun {
  id: string;
  sceneId: string;
  encoderId?: string;
  slotId?: string;
  status: RunStatus;
  title?: string;
  startAt?: number | null;
  durationMs?: number | null;
  script?: { scriptId: string; renderId?: string } | null;
}

/**
 * The fields of a schedule (§8, WP9a) occupancy needs. Schedules don't exist
 * yet: callers pass `[]` until WP9 adds `ShortSchedule`, which satisfies this.
 */
export interface OccupancySchedule {
  id: string;
  name?: string;
  enabled: boolean;
  encoderId: string | "any";
  nextAt: number | null;
}

export type EncoderOccupancyState = "free" | "live" | "held" | "rendering" | "booked" | "disabled";

export interface EncoderOccupancy {
  state: EncoderOccupancyState;
  /** One line for the picker: "live: Main channel, since 14:02". */
  label: string;
  /** Can a video be queued on it? Rendering and booked can; live and held can't. */
  canQueueVideo: boolean;
  runId?: string;
  sceneId?: string;
  title?: string;
  since?: number | null;
  until?: number | null;
  slotId?: string;
  renderId?: string;
  /** Videos waiting in this encoder's own queue (the "any" pool not counted). */
  queued: number;
  /** The next booked schedule within the window (state `booked`). */
  bookedAt?: number;
  scheduleId?: string;
}

/** How far ahead a booking shows (§6.2: "the next schedule within 24 hours"). */
export const BOOKED_WINDOW_MS = 24 * 60 * 60_000;

/** "14:02" in the given zone (London by default, like live titles). */
export function occupancyTime(ms: number, timeZone: string = VIDEO_TEXT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(ms),
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** An enabled slot owns this encoder: pinned to it, or unpinned and on the scene it is bound to. */
function slotHolding(enc: OccupancyEncoder, slots: Pick<StreamSlot, "id" | "name" | "sceneId" | "encoderId" | "enabled">[]) {
  return slots.find((s) => s.enabled && (s.encoderId ? s.encoderId === enc.id : !!enc.sceneId && enc.sceneId === s.sceneId));
}

/**
 * Per encoder id, what it is doing. Order of precedence: disabled, an active run
 * (live, or rendering when the run is a video), held by an enabled slot, a
 * render being prepared, booked, free. A schedule set to "any" encoder has no
 * single encoder to show as booked (§13), so it shows on none.
 */
export function encoderOccupancy(
  encoders: OccupancyEncoder[],
  runs: OccupancyRun[],
  slots: Pick<StreamSlot, "id" | "name" | "sceneId" | "encoderId" | "enabled">[],
  schedules: OccupancySchedule[],
  now: number,
  renders: Pick<ShortRender, "id" | "encoderId" | "assignedEncoderId" | "status" | "runId">[] = [],
  opts: { timeZone?: string } = {},
): Record<string, EncoderOccupancy> {
  const tz = opts.timeZone ?? VIDEO_TEXT_TIMEZONE;
  const out: Record<string, EncoderOccupancy> = {};
  const active = runs.filter((r) => runIsActive(r.status));
  for (const enc of encoders) {
    const queued = renders.filter((r) => r.status === "queued" && r.encoderId === enc.id).length;
    const more = queued ? `, ${queued} more queued` : "";
    if (!enc.enabled) {
      out[enc.id] = { state: "disabled", label: "disabled", canQueueVideo: false, queued };
      continue;
    }
    const run = active.find((r) => (r.encoderId || ENV_ENCODER_ID) === enc.id);
    if (run?.script?.scriptId) {
      const title = run.title || "a video";
      out[enc.id] = {
        state: "rendering",
        label: `rendering: ${title}${more}`,
        canQueueVideo: true,
        runId: run.id,
        sceneId: run.sceneId,
        title: run.title,
        since: run.startAt ?? null,
        until: run.startAt && run.durationMs ? run.startAt + run.durationMs : null,
        renderId: run.script.renderId,
        queued,
      };
      continue;
    }
    if (run) {
      const since = run.startAt ?? null;
      const until = since && run.durationMs ? since + run.durationMs : null;
      const label =
        `live: ${run.title || run.sceneId}` +
        (since ? `, since ${occupancyTime(since, tz)}` : "") +
        (until ? `, until ${occupancyTime(until, tz)}` : "");
      out[enc.id] = { state: "live", label, canQueueVideo: false, runId: run.id, sceneId: run.sceneId, title: run.title, since, until, slotId: run.slotId, queued };
      continue;
    }
    const slot = slotHolding(enc, slots);
    if (slot) {
      out[enc.id] = {
        state: "held",
        label: `held by always-on slot ${slot.name || slot.id}`,
        canQueueVideo: false,
        slotId: slot.id,
        sceneId: slot.sceneId,
        queued,
      };
      continue;
    }
    const preparing = renders.find((r) => r.status === "preparing" && (r.assignedEncoderId ?? r.encoderId) === enc.id);
    if (preparing) {
      out[enc.id] = { state: "rendering", label: `rendering: preparing a video${more}`, canQueueVideo: true, renderId: preparing.id, queued };
      continue;
    }
    const booking = schedules
      .filter((s) => s.enabled && s.encoderId === enc.id && s.nextAt != null && s.nextAt >= now && s.nextAt - now <= BOOKED_WINDOW_MS)
      .sort((a, b) => a.nextAt! - b.nextAt!)[0];
    if (booking) {
      out[enc.id] = {
        state: "booked",
        label: `free, batch booked ${occupancyTime(booking.nextAt!, tz)}${queued ? `, ${plural(queued, "video")} queued` : ""}`,
        canQueueVideo: true,
        bookedAt: booking.nextAt!,
        scheduleId: booking.id,
        queued,
      };
      continue;
    }
    out[enc.id] = { state: "free", label: queued ? `free, ${plural(queued, "video")} queued` : "free", canQueueVideo: true, queued };
  }
  return out;
}
