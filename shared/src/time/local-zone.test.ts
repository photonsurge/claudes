import {
  longitudeOffsetHours,
  zoneFromLongitude,
  zoneFromCity,
  zoneOffsetMinutes,
  localOffsetMinutes,
  formatLocalTime,
  formatLocalDay,
  formatOffsetLabel,
  localZoneCaption,
} from "./local-zone";

/** 12:00 UTC on a Thursday in January (northern winter — no DST in Europe/US). */
const WINTER = new Date("2026-01-15T12:00:00Z");
/** 12:00 UTC on a Wednesday in July (northern summer — DST active). */
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("longitudeOffsetHours", () => {
  it("rounds longitude to the nearest whole hour", () => {
    expect(longitudeOffsetHours(0)).toBe(0);
    expect(longitudeOffsetHours(139.7)).toBe(9); // Tokyo
    expect(longitudeOffsetHours(-74)).toBe(-5); // New York
  });

  it("clamps to the real-world offset range", () => {
    expect(longitudeOffsetHours(-179)).toBe(-12);
    expect(longitudeOffsetHours(179)).toBe(12);
  });

  it("normalises -0 so it never formats as a negative zero", () => {
    expect(Object.is(longitudeOffsetHours(-1), 0)).toBe(true);
  });

  it("treats a missing longitude as UTC rather than NaN", () => {
    expect(longitudeOffsetHours(Number.NaN)).toBe(0);
  });
});

describe("zoneOffsetMinutes", () => {
  it("reads a whole-hour zone", () => {
    expect(zoneOffsetMinutes("Asia/Tokyo", WINTER)).toBe(9 * 60);
  });

  it("reads a half-hour zone the longitude guess gets wrong", () => {
    // Kolkata is +5:30; round(88.4/15) would say +6.
    expect(zoneOffsetMinutes("Asia/Kolkata", WINTER)).toBe(5 * 60 + 30);
  });

  it("reads a 45-minute zone", () => {
    expect(zoneOffsetMinutes("Asia/Kathmandu", WINTER)).toBe(5 * 60 + 45);
  });

  it("follows DST across the year", () => {
    expect(zoneOffsetMinutes("Europe/London", WINTER)).toBe(0);
    expect(zoneOffsetMinutes("Europe/London", SUMMER)).toBe(60);
    expect(zoneOffsetMinutes("America/New_York", WINTER)).toBe(-5 * 60);
    expect(zoneOffsetMinutes("America/New_York", SUMMER)).toBe(-4 * 60);
  });

  it("follows southern-hemisphere DST the other way round", () => {
    expect(zoneOffsetMinutes("Australia/Sydney", WINTER)).toBe(11 * 60);
    expect(zoneOffsetMinutes("Australia/Sydney", SUMMER)).toBe(10 * 60);
  });

  it("returns null for an id this runtime does not know", () => {
    expect(zoneOffsetMinutes("Mars/Olympus_Mons", WINTER)).toBeNull();
  });
});

describe("localOffsetMinutes", () => {
  it("prefers the real zone over the longitude estimate", () => {
    // Xinjiang sits at ~87°E but keeps Beijing time (+8), not the +6 guess.
    const zone = zoneFromCity("Asia/Shanghai", 87.6, "Urumqi");
    expect(localOffsetMinutes(zone, WINTER)).toBe(8 * 60);
  });

  it("falls back to longitude when the zone id is unusable", () => {
    const zone = zoneFromCity("Mars/Olympus_Mons", 139.7, "Tokyo");
    expect(localOffsetMinutes(zone, WINTER)).toBe(9 * 60);
  });

  it("uses longitude directly for an ocean shot with no city", () => {
    expect(localOffsetMinutes(zoneFromLongitude(-150), WINTER)).toBe(-10 * 60);
  });
});

describe("formatLocalTime", () => {
  it("formats a 24-hour wall clock at the place", () => {
    expect(formatLocalTime(zoneFromCity("Asia/Tokyo", 139.7, "Tokyo"), WINTER)).toBe("21:00");
    expect(formatLocalTime(zoneFromCity("America/New_York", -74, "New York"), WINTER)).toBe("07:00");
  });

  it("handles half-hour offsets", () => {
    expect(formatLocalTime(zoneFromCity("Asia/Kolkata", 88.4, "Kolkata"), WINTER)).toBe("17:30");
  });

  it("adds seconds on request", () => {
    const at = new Date("2026-01-15T12:00:07Z");
    expect(formatLocalTime(zoneFromLongitude(0), at, true)).toBe("12:00:07");
  });

  it("wraps past midnight into the next local day", () => {
    const at = new Date("2026-01-15T23:30:00Z");
    expect(formatLocalTime(zoneFromCity("Asia/Tokyo", 139.7), at)).toBe("08:30");
  });
});

describe("formatLocalDay", () => {
  it("names the local weekday, not the viewer's", () => {
    const at = new Date("2026-01-15T23:30:00Z"); // Thursday in UTC
    expect(formatLocalDay(zoneFromLongitude(0), at)).toBe("THU");
    expect(formatLocalDay(zoneFromCity("Asia/Tokyo", 139.7), at)).toBe("FRI");
    expect(formatLocalDay(zoneFromCity("America/Los_Angeles", -118), at)).toBe("THU");
  });
});

describe("formatOffsetLabel", () => {
  it("labels whole, half and zero offsets", () => {
    expect(formatOffsetLabel(zoneFromCity("Asia/Tokyo", 139.7), WINTER)).toBe("UTC+9");
    expect(formatOffsetLabel(zoneFromCity("Asia/Kolkata", 88.4), WINTER)).toBe("UTC+5:30");
    expect(formatOffsetLabel(zoneFromCity("Europe/London", -0.1), WINTER)).toBe("UTC");
  });

  it("labels negative and negative half offsets", () => {
    expect(formatOffsetLabel(zoneFromCity("America/New_York", -74), WINTER)).toBe("UTC-5");
    expect(formatOffsetLabel(zoneFromCity("America/St_Johns", -52.7), WINTER)).toBe("UTC-3:30");
  });
});

describe("localZoneCaption", () => {
  it("names the city a real zone was read from", () => {
    expect(localZoneCaption(zoneFromCity("Asia/Tokyo", 139.7, "Tokyo"), WINTER)).toBe("UTC+9 · Tokyo");
  });

  it("drops the name when the zone came from an unnamed place", () => {
    expect(localZoneCaption(zoneFromCity("Asia/Tokyo", 139.7), WINTER)).toBe("UTC+9");
  });

  it("clips a place name too long for the on-air row", () => {
    const zone = zoneFromCity("Asia/Kamchatka", 158.6, "Petropavlovsk-Kamchatsky");
    expect(localZoneCaption(zone, WINTER)).toBe("UTC+12 · Petropavlovsk…");
  });

  it("falls back to a hard clip when no boundary is near the limit", () => {
    expect(localZoneCaption(zoneFromCity("Asia/Bangkok", 100.5, "Krungthepmahanakhon"), WINTER)).toBe(
      "UTC+7 · Krungthepmahana…",
    );
  });

  it("keeps a name that already fits", () => {
    expect(localZoneCaption(zoneFromCity("Asia/Tokyo", 139.7, "San Sebastian"), WINTER)).toBe(
      "UTC+9 · San Sebastian",
    );
  });

  it("drops a whitespace-only place name rather than printing a dangling dot", () => {
    expect(localZoneCaption(zoneFromCity("Asia/Tokyo", 139.7, "   "), WINTER)).toBe("UTC+9");
  });

  it("marks a longitude guess as approximate", () => {
    expect(localZoneCaption(zoneFromLongitude(-150), WINTER)).toBe("UTC-10 approx");
  });
});
