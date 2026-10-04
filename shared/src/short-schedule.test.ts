import { encoderOccupancy } from "./encoder-occupancy";
import {
  DEFAULT_ROUNDUP_MAX_AGE_HOURS,
  DEFAULT_START_BY_MS,
  defaultShortSchedule,
  nextFireAt,
  sanitizeScheduledVideo,
  sanitizeShortSchedule,
  scheduleFormatIds,
  scheduleNextAt,
  zonedWallTimeToUtc,
  type ShortSchedule,
} from "./short-schedule";

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
const daily = (time: string, tz = "Europe/London") => ({ type: "weekly" as const, days: [0, 1, 2, 3, 4, 5, 6], time, tz });

describe("nextFireAt", () => {
  it("weekly every day at 07:00 London, in summer and winter time", () => {
    // 2026-10-04 is a Sunday, BST (UTC+1).
    expect(iso(nextFireAt(daily("07:00"), Date.parse("2026-10-04T05:00:00Z")))).toBe("2026-10-04T06:00:00.000Z");
    // Strictly after: firing at 07:00 sets the next to tomorrow.
    expect(iso(nextFireAt(daily("07:00"), Date.parse("2026-10-04T06:00:00Z")))).toBe("2026-10-05T06:00:00.000Z");
    // December: GMT.
    expect(iso(nextFireAt(daily("07:00"), Date.parse("2026-12-01T12:00:00Z")))).toBe("2026-12-02T07:00:00.000Z");
  });

  it("London spring forward (2026-03-29): 07:00 moves an hour earlier in UTC; a time in the gap fires after it", () => {
    // Sat 28 Mar 07:00 GMT, then Sun 29 Mar 07:00 BST.
    const sat = nextFireAt(daily("07:00"), Date.parse("2026-03-28T00:00:00Z"));
    expect(iso(sat)).toBe("2026-03-28T07:00:00.000Z");
    expect(iso(nextFireAt(daily("07:00"), sat!))).toBe("2026-03-29T06:00:00.000Z");
    // 01:30 doesn't exist on the 29th (01:00 GMT → 02:00 BST): it fires at 02:30 BST, once.
    const gap = nextFireAt(daily("01:30"), Date.parse("2026-03-28T12:00:00Z"));
    expect(iso(gap)).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(nextFireAt(daily("01:30"), gap!))).toBe("2026-03-30T00:30:00.000Z");
  });

  it("London fall back (2026-10-25): 07:00 moves an hour later in UTC; a repeated time fires once, the first time", () => {
    const sat = nextFireAt(daily("07:00"), Date.parse("2026-10-24T00:00:00Z"));
    expect(iso(sat)).toBe("2026-10-24T06:00:00.000Z");
    expect(iso(nextFireAt(daily("07:00"), sat!))).toBe("2026-10-25T07:00:00.000Z");
    // 01:30 happens twice on the 25th (BST, then GMT): the first, and not again that day.
    const first = nextFireAt(daily("01:30"), Date.parse("2026-10-24T12:00:00Z"));
    expect(iso(first)).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(nextFireAt(daily("01:30"), first!))).toBe("2026-10-26T01:30:00.000Z");
  });

  it("follows another zone's own DST (America/New_York, 2026-03-08 and 2026-11-01)", () => {
    const ny = daily("07:00", "America/New_York");
    expect(iso(nextFireAt(ny, Date.parse("2026-03-07T13:00:00Z")))).toBe("2026-03-08T11:00:00.000Z"); // EDT
    expect(iso(nextFireAt(ny, Date.parse("2026-03-06T13:00:00Z")))).toBe("2026-03-07T12:00:00.000Z"); // EST
    expect(iso(nextFireAt(ny, Date.parse("2026-10-31T12:00:00Z")))).toBe("2026-11-01T12:00:00.000Z"); // EST again
    // 02:30 doesn't exist in New York on 8 March.
    expect(iso(nextFireAt(daily("02:30", "America/New_York"), Date.parse("2026-03-08T00:00:00Z")))).toBe("2026-03-08T07:30:00.000Z");
  });

  it("uses the zone's own date, not UTC's (Australia/Sydney is ahead)", () => {
    // 2026-10-04 20:00Z is Mon 5 Oct 07:00 AEDT (DST began 4 Oct in Sydney).
    const mon = { type: "weekly" as const, days: [1], time: "07:00", tz: "Australia/Sydney" };
    expect(iso(nextFireAt(mon, Date.parse("2026-10-04T10:00:00Z")))).toBe("2026-10-04T20:00:00.000Z");
  });

  it("weekly with several days picks the next listed day", () => {
    const when = { type: "weekly" as const, days: [1, 3, 5], time: "18:30", tz: "Europe/London" }; // Mon, Wed, Fri
    const sun = Date.parse("2026-10-04T12:00:00Z");
    const mon = nextFireAt(when, sun)!;
    expect(iso(mon)).toBe("2026-10-05T17:30:00.000Z");
    const wed = nextFireAt(when, mon)!;
    expect(iso(wed)).toBe("2026-10-07T17:30:00.000Z");
    const fri = nextFireAt(when, wed)!;
    expect(iso(fri)).toBe("2026-10-09T17:30:00.000Z");
    expect(iso(nextFireAt(when, fri))).toBe("2026-10-12T17:30:00.000Z");
  });

  it("once fires at its time, and never after it", () => {
    const at = Date.parse("2026-10-05T06:00:00Z");
    expect(nextFireAt({ type: "once", at }, at - 1)).toBe(at);
    expect(nextFireAt({ type: "once", at }, at)).toBeNull();
  });

  it("is null for an unknown zone or a malformed time", () => {
    expect(nextFireAt({ type: "weekly", days: [1], time: "07:00", tz: "Mars/Olympus" }, 0)).toBeNull();
    expect(nextFireAt({ type: "weekly", days: [1], time: "7am", tz: "Europe/London" }, 0)).toBeNull();
  });

  it("zonedWallTimeToUtc round-trips an ordinary time", () => {
    expect(iso(zonedWallTimeToUtc(2026, 7, 1, 7, 0, "Europe/London"))).toBe("2026-07-01T06:00:00.000Z");
    expect(iso(zonedWallTimeToUtc(2026, 7, 1, 7, 0, "UTC"))).toBe("2026-07-01T07:00:00.000Z");
  });
});

describe("sanitizeShortSchedule", () => {
  it("defaults: off, daily 07:00 London, any encoder, 1 h start-by, 14 h round-up rule", () => {
    const s = defaultShortSchedule("id1");
    expect(s).toMatchObject({ id: "id1", enabled: false, encoderId: "any", startByMs: DEFAULT_START_BY_MS, fireCount: 0, nextAt: null });
    expect(DEFAULT_START_BY_MS).toBe(3_600_000);
    expect(DEFAULT_ROUNDUP_MAX_AGE_HOURS).toBe(14);
    const v = sanitizeScheduledVideo({ formatId: "f", what: { type: "template", scope: { type: "area", id: "europe" } } });
    expect(v).toEqual({ formatId: "f", what: { type: "template", scope: { type: "area", id: "europe" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } });
  });

  it("validates a full body; never takes the server's fields from it", () => {
    const base = { ...defaultShortSchedule("s1"), fireCount: 7, nextAt: 123, lastFire: { at: 1, outcome: "missed" as const } };
    const s = sanitizeShortSchedule(
      {
        id: "hijack",
        name: " Morning batch ",
        enabled: true,
        when: { type: "weekly", days: [5, 1, 1, 9], time: "07:30", tz: "Europe/Paris" },
        encoderId: "obs-v1",
        accountId: "UC1",
        offline: true,
        startByMs: 1_800_000,
        fireCount: 999,
        nextAt: 0,
        lastFire: { at: 2, outcome: "queued" },
        videos: [
          { formatId: "europe", what: { type: "template", scope: { type: "auto", of: "country" }, include: { alerts: true } }, roundup: { maxAgeHours: 6, ifStale: "skip" }, skipIfQuiet: true, video: { publishAs: "private", junk: 1 } },
          { formatId: "uk", what: { type: "script", scriptId: "s9" }, roundup: { maxAgeHours: -1, ifStale: "nope" } },
          { what: { type: "script", scriptId: "x" } }, // no format: dropped
          { formatId: "f", what: { type: "template", scope: { type: "moon" } } }, // bad scope: dropped
        ],
      },
      base,
    );
    expect(s).toEqual({
      id: "s1",
      name: "Morning batch",
      enabled: true,
      when: { type: "weekly", days: [1, 5], time: "07:30", tz: "Europe/Paris" },
      encoderId: "obs-v1",
      accountId: "UC1",
      offline: true,
      startByMs: 1_800_000,
      fireCount: 7,
      nextAt: 123,
      lastFire: { at: 1, outcome: "missed" },
      videos: [
        {
          formatId: "europe",
          what: { type: "template", scope: { type: "auto", of: "country" }, include: { alerts: true, quakes: false, volcanoes: false } },
          roundup: { maxAgeHours: 6, ifStale: "skip" },
          skipIfQuiet: true,
          video: { publishAs: "private" },
        },
        { formatId: "uk", what: { type: "script", scriptId: "s9" }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
      ],
    });
    expect(scheduleFormatIds(s)).toEqual(["europe", "uk"]);
  });

  it("a partial body is a patch; a bad when keeps the stored one; '' clears the account", () => {
    const base: ShortSchedule = { ...defaultShortSchedule("s1", "Old"), accountId: "UC1", videos: [{ formatId: "f", what: { type: "script", scriptId: "a" }, roundup: { maxAgeHours: 14, ifStale: "refresh" } }] };
    const s = sanitizeShortSchedule({ when: { type: "weekly", time: "25:00" }, accountId: "" }, base);
    expect(s.when).toEqual(base.when);
    expect(s.name).toBe("Old");
    expect(s.videos).toEqual(base.videos);
    expect(s.accountId).toBeUndefined();
    expect(sanitizeShortSchedule({ when: { type: "weekly", days: [], time: "06:00" } }, base).when).toEqual({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "06:00", tz: "Europe/London" });
    expect(sanitizeShortSchedule({ when: { type: "once", at: 5 } }, base).when).toEqual({ type: "once", at: 5 });
  });

  it("scheduleNextAt: the next fire when enabled, none when off", () => {
    const now = Date.parse("2026-10-04T05:00:00Z");
    expect(scheduleNextAt({ enabled: false, when: daily("07:00") }, now)).toBeNull();
    expect(iso(scheduleNextAt({ enabled: true, when: daily("07:00") }, now))).toBe("2026-10-04T06:00:00.000Z");
  });

  it("feeds encoderOccupancy's booked state: a named encoder is booked, 'any' books none", () => {
    const now = Date.parse("2026-10-04T05:00:00Z");
    const named: ShortSchedule = { ...defaultShortSchedule("a", "Morning"), enabled: true, encoderId: "obs-v1", nextAt: now + 3_600_000 };
    const any: ShortSchedule = { ...defaultShortSchedule("b", "Any"), enabled: true, encoderId: "any", nextAt: now + 1_800_000 };
    const occ = encoderOccupancy([{ id: "obs-v1", enabled: true }, { id: "obs-v2", enabled: true }], [], [], [named, any], now);
    expect(occ["obs-v1"]).toMatchObject({ state: "booked", scheduleId: "a" });
    expect(occ["obs-v2"].state).toBe("free");
  });
});
