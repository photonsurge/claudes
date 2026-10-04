import { DEFAULT_ROUNDUP_SETTINGS, sanitizeRoundupSettings } from "@photonsurge/shared/roundup-settings";
import { cachedRoundupSettings, resetRoundupSettingsCache, ROUNDUP_SETTINGS_TTL_MS } from "./roundupSettings";

const fake = (get: () => Promise<any>) => ({ roundupSettings: { get: jest.fn(get) } }) as any;

describe("cachedRoundupSettings", () => {
  beforeEach(() => resetRoundupSettingsCache());

  it("returns the stored settings and caches them for the TTL", async () => {
    const stored = sanitizeRoundupSettings({ "global-hourly": { hours: [0, 6, 12, 18] } });
    const db = fake(async () => stored);
    expect(await cachedRoundupSettings(db, 1_000)).toBe(stored);
    expect(await cachedRoundupSettings(db, 1_000 + ROUNDUP_SETTINGS_TTL_MS - 1)).toBe(stored);
    expect(db.roundupSettings.get).toHaveBeenCalledTimes(1);
    await cachedRoundupSettings(db, 1_000 + ROUNDUP_SETTINGS_TTL_MS);
    expect(db.roundupSettings.get).toHaveBeenCalledTimes(2);
  });

  it("falls back to the defaults when the read throws, and retries next call", async () => {
    const db = fake(async () => {
      throw new Error("mongo down");
    });
    expect(await cachedRoundupSettings(db, 1_000)).toEqual(DEFAULT_ROUNDUP_SETTINGS);
    await cachedRoundupSettings(db, 1_001);
    expect(db.roundupSettings.get).toHaveBeenCalledTimes(2); // failure not cached
  });

  it("falls back to the defaults when the facade has no roundupSettings", async () => {
    expect(await cachedRoundupSettings({} as any)).toEqual(DEFAULT_ROUNDUP_SETTINGS);
  });
});
