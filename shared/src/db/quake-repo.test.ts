import type { Model } from "mongoose";
import { makeQuakeRepo } from "./quake-repo";
import type { iQuakeModel } from "./quake-model";
import { quakeLiveWindowSince, QUAKE_LIVE_WINDOW_MS } from "../seismic";

/** Minimal chainable `find()` stub — captures the filter the repo built. */
const stubModel = () => {
  const calls: { filter: any; hint?: string; limit?: number }[] = [];
  const chain = (filter: any) => {
    const rec: { filter: any; hint?: string; limit?: number } = { filter };
    calls.push(rec);
    const self: any = {
      sort: () => self,
      limit: (n: number) => {
        rec.limit = n;
        return self;
      },
      hint: (h: string) => {
        rec.hint = h;
        return self;
      },
      lean: () => self,
      exec: async () => [],
    };
    return self;
  };
  return { model: { find: chain } as unknown as Model<iQuakeModel>, calls };
};

describe("makeQuakeRepo.list", () => {
  it("omits the time filter entirely when no window is given (archive reads)", async () => {
    const { model, calls } = stubModel();
    await makeQuakeRepo(model).list();
    expect(calls[0].filter).toEqual({});
    expect(calls[0].limit).toBe(2000);
  });

  it("clips to sinceMs as a $gte on event time", async () => {
    const { model, calls } = stubModel();
    const since = Date.UTC(2026, 6, 1, 12, 0, 0);
    await makeQuakeRepo(model).list({ sinceMs: since });
    expect(calls[0].filter.time).toEqual({ $gte: new Date(since) });
  });

  it("combines the window with magnitude and bbox, keeping the geo hint", async () => {
    const { model, calls } = stubModel();
    const since = Date.UTC(2026, 6, 1, 12, 0, 0);
    await makeQuakeRepo(model).list({ minMag: 4.5, bbox: [-10, 40, 10, 60], sinceMs: since });
    expect(calls[0].filter.mag).toEqual({ $gte: 4.5 });
    expect(calls[0].filter.time).toEqual({ $gte: new Date(since) });
    expect(calls[0].filter.loc).toBeDefined();
    // The bbox read still forces its index — the time predicate rides as a
    // post-filter rather than replanning onto the time index.
    expect(calls[0].hint).toBe("quake_geo_ix");
  });

  it("sinceMs of 0 is honoured, not treated as absent", async () => {
    const { model, calls } = stubModel();
    await makeQuakeRepo(model).list({ sinceMs: 0 });
    expect(calls[0].filter.time).toEqual({ $gte: new Date(0) });
  });
});

describe("quakeLiveWindowSince", () => {
  it("is the live window behind the given instant", () => {
    const now = Date.UTC(2026, 6, 3, 0, 0, 0);
    expect(quakeLiveWindowSince(now)).toBe(now - QUAKE_LIVE_WINDOW_MS);
    // 48h, the window the globe overlay and the director both read.
    expect(QUAKE_LIVE_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });
});
