import { satimgLayers } from "./satimg";
import type { SatImgMeta, SatImgFeedState } from "@photonsurge/shared/satimg/types";

const frame = (satId: string, bounds: [number, number, number, number]): SatImgMeta => ({
  satId,
  satName: satId,
  subLon: 0,
  composite: satId,
  observationTime: "2026-07-02T00:00:00Z",
  bounds,
  width: 100,
  height: 100,
  updatedAt: "2026-07-02T06:00:00Z",
});

const GLOBE: [number, number, number, number] = [-180, -90, 180, 90];
const GOES_E: [number, number, number, number] = [-150, -65, 10, 65];
const LIGHT: [number, number, number, number] = [-65, -65, 65, 65];

// The worker bakes the mosaic + lightning under their feed id, and each disc under
// `${disc}:${look}` (here goes-east has geocolor + ir).
const FRAMES = [
  frame("global", GLOBE),
  frame("goes-east:geocolor", GOES_E),
  frame("goes-east:ir", GOES_E),
  frame("lightning", LIGHT),
];

const feeds = (o: Record<string, SatImgFeedState>) => o;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (ls: any[]) => ls.map((l) => l.props.id);

describe("satimgLayers", () => {
  it("draws only feeds toggled ON (mosaic + disc under its own look)", () => {
    const ls = satimgLayers(
      FRAMES,
      feeds({ global: { on: true, opacity: 0.8 }, "goes-east": { on: true, opacity: 0.9, look: "geocolor" } }),
    );
    expect(ids(ls).sort()).toEqual(["satimg-global", "satimg-goes-east"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const east = ls.find((l: any) => l.props.id === "satimg-goes-east") as any;
    // The disc resolves to the `${id}:${look}` frame + its bounds/opacity.
    expect(east.props.image).toContain("sat=goes-east%3Ageocolor");
    expect(east.props.opacity).toBe(0.9);
    expect(east.props.bounds).toEqual(GOES_E);
  });

  it("each disc uses ITS OWN look (per-satellite, not global)", () => {
    // Two discs, different looks — proves the look is read per-feed.
    const FR = [
      frame("goes-east:geocolor", GOES_E),
      frame("goes-east:ir", GOES_E),
      frame("goes-west:ir", GOES_E),
      frame("goes-west:dust", GOES_E),
    ];
    const ls = satimgLayers(
      FR,
      feeds({
        "goes-east": { on: true, opacity: 1, look: "geocolor" },
        "goes-west": { on: true, opacity: 1, look: "dust" },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const east = ls.find((l: any) => l.props.id === "satimg-goes-east") as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const west = ls.find((l: any) => l.props.id === "satimg-goes-west") as any;
    expect(east.props.image).toContain("sat=goes-east%3Ageocolor");
    expect(west.props.image).toContain("sat=goes-west%3Adust");
  });

  it("falls back to the disc's IR frame when it doesn't carry its chosen look", () => {
    // goes-east has no `dust` frame here → uses goes-east:ir.
    const ls = satimgLayers(FRAMES, feeds({ "goes-east": { on: true, opacity: 1, look: "dust" } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((ls[0] as any).props.image).toContain("sat=goes-east%3Air");
  });

  it("skips a disc with no baked frame at all, and any off feed", () => {
    const ls = satimgLayers(
      [frame("goes-west:ir", GOES_E)],
      feeds({ "goes-east": { on: true, opacity: 1, look: "geocolor" }, global: { on: false, opacity: 1 } }),
    );
    expect(ls).toHaveLength(0);
  });

  it("draws the lightning overlay by its own id (not look-dependent) and paints (no depth test)", () => {
    const ls = satimgLayers(FRAMES, feeds({ lightning: { on: true, opacity: 0.95 } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lx = ls.find((l: any) => l.props.id === "satimg-lightning") as any;
    expect(lx.props.image).toContain("sat=lightning");
    expect(lx.props.parameters.depthTest).toBe(false);
    expect(lx.props.parameters.cullMode).toBe("back");
  });
});
