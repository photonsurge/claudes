import { listSpeechModels, speak, speechBody } from "./openrouter-speech";

const audioRes = (bytes: number[], headers: Record<string, string> = {}) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "audio/mpeg", ...headers }),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    text: async () => "",
  }) as unknown as Response;

const errRes = (status: number, body = "") =>
  ({ ok: false, status, headers: new Headers(), text: async () => body }) as unknown as Response;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});

describe("speechBody", () => {
  it("omits the default voice and speed, keeps extras last", () => {
    expect(speechBody({ model: "m", input: "hi" })).toEqual({ model: "m", input: "hi", response_format: "mp3" });
    expect(speechBody({ model: "m", input: "hi", voice: "v", speed: 1.2, extra: { provider: { x: 1 } } })).toEqual({
      model: "m",
      input: "hi",
      voice: "v",
      speed: 1.2,
      response_format: "mp3",
      provider: { x: 1 },
    });
  });
});

describe("speak", () => {
  it("returns the audio and generation id", async () => {
    const fetchImpl = jest.fn(async () => audioRes([1, 2, 3], { "x-generation-id": "gen-1" }));
    const res = await speak({ model: "m", input: "hi", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect([...res.audio]).toEqual([1, 2, 3]);
      expect(res.generationId).toBe("gen-1");
      expect(res.contentType).toBe("audio/mpeg");
    }
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/audio\/speech$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("does not retry a 4xx", async () => {
    const fetchImpl = jest.fn(async () => errRes(400, "bad voice"));
    const res = await speak({ model: "m", input: "hi", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("bad voice");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx then succeeds", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(errRes(503)).mockResolvedValueOnce(audioRes([9]));
    const res = await speak({ model: "m", input: "hi", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a JSON 200 as an error, not audio", async () => {
    const fetchImpl = jest.fn(
      async () =>
        ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), text: async () => '{"error":"x"}' }) as unknown as Response,
    );
    const res = await speak({ model: "m", input: "hi", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(false);
  });
});

describe("listSpeechModels", () => {
  it("parses the list", async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "a/b", supported_voices: ["v"] }] }) }) as unknown as Response,
    );
    const models = await listSpeechModels(fetchImpl as unknown as typeof fetch);
    expect(models.map((m) => m.id)).toEqual(["a/b"]);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain("output_modalities=speech");
  });
  it("throws on a failed request", async () => {
    const fetchImpl = jest.fn(async () => errRes(500, "down"));
    await expect(listSpeechModels(fetchImpl as unknown as typeof fetch)).rejects.toThrow("500");
  });
});
