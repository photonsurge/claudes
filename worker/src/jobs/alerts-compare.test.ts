/**
 * `snapshotCompare` used to re-render and re-store the SAME side-by-side every
 * hour, for every alert. Its two inputs barely move — GIBS daily products
 * refresh once a day, and the earliest satellite still never moved at all
 * because nothing pruned it — so the hourly sweep wrote a byte-identical image
 * ~24 times a day per alert. That was the bulk of the 74 GB in
 * `${BLOB_DIR}/alert-snapshot` (docs/blob-retention-plan.md §2A).
 *
 * These tests pin the fix: a compare is stored once per (earliest, latest) PAIR.
 */
const mockList = jest.fn();
const mockListForAlert = jest.fn();
const mockGetPng = jest.fn();
const mockPut = jest.fn();
const mockSideBySide = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    alerts: { list: (...a: unknown[]) => mockList(...a) },
    alertSnapshots: {
      listForAlert: (...a: unknown[]) => mockListForAlert(...a),
      getPng: (...a: unknown[]) => mockGetPng(...a),
      put: (...a: unknown[]) => mockPut(...a),
    },
  }),
}));
jest.mock("../satimg/compare", () => ({ sideBySide: (...a: unknown[]) => mockSideBySide(...a) }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("sharp", () => ({}));

import { snapshotCompare } from "./alerts";

const job = { id: "t", data: { data: {} } } as never;

/** Newest-first, the order `listForAlert` returns. */
const snap = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  layer: kind === "satellite" ? "truecolor" : "satellite",
  observationTime: "2026-09-09T00:00:00.000Z",
  capturedAt: "2026-09-09T00:00:00.000Z",
  ...extra,
});

describe("alerts.snapshotCompare pair dedup", () => {
  beforeEach(() => {
    mockList.mockReset().mockResolvedValue([{ id: "a1", source: "wmo", identifier: "i1" }]);
    mockListForAlert.mockReset();
    mockGetPng.mockReset().mockResolvedValue({ data: Buffer.from("x"), contentType: "image/png" });
    mockPut.mockReset().mockResolvedValue({ id: "new" });
    mockSideBySide.mockReset().mockResolvedValue({ png: Buffer.from("cmp"), width: 20, height: 10 });
  });

  it("stores a compare for a pair it has not seen, stamped with the pair key", async () => {
    mockListForAlert.mockResolvedValue([snap("late", "satellite"), snap("early", "satellite")]);

    const res = await snapshotCompare(job);

    expect(mockSideBySide).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut.mock.calls[0][0]).toMatchObject({ kind: "compare", pairKey: "early:late" });
    expect(res).toMatchObject({ stored: 1, unchanged: 0 });
  });

  it("renders nothing when a compare for that exact pair is already stored", async () => {
    mockListForAlert.mockResolvedValue([
      snap("cmp", "compare", { pairKey: "early:late" }),
      snap("late", "satellite"),
      snap("early", "satellite"),
    ]);

    const res = await snapshotCompare(job);

    expect(mockSideBySide).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockGetPng).not.toHaveBeenCalled(); // never even reads the bytes back
    expect(res).toMatchObject({ stored: 0, unchanged: 1 });
  });

  it("stores again once a newer satellite frame moves the pair", async () => {
    mockListForAlert.mockResolvedValue([
      snap("newest", "satellite"),
      snap("cmp", "compare", { pairKey: "early:late" }),
      snap("late", "satellite"),
      snap("early", "satellite"),
    ]);

    const res = await snapshotCompare(job);

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut.mock.calls[0][0]).toMatchObject({ pairKey: "early:newest" });
    expect(res).toMatchObject({ stored: 1, unchanged: 0 });
  });

  it("skips an alert with only one satellite still (nothing to compare)", async () => {
    mockListForAlert.mockResolvedValue([snap("only", "satellite")]);

    const res = await snapshotCompare(job);

    expect(mockPut).not.toHaveBeenCalled();
    expect(res).toMatchObject({ stored: 0, skipped: 1 });
  });
});
