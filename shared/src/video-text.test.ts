import { formatStreamTitle, STREAM_TITLE_TOKENS } from "./stream-title";
import {
  clipYouTubeDescription, formatVideoText, isValidTimeZone, trimVideoTitle,
  VIDEO_TEXT_NAMES, VIDEO_TEXT_TOKENS, YT_DESCRIPTION_MAX, YT_TITLE_MAX,
} from "./video-text";

const AT = new Date("2026-09-08T13:05:09Z");

it("resolves every %{name} code from the values", () => {
  const values = Object.fromEntries(VIDEO_TEXT_NAMES.map((name) => [name, `<${name}>`]));
  for (const [code] of VIDEO_TEXT_TOKENS) {
    expect(formatVideoText(`x ${code} y`, values, AT)).toBe(`x <${code.slice(2, -1)}> y`);
  }
  expect(VIDEO_TEXT_NAMES).toContain("placeId");
});

it("resolves every date code exactly as a live title does", () => {
  for (const [code] of STREAM_TITLE_TOKENS) {
    expect(formatVideoText(code, {}, AT)).toBe(formatStreamTitle(code, AT));
  }
});

it("mixes video codes and date codes in one template", () => {
  expect(formatVideoText("%{flag} %{place} weather · %A %e %B", { place: "United Kingdom", flag: "🇬🇧" }, AT))
    .toBe("🇬🇧 United Kingdom weather · Tuesday 8 September");
  expect(formatVideoText("/thumbs/%{placeId}.png", { placeId: "gb" }, AT)).toBe("/thumbs/gb.png");
});

it("never expands a % inside a substituted value", () => {
  expect(formatVideoText("%{headline} %Y", { headline: "100% chance of %d rain %{place}" }, AT))
    .toBe("100% chance of %d rain %{place} 2026");
});

it("resolves unknown or missing %{name} codes to empty", () => {
  expect(formatVideoText("a%{nope}b %{place}|", {}, AT)).toBe("ab |");
  expect(formatVideoText("%{toString}%{constructor}", {}, AT)).toBe("");
});

it("treats %% and unknown letters the same as formatStreamTitle", () => {
  const template = "100%% live · %%d · %%{place} · %q · %";
  expect(formatVideoText(template, { place: "X" }, AT)).toBe(formatStreamTitle(template, AT));
  expect(formatVideoText(template, { place: "X" }, AT)).toBe("100% live · %d · %{place} · %q · %");
});

it("dates in the given IANA zone, London by default", () => {
  const lateLondon = new Date("2026-09-08T20:30:00Z"); // 21:30 Tue in London, 06:30 Wed in Sydney
  expect(formatVideoText("%A %d %H:%M %Z", {}, lateLondon)).toBe("Tuesday 08 21:30 BST");
  expect(formatVideoText("%A %d %H:%M %Z", {}, lateLondon, "Europe/London")).toBe("Tuesday 08 21:30 BST");
  expect(formatVideoText("%A %d %H:%M %z", {}, lateLondon, "Australia/Sydney")).toBe("Wednesday 09 06:30 +1000");
  expect(formatStreamTitle("%A %d", lateLondon, "Australia/Sydney")).toBe("Wednesday 09");
});

it("validates time zones", () => {
  expect(isValidTimeZone("Australia/Sydney")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  expect(isValidTimeZone("")).toBe(false);
});

describe("trimVideoTitle", () => {
  it("leaves a title that fits alone, trimmed", () => {
    expect(trimVideoTitle("  Short title ")).toBe("Short title");
    const exact = "a".repeat(YT_TITLE_MAX);
    expect(trimVideoTitle(exact)).toBe(exact);
  });

  it("cuts at a word with an ellipsis inside 100 characters", () => {
    const long = "United Kingdom weather round-up, " + "storms and gales ".repeat(10);
    const out = trimVideoTitle(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(YT_TITLE_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    expect(long[out.length - 1]).toBe(" ");
  });

  it("keeps a whole last word when the cut falls on a space", () => {
    const title = `${"a".repeat(98)} bb`; // 101 chars; head = 98 a's + space
    expect(trimVideoTitle(title)).toBe(`${"a".repeat(98)}…`);
    expect(trimVideoTitle("aaaa bbbb cccc", 10)).toBe("aaaa bbbb…");
    expect(trimVideoTitle("aaaa, bbbb cccc", 9)).toBe("aaaa…");
  });

  it("cuts a single over-long word hard and never splits an emoji", () => {
    expect(trimVideoTitle("x".repeat(150))).toBe(`${"x".repeat(99)}…`);
    const flags = "🇬🇧".repeat(60);
    const out = trimVideoTitle(flags);
    expect(Array.from(out).length).toBe(YT_TITLE_MAX);
    expect(out.slice(0, -1)).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

it("clips a description the way live descriptions are clipped", () => {
  expect(clipYouTubeDescription("short")).toBe("short");
  const long = `${"word ".repeat(YT_DESCRIPTION_MAX / 5)}tail`;
  const out = clipYouTubeDescription(long);
  expect(out.length).toBeLessThanOrEqual(YT_DESCRIPTION_MAX);
  expect(out).toBe(long.slice(0, YT_DESCRIPTION_MAX).trimEnd());
});
