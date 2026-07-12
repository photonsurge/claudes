/**
 * Unit tests for the request logger. The shared BackLogger (which writes to
 * Mongo) is mocked, so these assert the wrapper's behaviour — what it logs and
 * that it never disturbs the response — without any DB.
 */
const publicBackLogger = jest.fn();
jest.mock("@photonsurge/shared/utill/BackLogger", () => ({
  PublicBackLogger: (...args: unknown[]) => publicBackLogger(...args),
}));

import { withApiLog, logDataFetch } from "./api-log";

// Minimal stand-ins so we don't depend on global Request/Response in jsdom.
const req = (url: string, method = "GET") => ({ url, method }) as unknown as Request;
const res = (status: number, xCache?: string) =>
  ({ status, headers: { get: (h: string) => (h === "X-Cache" ? xCache : null) } }) as unknown as Response;

beforeEach(() => publicBackLogger.mockClear());

describe("withApiLog", () => {
  it("logs method / path / status / duration and returns the response untouched", async () => {
    const out = res(200, "miss");
    const wrapped = withApiLog(async () => out);

    const returned = await wrapped(req("http://x/api/status?foo=1"));

    expect(returned).toBe(out); // response passes straight through
    expect(publicBackLogger).toHaveBeenCalledTimes(1);
    const [instance, level, tag, message, stuff, type, targetID] = publicBackLogger.mock.calls[0];
    expect(instance).toBe("public");
    expect(level).toBe("info");
    expect(tag).toBe("api:/api/status");
    expect(message).toMatch(/^GET \/api\/status → 200 \(\d+ms\)$/);
    expect(type).toBe("request");
    expect(targetID).toBe("/api/status");
    expect(stuff).toMatchObject({ method: "GET", path: "/api/status", status: 200, cache: "miss", query: "foo=1" });
    expect(typeof (stuff as { ms: number }).ms).toBe("number");
  });

  it("forwards the Next context (params) to the wrapped handler", async () => {
    const handler = jest.fn(async () => res(200));
    const ctx = { params: Promise.resolve({ id: "42" }) };
    await withApiLog(handler as never)(req("http://x/api/cities/42"), ctx as never);
    expect(handler).toHaveBeenCalledWith(req("http://x/api/cities/42"), ctx);
  });

  it("logs at error level and rethrows when the handler throws", async () => {
    const boom = new Error("kaboom");
    const wrapped = withApiLog(async () => {
      throw boom;
    });
    await expect(wrapped(req("http://x/api/volcanoes"))).rejects.toBe(boom);
    expect(publicBackLogger).toHaveBeenCalledTimes(1);
    expect(publicBackLogger.mock.calls[0][1]).toBe("error");
    expect(publicBackLogger.mock.calls[0][3]).toMatch(/threw/);
  });

  it("uses error level for a 5xx response", async () => {
    await withApiLog(async () => res(502))(req("http://x/api/alerts"));
    expect(publicBackLogger.mock.calls[0][1]).toBe("error");
  });

  it("skips byte-serving / health routes by default", async () => {
    for (const p of ["/api/weather/tex/abc", "/api/media/xyz", "/api/aurora/frame.png", "/api/ping"]) {
      await withApiLog(async () => res(200))(req(`http://x${p}`));
    }
    expect(publicBackLogger).not.toHaveBeenCalled();
  });
});

describe("logDataFetch", () => {
  it("records the cache key, duration and hit flag under api:data", () => {
    logDataFetch("feed:v1:volcanoes:-:-", 123, false);
    expect(publicBackLogger).toHaveBeenCalledTimes(1);
    const [, level, tag, message, stuff, type, targetID] = publicBackLogger.mock.calls[0];
    expect(level).toBe("info");
    expect(tag).toBe("api:data");
    expect(message).toBe("feed:v1:volcanoes:-:- miss (123ms)");
    expect(stuff).toEqual({ key: "feed:v1:volcanoes:-:-", ms: 123, hit: false });
    expect(type).toBe("request");
    expect(targetID).toBe("feed:v1:volcanoes:-:-");
  });
});
