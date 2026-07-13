import { parseReportFacts } from "./parseReport";

describe("parseReportFacts", () => {
  const OLD = process.env.OPENROUTER_API_KEY;
  const OLD_MODEL = process.env.OPENROUTER_VOLCANO_MODEL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = OLD;
    if (OLD_MODEL === undefined) delete process.env.OPENROUTER_VOLCANO_MODEL;
    else process.env.OPENROUTER_VOLCANO_MODEL = OLD_MODEL;
  });

  it("skips when no API key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await parseReportFacts("Ash plume rose to 3km, VEI 2 explosion reported.");
    expect(res.status).toBe("skipped");
  });

  it("skips on empty report text even with a key configured", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const res = await parseReportFacts("   ");
    expect(res.status).toBe("skipped");
  });

  it("parses plumeHeightM/vei out of the completion JSON", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"plumeHeightM": 3000, "vei": 2}' } }] }),
    }) as unknown as typeof fetch;
    const res = await parseReportFacts("Ash plume rose to 3km, VEI 2 explosion reported.", fetchImpl);
    expect(res).toMatchObject({ status: "ok", plumeHeightM: 3000, vei: 2 });
  });

  it("returns an error on a non-2xx response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }) as unknown as typeof fetch;
    const res = await parseReportFacts("some report text", fetchImpl);
    expect(res.status).toBe("error");
    expect(res.error).toContain("429");
  });

  it("returns an error when the completion has no parseable JSON", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "no idea" } }] }),
    }) as unknown as typeof fetch;
    const res = await parseReportFacts("some report text", fetchImpl);
    expect(res.status).toBe("error");
  });

  it("retries a removed configured model with the supported fallback", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_VOLCANO_MODEL = "google/gemini-flash-1.5";
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "No endpoints found" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"plumeHeightM":1200,"vei":null}' } }] }) }) as unknown as typeof fetch;
    await expect(parseReportFacts("plume at 1.2 km", fetchImpl)).resolves.toMatchObject({ status: "ok", plumeHeightM: 1200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchImpl as jest.Mock).mock.calls[1][1].body)).model).toBe("google/gemini-3.1-flash-lite");
  });
});
