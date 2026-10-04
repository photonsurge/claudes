/**
 * lib/short-formats — the PUT body (cleared values sent as explicit clears, so
 * the server's patch semantics can't keep a stale value) and the title /
 * description preview the YouTube video card shows.
 */
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import { VIDEO_TEXT_TOKENS } from "@photonsurge/shared/video-text";
import {
  YOUTUBE_CATEGORIES,
  exampleVideoValues,
  formatPatchBody,
  previewTimeZone,
  previewVideoDescription,
  previewVideoTitle,
  textLength,
} from "./short-formats";

// 2026-09-08 13:05 UTC = 14:05 in London (BST).
const NOW = new Date("2026-09-08T13:05:00Z");

describe("formatPatchBody", () => {
  const f = defaultShortFormat("short-eu", "Europe");

  it("sends a template with no scope as an explicit clear", () => {
    const body = formatPatchBody({ template: { ...f.template, scope: undefined } });
    expect(body.template).toMatchObject({ scope: null, budgetMs: f.template.budgetMs });
  });

  it("keeps a template's scope", () => {
    const body = formatPatchBody({ template: { ...f.template, scope: { type: "area", id: "europe" } } });
    expect((body.template as { scope: unknown }).scope).toEqual({ type: "area", id: "europe" });
  });

  it("clears empty render defaults and an empty playlist", () => {
    const body = formatPatchBody({ render: { encoderId: "obs-2" }, video: { ...f.video } });
    expect(body.render).toEqual({ encoderId: "obs-2", accountId: "" });
    expect((body.video as { playlistId: string }).playlistId).toBe("");
  });

  it("passes other fields through and leaves unstaged ones out", () => {
    const body = formatPatchBody({ name: "Europe at six", timing: { leadInMs: 1000, leadOutMs: 2000 } });
    expect(body).toEqual({ name: "Europe at six", timing: { leadInMs: 1000, leadOutMs: 2000 } });
  });
});

describe("video text preview", () => {
  it("has an example value for every code", () => {
    const values = exampleVideoValues();
    for (const [code, , example] of VIDEO_TEXT_TOKENS) expect(values[code.slice(2, -1)]).toBe(example);
  });

  it("resolves the date codes in London and the values from the script", () => {
    expect(previewVideoTitle("%{place} round-up · %A %e %B %H:%M", { place: "Europe" }, NOW, "Europe/London")).toBe(
      "Europe round-up · Tuesday 8 September 14:05",
    );
  });

  it("resolves in another zone, and in London for the place's own or an unknown zone", () => {
    expect(previewVideoTitle("%H:%M", {}, NOW, "Australia/Sydney")).toBe("23:05");
    expect(previewVideoTitle("%H:%M", {}, NOW, "place")).toBe("14:05");
    expect(previewVideoTitle("%H:%M", {}, NOW, "Mars/Olympus")).toBe("14:05");
    expect(previewTimeZone("place")).toBe("Europe/London");
  });

  it("trims a long title at a word to 100 characters", () => {
    const title = previewVideoTitle("%{headline}", { headline: "word ".repeat(40) }, NOW, "Europe/London");
    expect(textLength(title)).toBeLessThanOrEqual(100);
    expect(title.endsWith("…")).toBe(true);
  });

  it("clips a long description to YouTube's limit", () => {
    const text = previewVideoDescription("%{roundup}", { roundup: "x".repeat(6000) }, NOW, "Europe/London");
    expect(text.length).toBe(5000);
  });

  it("counts code points, as the title trim does", () => {
    expect(textLength("🌍 UK")).toBe(4);
  });

  it("offers News & Politics, the default category", () => {
    expect(YOUTUBE_CATEGORIES.some((c) => c.id === defaultShortFormat().video.categoryId)).toBe(true);
  });
});
