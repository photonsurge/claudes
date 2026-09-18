/**
 * The elevation relief bake is the ONE static texture nothing ever re-bakes on a
 * schedule, so "reuse the published run" has to be right: reuse a run whose
 * texture still reads, and re-bake one whose bytes have gone (a moved/cleared
 * BLOB_DIR, a half-finished migrate:blobs). Getting that wrong left the Relief
 * basemap blank on air with a button that did nothing.
 */
// geotiff is ESM-only and this suite never reads a DEM — stub it so ts-jest (CJS)
// can load the module under test.
jest.mock("geotiff", () => ({ fromFile: jest.fn() }));

import { reusableElevationRun, type ElevationReuseDb } from "./elevation";

const runDoc = (texId: string | null) => ({
  id: "run-1",
  grid: { width: 2160, height: 1080 },
  variables: texId ? { elevation: { files: { "0": texId } } } : { elevation: { files: {} } },
});

const makeDb = (
  run: unknown,
  bytes: Record<string, Buffer | null>,
): ElevationReuseDb => ({
  weatherRuns: { getByQuery: async () => ({ success: !!run, data: run ?? undefined }) },
  weatherTextures: {
    getBytes: async (id: string) => {
      const b = bytes[id];
      return b ? { data: b } : null;
    },
  },
});

describe("reusableElevationRun", () => {
  it("reuses a published run whose fhr-0 texture still reads back", async () => {
    const db = makeDb(runDoc("tex-1"), { "tex-1": Buffer.from([1, 2, 3]) });
    await expect(reusableElevationRun(db)).resolves.toEqual({
      runId: "run-1",
      width: 2160,
      height: 1080,
    });
  });

  it("re-bakes when the texture bytes are gone (doc outlived its blob)", async () => {
    const db = makeDb(runDoc("tex-1"), { "tex-1": null });
    await expect(reusableElevationRun(db)).resolves.toBeNull();
  });

  it("re-bakes when the published run carries no texture id at all", async () => {
    const db = makeDb(runDoc(null), {});
    await expect(reusableElevationRun(db)).resolves.toBeNull();
  });

  it("re-bakes when a texture doc exists but is empty", async () => {
    const db = makeDb(runDoc("tex-1"), { "tex-1": Buffer.alloc(0) });
    await expect(reusableElevationRun(db)).resolves.toBeNull();
  });

  it("re-bakes when there is no published elevation run", async () => {
    await expect(reusableElevationRun(makeDb(null, {}))).resolves.toBeNull();
  });

  it("re-bakes rather than throwing when the blob store errors", async () => {
    const db: ElevationReuseDb = {
      weatherRuns: { getByQuery: async () => ({ success: true, data: runDoc("tex-1") }) },
      weatherTextures: {
        getBytes: async () => {
          throw new Error("EIO: blob store unreachable");
        },
      },
    };
    await expect(reusableElevationRun(db)).resolves.toBeNull();
  });
});
