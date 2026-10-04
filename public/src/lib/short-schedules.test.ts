/**
 * The schedule UI's pure helpers (docs/short-video-plan.md §8, §13): the
 * "when" and next-run lines, the quota-hour warning, the round-up slot hint,
 * validation, reorder and the Morning batch quick start.
 */
import { DEFAULT_ROUNDUP_SETTINGS, sanitizeRoundupSettings } from "@photonsurge/shared/roundup-settings";
import { MAIN_AREAS_PLACES } from "@photonsurge/shared/short-script";
import {
  describeDays,
  describeNextRun,
  describeWhen,
  draftFromSchedule,
  draftToInput,
  hasErrors,
  morningBatchDraft,
  moveItem,
  newDraftVideo,
  quotaHourFire,
  quotaResetLondon,
  roundupSlotHint,
  roundupSlotHints,
  validateDraft,
} from "./short-schedules";

const NOW = Date.parse("2026-10-04T12:00:00Z"); // a Sunday, London on BST (+1)

describe("describeWhen / describeNextRun", () => {
  it("says the days, time and zone", () => {
    expect(describeWhen({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "07:00", tz: "Europe/London" })).toBe(
      "Every day 07:00 Europe/London",
    );
    expect(describeDays([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(describeDays([6, 0])).toBe("Weekends");
    expect(describeDays([3, 1])).toBe("Mon, Wed");
    expect(describeWhen({ type: "once", at: Date.parse("2026-10-05T07:15:00Z") })).toBe("Once, Mon 5 Oct 08:15 London");
  });

  it("gives the next run in the schedule's zone, and in London when that differs", () => {
    const at = Date.parse("2026-10-05T07:15:00Z");
    expect(describeNextRun(at, { type: "weekly", days: [], time: "08:15", tz: "Europe/London" })).toBe("Mon 5 Oct 08:15 London");
    expect(describeNextRun(at, { type: "weekly", days: [], time: "03:15", tz: "America/New_York" })).toBe(
      "Mon 5 Oct 03:15 America/New_York · Mon 5 Oct 08:15 London",
    );
    expect(describeNextRun(null, { type: "once", at })).toBe("—");
  });
});

describe("quotaHourFire (§13)", () => {
  it("warns for a batch in the hour before 08:00 London", () => {
    const fire = quotaHourFire({ type: "weekly", days: [], time: "07:00", tz: "Europe/London" }, NOW);
    expect(fire).toBe(Date.parse("2026-10-05T06:00:00Z"));
    expect(quotaResetLondon(fire!)).toBe("08:00");
    expect(quotaHourFire({ type: "weekly", days: [], time: "07:59", tz: "Europe/London" }, NOW)).not.toBeNull();
  });

  it("is quiet after the reset, and before the last hour", () => {
    expect(quotaHourFire({ type: "weekly", days: [], time: "08:15", tz: "Europe/London" }, NOW)).toBeNull();
    expect(quotaHourFire({ type: "weekly", days: [], time: "06:59", tz: "Europe/London" }, NOW)).toBeNull();
  });

  it("catches a schedule in another zone in either season", () => {
    // 06:30 UTC is 07:30 London in summer (warn), 06:30 in winter.
    expect(quotaHourFire({ type: "weekly", days: [], time: "06:30", tz: "UTC" }, Date.parse("2026-11-10T00:00:00Z"))).not.toBeNull();
    expect(quotaHourFire({ type: "once", at: Date.parse("2026-10-05T06:30:00Z") }, NOW)).not.toBeNull();
    expect(quotaHourFire({ type: "once", at: Date.parse("2026-10-05T07:30:00Z") }, NOW)).toBeNull();
  });
});

describe("roundupSlotHint (§8)", () => {
  const settings = sanitizeRoundupSettings(DEFAULT_ROUNDUP_SETTINGS);
  const runAt = Date.parse("2026-10-05T07:15:00Z"); // Mon 08:15 London

  it("says when Europe's round-up is next written and how old it is at the run", () => {
    // Europe's box centres at 10°E → +1: 06:00 local is 05:00 UTC.
    const hint = roundupSlotHint({ type: "area", id: "europe" }, settings, NOW, runAt);
    expect(hint).toMatchObject({ state: "on", place: "Europe", hours: [6, 18], nextAt: Date.parse("2026-10-04T17:00:00Z") });
    expect(hint?.state === "on" && hint.beforeRun).toEqual({ at: Date.parse("2026-10-05T05:00:00Z"), ageHours: 2.25 });
  });

  it("phases a country by its own offset", () => {
    const uk = roundupSlotHint({ type: "country", id: "uk" }, settings, NOW, runAt);
    expect(uk?.state === "on" && uk.beforeRun?.at).toBe(Date.parse("2026-10-05T06:00:00Z"));
    const japan = roundupSlotHint({ type: "country", id: "japan" }, settings, NOW, runAt);
    expect(japan?.state === "on" && japan.beforeRun?.at).toBe(Date.parse("2026-10-04T21:00:00Z"));
  });

  it("gives one hint per place of a several-places video", () => {
    const hints = roundupSlotHints({ type: "places", places: [...MAIN_AREAS_PLACES] }, settings, NOW, runAt);
    expect(hints.map((h) => h.place)).toEqual(["Europe", "United States", "Asia", "Australia", "Africa", "South America"]);
    expect(roundupSlotHints({ type: "globe" }, settings, NOW, runAt)).toEqual([]);
  });

  it("says when the kind is off, and has nothing for the globe or auto", () => {
    const off = sanitizeRoundupSettings({ ...DEFAULT_ROUNDUP_SETTINGS, "place-region": { enabled: false, hours: [6] } });
    expect(roundupSlotHint({ type: "area", id: "europe" }, off, NOW, runAt)).toEqual({ state: "off", place: "Europe", kind: "area" });
    expect(roundupSlotHint({ type: "globe" }, settings, NOW, runAt)).toBeNull();
    expect(roundupSlotHint({ type: "auto" }, settings, NOW, runAt)).toBeNull();
    expect(roundupSlotHint({ type: "area", id: "europe" }, null, NOW, runAt)).toBeNull();
  });
});

describe("the editor's draft", () => {
  it("validates name, days, time, zone, a future once time, and the videos", () => {
    const d = draftFromSchedule(null, NOW);
    let e = validateDraft(d, NOW);
    expect(e.videos).toBeTruthy();
    expect(hasErrors(e)).toBe(true);

    const ok = { ...d, videos: [newDraftVideo()] };
    expect(hasErrors(validateDraft(ok, NOW))).toBe(false);

    e = validateDraft({ ...ok, name: " ", days: [], time: "25:00", tz: "Mars/Olympus" }, NOW);
    expect(e).toMatchObject({ name: expect.any(String), days: expect.any(String), time: expect.any(String), tz: expect.any(String) });

    e = validateDraft({ ...ok, repeat: "once", onceAt: "2026-10-01T08:00" }, NOW);
    expect(e.onceAt).toMatch(/future/);

    const badVideo = { ...newDraftVideo(), what: { type: "script" as const, scriptId: "" } };
    expect(validateDraft({ ...ok, videos: [newDraftVideo(), badVideo] }, NOW).video).toEqual({ 1: "Pick a saved script." });
    expect(validateDraft({ ...ok, videos: [newDraftVideo(undefined, { type: "places", places: [] })] }, NOW).video[0]).toMatch(/place/);
    const stale = { ...newDraftVideo(), roundup: { maxAgeHours: 0, ifStale: "skip" as const } };
    expect(validateDraft({ ...ok, videos: [stale] }, NOW).video[0]).toMatch(/age/);
  });

  it("moves a video up and down, ignoring moves off either end", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    const l = ["a", "b"];
    expect(moveItem(l, 0, -1)).toBe(l);
  });

  it("saves the request body, dropping an emptied title override", () => {
    const v = { ...newDraftVideo(), video: { title: "  ", publishAs: "public" as const } };
    const w = { ...newDraftVideo(), video: { title: "" } };
    const input = draftToInput({ ...draftFromSchedule(null, NOW), name: " Batch ", videos: [v, w] });
    expect(input.name).toBe("Batch");
    expect(input.when).toEqual({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:15", tz: "Europe/London" });
    expect(input.videos[0].video).toEqual({ publishAs: "public" });
    expect(input.videos[1]).not.toHaveProperty("video");
    expect(input.videos[0]).not.toHaveProperty("key");
  });

  it("Morning batch: every day 08:15 London, Europe, the UK, then the main areas; 14 h round-ups refreshed", () => {
    const d = morningBatchDraft(NOW, "obs-v1");
    const input = draftToInput(d);
    expect(input).toMatchObject({ name: "Morning batch", encoderId: "obs-v1", enabled: false });
    expect(input.when).toEqual({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:15", tz: "Europe/London" });
    expect(input.videos.map((v) => v.what)).toEqual([
      { type: "template", scope: { type: "area", id: "europe" } },
      { type: "template", scope: { type: "country", id: "uk" } },
      { type: "template", scope: { type: "places", places: [...MAIN_AREAS_PLACES] } },
    ]);
    expect(input.videos.every((v) => v.roundup.maxAgeHours === 14 && v.roundup.ifStale === "refresh")).toBe(true);
    expect(hasErrors(validateDraft(d, NOW))).toBe(false);
    expect(quotaHourFire(input.when, NOW)).toBeNull();
  });
});
