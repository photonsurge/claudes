import type { iEventTimelineUpdate } from "../db/event-timeline-update-model";
import type { iWatchedEvent } from "../db/watched-event-model";
import { buildEventTimeline } from "./event-timeline";

const upd = (over: Partial<iEventTimelineUpdate>): iEventTimelineUpdate =>
  ({ eventId: "evt-1", at: "2026-07-12T14:00:00Z", type: "UPDATED", label: "Updated", ...over }) as iEventTimelineUpdate;

const event = (over: Partial<iWatchedEvent> = {}): iWatchedEvent =>
  ({
    type: "CYCLONE",
    status: "ACTIVE",
    title: "Cyclone Alpha",
    startedAt: "2026-07-12T14:00:00Z",
    primarySource: "gdacs",
    primarySourceId: "TC1",
    ...over,
  }) as iWatchedEvent;

describe("buildEventTimeline", () => {
  it("synthesises an ISSUED head and sorts oldest→newest", () => {
    const beats = buildEventTimeline(event(), [
      upd({ at: "2026-07-12T15:03:00Z", type: "REPORT_ADDED", label: "Report" }),
      upd({ at: "2026-07-12T14:17:00Z", type: "AREA_CHANGED", label: "Area expanded", areaKm2: 14220 }),
    ]);
    expect(beats[0].type).toBe("ISSUED");
    expect(beats.map((b) => b.at)).toEqual([
      "2026-07-12T14:00:00Z",
      "2026-07-12T14:17:00Z",
      "2026-07-12T15:03:00Z",
    ]);
  });

  it("does not double up ISSUED when the stored rows already carry one", () => {
    const beats = buildEventTimeline(event(), [upd({ type: "ISSUED", label: "Warning issued" })]);
    expect(beats.filter((b) => b.type === "ISSUED")).toHaveLength(1);
  });

  it("synthesises an ENDED tail only on a natural lapse", () => {
    const ended = buildEventTimeline(
      event({ status: "ENDED", endedAt: "2026-07-12T18:00:00Z" }),
      [upd({ type: "SEVERITY_CHANGED", label: "Severity raised" })],
    );
    expect(ended[ended.length - 1].type).toBe("ENDED");

    // Cancelled → the CANCELLED beat tells the story; no synthetic ENDED.
    const cancelled = buildEventTimeline(
      event({ status: "CANCELLED", endedAt: "2026-07-12T18:00:00Z" }),
      [upd({ type: "CANCELLED", label: "Cancelled by issuer", at: "2026-07-12T17:51:00Z" })],
    );
    expect(cancelled.some((b) => b.type === "ENDED")).toBe(false);
  });
});
