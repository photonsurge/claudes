/**
 * The Wikipedia search terms the enrich job tries, and how an operator's
 * `searchOverride` (set on /admin/volcanoes/:id) steers them.
 */
import { titleCandidates } from "./volcanoes";

jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
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
