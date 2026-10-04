import { DEFAULT_VOICE, type VoiceTest } from "@photonsurge/shared/presenter";
import { refreshSpeechCatalog, runVoiceTest, speechCacheKey } from "./bench";
import { prepareSpeech } from "./voice-traits";

/** One MPEG-1 Layer III frame header repeated: 10 frames at 128k/44.1k. */
const MP3 = Buffer.alloc(417 * 10);
for (let i = 0; i < 10; i++) MP3.set([0xff, 0xfb, 0x90, 0x64], i * 417);

function fakeDb(enabled: boolean, take: Partial<VoiceTest> = {}, earlier: VoiceTest[] = []) {
  const store: Record<string, VoiceTest> = {
    t1: {
      id: "t1",
      presenterId: "house",
      label: "House voice",
      text: "Gusts to 120 km/h.",
      voice: { ...DEFAULT_VOICE, voice: "af_heart" },
      status: "queued",
      createdBy: "op",
      createdAt: new Date().toISOString(),
      ...take,
    },
  };
  const audio: Record<string, Buffer> = {};
  for (const e of earlier) {
    store[e.id] = e;
    audio[e.id] = MP3;
  }
  const db = {
    presenterSettings: { get: async () => ({ enabled }) },
    speechCatalog: {
      get: async () => ({ models: [{ id: DEFAULT_VOICE.model, name: "", description: "", voices: [], pricing: { prompt: "0.00000062" } }], fetchedAt: null }),
      save: jest.fn(async () => undefined),
    },
    voiceTests: {
      get: async (id: string) => (store[id] ? { ...store[id] } : null),
      update: async (id: string, patch: Partial<VoiceTest>) => {
        store[id] = { ...store[id], ...patch };
      },
      findCached: async (key: string, except: string) =>
        Object.values(store).find((t) => t.cacheKey === key && t.id !== except && t.status === "ready" && !t.cachedFrom) ?? null,
      getAudio: async (id: string) => (audio[id] ? { data: audio[id], contentType: "audio/mpeg" } : null),
      putAudio: async (id: string, bytes: Buffer, patch: Partial<VoiceTest>) => {
        audio[id] = bytes;
        store[id] = { ...store[id], ...patch };
      },
    },
  };
  return { db: db as never, store, audio };
}

describe("runVoiceTest", () => {
  it("speaks the speakable text and stores the take", async () => {
    const { db, store, audio } = fakeDb(true);
    const speak = jest.fn(async () => ({ ok: true as const, audio: MP3, contentType: "audio/mpeg", generationId: "g", latencyMs: 50, body: {} }));
    const res = await runVoiceTest(db, "t1", { speak, hasKey: () => true });

    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ input: "Gusts to 120 kilometres per hour.", voice: "af_heart" }));
    expect(res?.status).toBe("ready");
    expect(store.t1.spoken).toBe("Gusts to 120 kilometres per hour.");
    expect(store.t1.audio?.durationMs).toBe(Math.round((10 * 1152 * 1000) / 44100));
    expect(store.t1.audio?.estCostUsd).toBeCloseTo(0.00000062 * "Gusts to 120 kilometres per hour.".length);
    expect(audio.t1).toBe(MP3);
  });

  it("makes no call when the presenter is switched off", async () => {
    const { db, store } = fakeDb(false);
    const speak = jest.fn();
    await runVoiceTest(db, "t1", { speak, hasKey: () => true });
    expect(speak).not.toHaveBeenCalled();
    expect(store.t1.status).toBe("error");
    expect(store.t1.error).toMatch(/switched off/);
  });

  it("makes no call without an API key", async () => {
    const { db, store } = fakeDb(true);
    const speak = jest.fn();
    await runVoiceTest(db, "t1", { speak, hasKey: () => false });
    expect(speak).not.toHaveBeenCalled();
    expect(store.t1.error).toMatch(/OPENROUTER_API_KEY/);
  });

  it("records the provider's error", async () => {
    const { db, store } = fakeDb(true);
    const speak = jest.fn(async () => ({ ok: false as const, error: "400 unknown voice", latencyMs: 5, body: {} }));
    await runVoiceTest(db, "t1", { speak, hasKey: () => true });
    expect(store.t1.status).toBe("error");
    expect(store.t1.error).toBe("400 unknown voice");
  });

  it("does not re-speak a ready take", async () => {
    const { db } = fakeDb(true, { status: "ready" });
    const speak = jest.fn();
    await runVoiceTest(db, "t1", { speak, hasKey: () => true });
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("runVoiceTest cache", () => {
  const voice = { ...DEFAULT_VOICE, voice: "af_heart" };
  const key = speechCacheKey(voice.model, prepareSpeech(voice, "Gusts to 120 kilometres per hour."));
  const earlier: VoiceTest = {
    id: "old",
    presenterId: "house",
    label: "House voice",
    text: "Gusts to 120 km/h.",
    voice,
    status: "ready",
    cacheKey: key,
    createdBy: "op",
    createdAt: "2026-10-04T00:00:00Z",
    audio: { contentType: "audio/mpeg", bytes: MP3.length, chars: 33, latencyMs: 900, durationMs: 261, estCostUsd: 0.00002 },
  };

  it("reuses an identical take's audio for free, even with the switch off", async () => {
    const { db, store, audio } = fakeDb(false, {}, [earlier]);
    const speak = jest.fn();
    const res = await runVoiceTest(db, "t1", { speak, hasKey: () => false });
    expect(speak).not.toHaveBeenCalled();
    expect(res?.status).toBe("ready");
    expect(store.t1.cachedFrom).toBe("old");
    expect(store.t1.audio).toMatchObject({ estCostUsd: 0, latencyMs: 0, durationMs: 261 });
    expect(audio.t1).toBe(MP3);
  });

  it("makes new audio when a fresh take is asked for", async () => {
    const { db, store } = fakeDb(true, { fresh: true }, [earlier]);
    const speak = jest.fn(async () => ({ ok: true as const, audio: MP3, contentType: "audio/mpeg", latencyMs: 5, body: {} }));
    await runVoiceTest(db, "t1", { speak, hasKey: () => true });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(store.t1.cachedFrom).toBeUndefined();
    expect(store.t1.cacheKey).toBe(key);
  });

  it("does not reuse across a different voice", async () => {
    const { db } = fakeDb(true, { voice: { ...voice, voice: "am_adam" } }, [earlier]);
    const speak = jest.fn(async () => ({ ok: true as const, audio: MP3, contentType: "audio/mpeg", latencyMs: 5, body: {} }));
    await runVoiceTest(db, "t1", { speak, hasKey: () => true });
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("lets the CLI bypass the master switch", async () => {
    const { db, store } = fakeDb(false, { fresh: true });
    const speak = jest.fn(async () => ({ ok: true as const, audio: MP3, contentType: "audio/mpeg", latencyMs: 5, body: {} }));
    await runVoiceTest(db, "t1", { speak, hasKey: () => true, ignoreSwitch: true });
    expect(store.t1.status).toBe("ready");
  });
});

describe("runVoiceTest pricing", () => {
  it("fetches the model list once when the catalog is empty, so the cost is known", async () => {
    const { db, store } = fakeDb(true);
    let models: unknown[] = [];
    (db as any).speechCatalog = {
      get: async () => ({ models, fetchedAt: null }),
      save: async (m: unknown[]) => {
        models = m;
      },
    };
    const speak = jest.fn(async () => ({ ok: true as const, audio: MP3, contentType: "audio/mpeg", latencyMs: 5, body: {} }));
    const listModels = jest.fn(async () => [{ id: DEFAULT_VOICE.model, name: "", description: "", voices: [], pricing: { prompt: "0.000001" } }]);
    await runVoiceTest(db, "t1", { speak, hasKey: () => true, listModels });
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(store.t1.audio?.estCostUsd).toBeCloseTo(0.000001 * "Gusts to 120 kilometres per hour.".length);
  });
});

describe("refreshSpeechCatalog", () => {
  it("saves the list", async () => {
    const { db } = fakeDb(true);
    const res = await refreshSpeechCatalog(db, async () => [{ id: "a", name: "a", description: "", voices: ["x", "y"], pricing: {} }]);
    expect(res).toEqual({ models: 1, voices: 2 });
  });
  it("keeps the cache when the list comes back empty", async () => {
    const { db } = fakeDb(true);
    await expect(refreshSpeechCatalog(db, async () => [])).rejects.toThrow("keeping the cached list");
  });
});
