import type { iAlertModel } from "@photonsurge/shared/db/alert-model";
import { alertContentHash as contentHash } from "@photonsurge/shared/alerts/content-hash";
import { runAlertsTranslate } from "./translate";

const listMock = jest.fn();
const updateTranslationMock = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: jest.fn(async () => ({
    alerts: { list: listMock, updateTranslation: updateTranslationMock },
  })),
}));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

const callOpenRouterMock = jest.fn();
jest.mock("../lib/openrouter", () => ({ callOpenRouter: (...args: unknown[]) => callOpenRouterMock(...args) }));

function alert(overrides: Partial<iAlertModel["info"][0]> = {}): iAlertModel {
  return {
    id: "a1",
    identifier: "cn-cma-xx/2026/1",
    info: [
      {
        headline: "台风红色预警",
        description: "台风将于今晚登陆",
        instruction: "请立即避难",
        severityRank: 4,
        category: [],
        event: "Typhoon",
        area: [],
        ...overrides,
      },
    ],
  } as unknown as iAlertModel;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("runAlertsTranslate", () => {
  const OLD = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = OLD;
  });

  it("skips entirely (never touches Mongo) with no API key configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ skipped: true, candidates: 0 });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("skips an info entry with no headline/description/instruction text", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    listMock.mockResolvedValue([alert({ headline: "", description: "", instruction: "" })]);
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 0, translated: 0, englishSource: 0, failed: 0 });
    expect(callOpenRouterMock).not.toHaveBeenCalled();
  });

  it("skips an info entry whose translationHash already matches the current content", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const hash = contentHash("台风红色预警", "台风将于今晚登陆", "请立即避难");
    listMock.mockResolvedValue([alert({ translationHash: hash })]);
    const res = await runAlertsTranslate();
    expect(res.candidates).toBe(0);
    expect(callOpenRouterMock).not.toHaveBeenCalled();
    expect(updateTranslationMock).not.toHaveBeenCalled();
  });

  it("re-translates a hash-matched entry when force is set", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const hash = contentHash("台风红色预警", "台风将于今晚登陆", "请立即避难");
    listMock.mockResolvedValue([alert({ translationHash: hash })]);
    callOpenRouterMock.mockResolvedValue({
      status: "ok",
      content: '{"language":"zh","headline":"Typhoon Red Alert","description":"Typhoon landing tonight","instruction":"Take shelter immediately"}',
      latencyMs: 10,
    });
    const res = await runAlertsTranslate({ force: true });
    expect(res.candidates).toBe(1);
    expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
  });

  it("translates a non-English alert and writes back English text + detected language", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    listMock.mockResolvedValue([alert()]);
    callOpenRouterMock.mockResolvedValue({
      status: "ok",
      content: '{"language":"zh","headline":"Typhoon Red Alert","description":"Typhoon landing tonight","instruction":"Take shelter immediately"}',
      latencyMs: 10,
    });
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 1, translated: 1, englishSource: 0, failed: 0 });
    expect(listMock).toHaveBeenCalledWith({ activeOnly: true, severityMin: 3 });
    expect(updateTranslationMock).toHaveBeenCalledWith(
      "a1",
      0,
      expect.objectContaining({
        detectedLanguage: "zh",
        translatedHeadline: "Typhoon Red Alert",
        translatedDescription: "Typhoon landing tonight",
        translatedInstruction: "Take shelter immediately",
      }),
    );
  });

  it("clears translated fields to \"\" when the source is already English", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    listMock.mockResolvedValue([alert({ headline: "Flash Flood Warning", description: "Heavy rain", instruction: "Move to higher ground" })]);
    callOpenRouterMock.mockResolvedValue({
      status: "ok",
      content: '{"language":"en","headline":"Flash Flood Warning","description":"Heavy rain","instruction":"Move to higher ground"}',
      latencyMs: 10,
    });
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 1, translated: 0, englishSource: 1, failed: 0 });
    expect(updateTranslationMock).toHaveBeenCalledWith(
      "a1",
      0,
      expect.objectContaining({
        detectedLanguage: "en",
        translatedHeadline: "",
        translatedDescription: "",
        translatedInstruction: "",
      }),
    );
  });

  it("skips the LLM for a WMO -en edition, stamping it English locally", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    // A WMO English-edition capurl — English even without a CAP `language` tag.
    const a = alert({ headline: "Heat warning", description: "Very hot", instruction: "Stay indoors" });
    (a as { identifier: string }).identifier = "kz-kazhydromet-en/2026/07/16/x.xml";
    listMock.mockResolvedValue([a]);
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 0, translated: 0, englishSource: 1, failed: 0 });
    expect(callOpenRouterMock).not.toHaveBeenCalled();
    expect(updateTranslationMock).toHaveBeenCalledWith(
      "a1",
      0,
      expect.objectContaining({ detectedLanguage: "en", translatedHeadline: "", translationHash: expect.any(String) }),
    );
  });

  it("skips the LLM for a CAP block that declares language=en", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    listMock.mockResolvedValue([
      alert({ language: "en-GB", headline: "Storm Warning", description: "Wind", instruction: "" }),
    ]);
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 0, englishSource: 1, failed: 0 });
    expect(callOpenRouterMock).not.toHaveBeenCalled();
    expect(updateTranslationMock).toHaveBeenCalledWith(
      "a1",
      0,
      expect.objectContaining({ detectedLanguage: "en" }),
    );
  });

  it("still LLM-translates a native-language WMO edition (-ru)", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const a = alert();
    (a as { identifier: string }).identifier = "ru-meteo-ru/2026/07/16/x.xml";
    listMock.mockResolvedValue([a]);
    callOpenRouterMock.mockResolvedValue({
      status: "ok",
      content: '{"language":"ru","headline":"Storm","description":"Wind","instruction":"Shelter"}',
      latencyMs: 10,
    });
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 1, translated: 1, englishSource: 0 });
    expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
  });

  it("counts a failed LLM call without writing back", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    listMock.mockResolvedValue([alert()]);
    callOpenRouterMock.mockResolvedValue({ status: "error", content: "", latencyMs: 10, error: "429 rate limited" });
    const res = await runAlertsTranslate();
    expect(res).toMatchObject({ candidates: 1, translated: 0, englishSource: 0, failed: 1 });
    expect(updateTranslationMock).not.toHaveBeenCalled();
  });

  it("counts a completion with no parseable JSON as a failure", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    listMock.mockResolvedValue([alert()]);
    callOpenRouterMock.mockResolvedValue({ status: "ok", content: "no idea", latencyMs: 10 });
    const res = await runAlertsTranslate();
    expect(res.failed).toBe(1);
    expect(updateTranslationMock).not.toHaveBeenCalled();
  });
});
