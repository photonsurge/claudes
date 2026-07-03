import { shiftDate, fetchGibs, GIBS_TRUECOLOR_LAYERS } from "./gibs";

describe("shiftDate", () => {
  it("shifts UTC days and rolls over month boundaries", () => {
    expect(shiftDate("2026-07-03", -1)).toBe("2026-07-02");
    expect(shiftDate("2026-07-01", -1)).toBe("2026-06-30");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

/** Minimal Response stand-in for the injected fetch. */
function fakeRes(bytes: number, ct = "image/png", ok = true) {
  return {
    ok,
    headers: { get: () => ct },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

describe("fetchGibs", () => {
  it("requests the true-color layer stack + date and returns a real image", async () => {
    const urls: string[] = [];
    const res = await fetchGibs({
      date: "2026-07-03",
      fetchImpl: (async (u: string) => {
        urls.push(u);
        return fakeRes(120_000); // a real multi-KB mosaic
      }) as unknown as typeof fetch,
    });
    expect(res.date).toBe("2026-07-03");
    expect(res.bounds).toEqual([-180, -90, 180, 90]);
    expect(res.png.length).toBe(120_000);
    expect(urls[0]).toContain("TIME=2026-07-03");
    expect(urls[0]).toContain(encodeURIComponent(GIBS_TRUECOLOR_LAYERS.join(",")));
  });

  it("walks back a day when the newest is unpublished (empty body)", async () => {
    const res = await fetchGibs({
      date: "2026-07-03",
      fetchImpl: (async (u: string) => {
        // Newest day not ready → tiny body; the day before is full.
        return u.includes("TIME=2026-07-03") ? fakeRes(2_000) : fakeRes(200_000);
      }) as unknown as typeof fetch,
    });
    expect(res.date).toBe("2026-07-02");
  });

  it("throws when nothing is available within lookback", async () => {
    await expect(
      fetchGibs({
        date: "2026-07-03",
        lookbackDays: 1,
        fetchImpl: (async () => fakeRes(1_000)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/GIBS fetch failed/);
  });
});
