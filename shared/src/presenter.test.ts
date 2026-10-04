import {
  DEFAULT_VOICE,
  estimateSpeechCostUsd,
  parseSpeechModels,
  pricePerMillionChars,
  sanitizePresenter,
  sanitizePresenterSettings,
  sanitizeVoice,
  slugify,
} from "./presenter";

describe("slugify", () => {
  it("makes a url-safe id", () => {
    expect(slugify("Night Desk!")).toBe("night-desk");
    expect(slugify("  Café  Météo ")).toBe("cafe-meteo");
    expect(slugify("!!!")).toBe("");
  });
});

describe("sanitizeVoice", () => {
  it("falls back to the default voice", () => {
    expect(sanitizeVoice(undefined)).toEqual(DEFAULT_VOICE);
    expect(sanitizeVoice(undefined)).not.toBe(DEFAULT_VOICE);
  });
  it("clamps speed and trims strings", () => {
    const v = sanitizeVoice({ model: " x/y ", voice: " af_heart ", speed: 9, style: "  calm ", options: { a: 1 } });
    expect(v).toEqual({ model: "x/y", voice: "af_heart", speed: 2, style: "calm", options: { a: 1 } });
    expect(sanitizeVoice({ speed: 0.1 }).speed).toBe(0.5);
  });
  it("drops empty or array options", () => {
    expect(sanitizeVoice({ options: {} }).options).toBeNull();
    expect(sanitizeVoice({ options: [1] }).options).toBeNull();
  });
});

describe("sanitizePresenter", () => {
  it("derives the id from the name when missing", () => {
    expect(sanitizePresenter({ name: "Night Desk" })?.id).toBe("night-desk");
  });
  it("keeps an explicit id and returns null with neither", () => {
    expect(sanitizePresenter({ id: "house", name: "House voice" })?.id).toBe("house");
    expect(sanitizePresenter({ persona: "x" })).toBeNull();
  });
});

describe("sanitizePresenterSettings", () => {
  it("defaults to off", () => {
    expect(sanitizePresenterSettings(null)).toEqual({ enabled: false });
    expect(sanitizePresenterSettings({ enabled: true })).toEqual({ enabled: true });
    expect(sanitizePresenterSettings({ enabled: "yes" })).toEqual({ enabled: false });
  });
});

describe("parseSpeechModels", () => {
  it("accepts string and object voices, keeps pricing, sorts by id", () => {
    const out = parseSpeechModels({
      data: [
        { id: "z/two", name: "Two", supported_voices: [{ voice_id: "v1" }, { name: "v2" }], pricing: { prompt: "0.000015" } },
        { id: "a/one", supported_voices: ["af_heart", "af_heart", "am_adam"], pricing: { audio_output_second: 0.0025 } },
        { name: "no id" },
      ],
    });
    expect(out.map((m) => m.id)).toEqual(["a/one", "z/two"]);
    expect(out[0].voices).toEqual(["af_heart", "am_adam"]);
    expect(out[0].name).toBe("a/one");
    expect(out[0].pricing).toEqual({ audio_output_second: "0.0025" });
    expect(out[1].voices).toEqual(["v1", "v2"]);
  });
  it("returns [] for junk", () => {
    expect(parseSpeechModels(null)).toEqual([]);
    expect(parseSpeechModels({ data: "x" })).toEqual([]);
  });
});

describe("estimateSpeechCostUsd", () => {
  it("per character from prompt", () => {
    expect(estimateSpeechCostUsd({ prompt: "0.000015" }, 1000)).toBeCloseTo(0.015);
    expect(pricePerMillionChars({ prompt: "0.000015" })).toBe(15);
  });
  it("per second when the model bills by duration", () => {
    expect(estimateSpeechCostUsd({ audio_output_second: "0.0025" }, 1000, 10_000)).toBeCloseTo(0.025);
  });
  it("null when unknown", () => {
    expect(estimateSpeechCostUsd({}, 1000)).toBeNull();
    expect(estimateSpeechCostUsd({ prompt: "0" }, 1000)).toBeNull();
    expect(estimateSpeechCostUsd(undefined, 1000)).toBeNull();
  });
});
