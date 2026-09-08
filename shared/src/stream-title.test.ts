import { formatStreamTitle } from "./stream-title";

it("replaces %D with the uppercase weekday inside any title", () => {
  expect(formatStreamTitle("SOMETHING %D", new Date("2026-09-08T13:05:00Z"))).toBe("SOMETHING TUESDAY");
});

it("formats dates, names and case-sensitive time tokens in UK summer time", () => {
  expect(formatStreamTitle("%a %A %d/%m/%y %Y %b %B %H:%M:%S", new Date("2026-09-08T13:05:09Z")))
    .toBe("Tue Tuesday 08/09/26 2026 Sept September 14:05:09");
});
it("uses GMT in winter and rolls over the date at UK midnight", () => {
  expect(formatStreamTitle("%d/%m/%Y %H:%M", new Date("2026-01-01T00:05:00Z"))).toBe("01/01/2026 00:05");
  expect(formatStreamTitle("%d/%m/%Y %H:%M", new Date("2026-06-30T23:05:00Z"))).toBe("01/07/2026 00:05");
});
it("keeps literal percents, unknown codes and plain titles unchanged", () => {
  expect(formatStreamTitle("100%% live · %%d · %q · %")).toBe("100% live · %d · %q · %");
  expect(formatStreamTitle("Weather live")).toBe("Weather live");
});

it("formats the common presets, 12-hour clock, timezone and calendar counters", () => {
  expect(formatStreamTitle("%F %R %T %I %p %Z %z %e %j %u", new Date("2026-09-08T13:05:09Z")))
    .toBe("2026-09-08 14:05 14:05:09 02 PM BST +0100 8 251 2");
  expect(formatStreamTitle("%I %p %Z %z %j %u", new Date("2024-12-31T00:05:09Z")))
    .toBe("12 AM GMT +0000 366 2");
});
