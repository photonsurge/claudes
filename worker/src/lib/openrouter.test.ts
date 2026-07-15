import { callOpenRouter } from "./openrouter";

const OPTS = { model: "m", system: "s", user: "u" };

const okResponse = (content: string) =>
  ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;

const errResponse = (status: number, body = "") =>
  ({ ok: false, status, text: async () => body }) as unknown as Response;

/** undici's real shape: an opaque TypeError whose `cause` holds the reason. */
function fetchFailed(code: string, message: string): Error {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error(message), { code });
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENROUTER_API_KEY = "test-key";
});

describe("callOpenRouter", () => {
  it("returns the completion content on success", async () => {
    const fetchImpl = jest.fn(async () => okResponse("hello"));
    const res = await callOpenRouter({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe("ok");
    expect(res.content).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces the underlying cause instead of the opaque 'fetch failed'", async () => {
    const fetchImpl = jest.fn(async () => {
      throw fetchFailed("EAI_AGAIN", "getaddrinfo EAI_AGAIN openrouter.ai");
    });
    const res = await callOpenRouter({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe("error");
    expect(res.error).toContain("EAI_AGAIN");
    expect(res.error).toContain("getaddrinfo");
  });

  it("retries a transient network error and succeeds", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(fetchFailed("ECONNRESET", "read ECONNRESET"))
      .mockResolvedValueOnce(okResponse("recovered"));

    const res = await callOpenRouter({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe("ok");
    expect(res.content).toBe("recovered");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries 429 and 5xx, giving up after the retry budget", async () => {
    const fetchImpl = jest.fn(async () => errResponse(503, "upstream down"));
    const res = await callOpenRouter({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe("error");
    expect(res.error).toContain("503");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + MAX_RETRIES
  });

  it("does not retry a deterministic 4xx", async () => {
    const fetchImpl = jest.fn(async () => errResponse(401, "no credit"));
    const res = await callOpenRouter({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe("error");
    expect(res.error).toContain("401");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports an empty completion as an error rather than a silent ok", async () => {
    const fetchImpl = jest.fn(async () => okResponse(""));
    const res = await callOpenRouter({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.status).toBe("error");
    expect(res.error).toBe("empty completion");
  });
});
