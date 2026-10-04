import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig } from "./director";
import {
  COPY_EXCLUDED_KEYS,
  DIRECTOR_TEMPLATES,
  DIRECTOR_TEMPLATE_LIST,
  TEMPLATE_KEYS,
  copyablePatch,
  templateChanges,
  templatePatch,
  type DirectorTemplateId,
} from "./director-templates";

const ids = Object.keys(DIRECTOR_TEMPLATES) as DirectorTemplateId[];

describe("DIRECTOR_TEMPLATES", () => {
  it("lists every template once, full feed first", () => {
    expect(DIRECTOR_TEMPLATE_LIST.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(DIRECTOR_TEMPLATE_LIST[0].id).toBe("full");
    for (const id of ids) expect(DIRECTOR_TEMPLATES[id].id).toBe(id);
  });

  it.each(ids)("%s sets exactly the template keys — never looks, slides, break-ins or live controls", (id) => {
    const keys = Object.keys(DIRECTOR_TEMPLATES[id].config).sort();
    expect(keys).toEqual([...TEMPLATE_KEYS].sort());
    for (const banned of ["kindLooks", "kindSlides", "breakIn", "skipNonce", "activeSlideId", "mode"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it.each(ids)("%s survives the config merge unchanged (every value in bounds)", (id) => {
    const merged = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, templatePatch(id));
    for (const k of TEMPLATE_KEYS) expect(merged[k]).toEqual(DIRECTOR_TEMPLATES[id].config[k]);
  });

  it.each(ids)("%s gives a complete kinds and holds map", (id) => {
    const t = DIRECTOR_TEMPLATES[id].config;
    expect(Object.keys(t.kinds).sort()).toEqual(Object.keys(DEFAULT_DIRECTOR_CONFIG.kinds).sort());
    expect(Object.keys(t.kindHoldSeconds).sort()).toEqual(Object.keys(DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds).sort());
  });

  it("full is today's show", () => {
    expect(templateChanges(DEFAULT_DIRECTOR_CONFIG, "full")).toEqual([]);
  });

  it("maps airs no events, long holds, slow map steps, no ads", () => {
    const t = DIRECTOR_TEMPLATES.maps.config;
    const on = Object.entries(t.kinds).filter(([, v]) => v).map(([k]) => k).sort();
    expect(on).toEqual(["global", "intro", "ocean", "orbital"]);
    expect(t.kindHoldSeconds.global).toBe(90);
    expect(t.tempo.mapStepS).toBe(10);
    expect(t.kinds.ad).toBe(false);
  });

  it("events airs the event kinds with short world bridges and a higher quake bar", () => {
    const t = DIRECTOR_TEMPLATES.events.config;
    for (const k of ["storm", "quake", "volcano", "flight", "ship", "global"] as const) expect(t.kinds[k]).toBe(true);
    expect(t.kinds.country).toBe(false);
    expect(t.kindHoldSeconds.global).toBeLessThan(DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds.global);
    expect(t.minQuakeMag).toBe(5);
  });

  it("ocean leads on the oceans with long dwells", () => {
    const t = DIRECTOR_TEMPLATES.ocean.config;
    expect(t.kinds.ocean && t.kinds.orbital && t.kinds.global).toBe(true);
    expect(t.kinds.storm).toBe(false);
    expect(t.kindWeights.ocean).toBeGreaterThan(1);
    expect(t.tours.stopDwellS).toBeGreaterThan(DEFAULT_DIRECTOR_CONFIG.tours.stopDwellS);
  });
});

describe("templatePatch", () => {
  it("is a copy — editing a staged draft never edits the template", () => {
    const patch = templatePatch("maps");
    patch.kinds.storm = true;
    patch.tempo.mapStepS = 99;
    expect(DIRECTOR_TEMPLATES.maps.config.kinds.storm).toBe(false);
    expect(DIRECTOR_TEMPLATES.maps.config.tempo.mapStepS).toBe(10);
  });
});

describe("templateChanges", () => {
  it("lists only the keys the template would actually change", () => {
    const changes = templateChanges(DEFAULT_DIRECTOR_CONFIG, "events");
    expect(changes).toEqual(expect.arrayContaining(["kinds", "kindWeights", "kindHoldSeconds", "minQuakeMag"]));
    expect(changes).not.toContain("pools");
    expect(changes).not.toContain("tours");
  });

  it("is empty once a channel already matches", () => {
    const applied = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, templatePatch("ocean"));
    expect(templateChanges(applied, "ocean")).toEqual([]);
  });
});

describe("copyablePatch", () => {
  const source: DirectorConfig = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, {
    mode: "auto",
    skipNonce: 7,
    activeSlideId: { quake: "s1" },
    minQuakeMag: 6,
    kindLooks: { quake: { overlays: {} } } as DirectorConfig["kindLooks"],
    script: { scriptId: "s1", fromClip: 0, playNonce: 2, record: false },
  });

  it("copies everything but the live controls and the script play trigger", () => {
    const patch = copyablePatch(source);
    for (const k of COPY_EXCLUDED_KEYS) expect(patch).not.toHaveProperty(k);
    expect(patch.minQuakeMag).toBe(6);
    expect(patch.breakIn).toEqual(source.breakIn);
    expect(patch.kindSlides).toEqual(source.kindSlides);
  });

  it("is a copy of the source", () => {
    const patch = copyablePatch(source);
    patch.countries!.push("zz");
    expect(source.countries).not.toContain("zz");
  });
});
