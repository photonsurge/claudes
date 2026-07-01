import { ingestCamSource } from "./ingest";
import type { CamSource, Cam } from "@photonsurge/shared/cams/types";
import type { AppDb } from "@photonsurge/shared/db/index";

const cam = (camId: string): Cam => ({
  camId,
  provider: "tfl",
  title: camId,
  lat: 51,
  lng: 0,
  status: "active",
});

describe("ingestCamSource", () => {
  it("fetches a catalogue and upserts it, returning the counts", async () => {
    const cams = [cam("tfl:a"), cam("tfl:b")];
    let received: Cam[] | undefined;

    const source: CamSource = {
      id: "tfl",
      provider: "tfl",
      region: "test",
      pollIntervalSec: 600,
      enabled: true,
      fetchCatalogue: async () => cams,
    };

    const db = {
      cams: {
        upsertMany: async (input: Cam[]) => {
          received = input;
          return { upserted: 2, matched: 0 };
        },
      },
    } as unknown as AppDb;

    const result = await ingestCamSource(source, db);
    expect(received).toEqual(cams);
    expect(result).toEqual({ source: "tfl", count: 2, upserted: 2, matched: 0 });
  });

  it("propagates a source fetch failure to the caller", async () => {
    const source: CamSource = {
      id: "windy",
      provider: "windy",
      region: "test",
      pollIntervalSec: 600,
      enabled: true,
      fetchCatalogue: async () => {
        throw new Error("429 rate limited");
      },
    };
    const db = { cams: { upsertMany: async () => ({ upserted: 0, matched: 0 }) } } as unknown as AppDb;
    await expect(ingestCamSource(source, db)).rejects.toThrow("429 rate limited");
  });
});
