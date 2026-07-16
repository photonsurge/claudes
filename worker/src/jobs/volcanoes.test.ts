/**
 * The Wikipedia search terms the enrich job tries, and how an operator's
 * `searchOverride` (set on /admin/volcanoes/:id) steers them — plus the
 * first-seen hook that is the ONLY automatic trigger for volcano enrichment.
 */
import { titleCandidates, snapshot } from "./volcanoes";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchVolcanoes } from "@photonsurge/shared/volcanoes/gvp";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";

jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("@photonsurge/shared/volcanoes/gvp", () => ({ fetchVolcanoes: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({
  sendToQueue: jest.fn(),
  QUEUE_PRIORITY: { LOW: 10 },
}));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

describe("titleCandidates", () => {
  it("tries the bare name first", () => {
    expect(titleCandidates("Etna")).toEqual(["Etna"]);
  });

  it("drops a trailing place qualifier and a Volcano/Complex suffix", () => {
    expect(titleCandidates("Villarrica, Chile")).toEqual(["Villarrica, Chile", "Villarrica"]);
    expect(titleCandidates("Ubinas Volcanic Complex")).toEqual(["Ubinas Volcanic Complex", "Ubinas"]);
  });

  it("uses an override INSTEAD of the derived guesses, not alongside them", () => {
    // The whole point: the derived guesses find the wrong article, so falling
    // back to them would re-fetch exactly what the operator was correcting.
    expect(titleCandidates("Fuego", "Volcán de Fuego")).toEqual(["Volcán de Fuego"]);
  });

  it("trims the override and ignores a blank one", () => {
    expect(titleCandidates("Fuego", "  Volcán de Fuego  ")).toEqual(["Volcán de Fuego"]);
    expect(titleCandidates("Fuego", "   ")).toEqual(["Fuego"]);
    expect(titleCandidates("Fuego", undefined)).toEqual(["Fuego"]);
  });
});

describe("snapshot — first-seen enrichment hook", () => {
  const bulletin = (...ids: string[]) => ids.map((id) => ({ id, name: `V-${id}`, lat: 0, lng: 0 }));

  const mockDb = (knownIds: string[]) => ({
    volcanoes: {
      listByIds: jest.fn().mockResolvedValue(knownIds.map((id) => ({ id, name: `V-${id}` }))),
      upsertMany: jest.fn().mockResolvedValue({ upserted: 0, matched: knownIds.length }),
    },
  });

  beforeEach(() => jest.clearAllMocks());

  it("queues enrichWiki for ONLY the volcanoes it has never seen before", async () => {
    (getAppDb as jest.Mock).mockResolvedValue(mockDb(["etna", "fuego"]));
    (fetchVolcanoes as jest.Mock).mockResolvedValue({ volcanoes: bulletin("etna", "fuego", "taal") });

    const result = await snapshot({} as never);

    expect(sendToQueue).toHaveBeenCalledTimes(1);
    expect(sendToQueue).toHaveBeenCalledWith(
      "volcanoes",
      "volcanoes",
      "enrichWiki",
      { ids: ["taal"] }, // etna/fuego already known — not re-enriched
      undefined,
      QUEUE_PRIORITY.LOW,
    );
    expect(result.firstSeen).toBe(1);
  });

  it("queues NOTHING when the bulletin holds no new volcanoes", async () => {
    // The common case: the weekly report republishes the same volcanoes. This is
    // what keeps the hook from degenerating into a recurring catalog sweep — the
    // exact thing enrichment is not allowed to be.
    (getAppDb as jest.Mock).mockResolvedValue(mockDb(["etna", "fuego"]));
    (fetchVolcanoes as jest.Mock).mockResolvedValue({ volcanoes: bulletin("etna", "fuego") });

    const result = await snapshot({} as never);

    expect(sendToQueue).not.toHaveBeenCalled();
    expect(result.firstSeen).toBe(0);
  });

  it("treats an empty cache as all-new (first ever run)", async () => {
    (getAppDb as jest.Mock).mockResolvedValue(mockDb([]));
    (fetchVolcanoes as jest.Mock).mockResolvedValue({ volcanoes: bulletin("etna", "taal") });

    await snapshot({} as never);

    expect(sendToQueue).toHaveBeenCalledWith(
      "volcanoes",
      "volcanoes",
      "enrichWiki",
      { ids: ["etna", "taal"] },
      undefined,
      QUEUE_PRIORITY.LOW,
    );
  });
});
