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

const FRAMES = [
  frame("global", [-180, -90, 180, 90]),
  frame("goes-east", [-150, -65, 10, 65]),
];

const feeds = (o: Record<string, SatImgFeedState>) => o;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (ls: any[]) => ls.map((l) => l.props.id);

describe("satimgLayers", () => {
  it("draws only feeds toggled ON", () => {
    const ls = satimgLayers(
      FRAMES,
      feeds({ global: { on: true, opacity: 0.8 }, "goes-east": { on: false, opacity: 0.9 } }),
    );
    expect(ids(ls)).toEqual(["satimg-global"]);
  });

  it("skips frames with no matching feed state", () => {
    const ls = satimgLayers([frame("mystery", [-10, -10, 10, 10])], feeds({}));
    expect(ls).toHaveLength(0);
  });

  it("applies each feed's own opacity + bounds, and paints (no depth test) so it can't diamond-cull", () => {
    const ls = satimgLayers(
      FRAMES,
      feeds({ global: { on: true, opacity: 0.5 }, "goes-east": { on: true, opacity: 0.9 } }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const east = ls.find((l: any) => l.props.id === "satimg-goes-east") as any;
    expect(east.props.opacity).toBe(0.9);
    expect(east.props.bounds).toEqual([-150, -65, 10, 65]);
    // The render fix: depth test OFF (avoids the coarse-quad diamond cull) + back-face cull.
    expect(east.props.parameters.depthTest).toBe(false);
    expect(east.props.parameters.cullMode).toBe("back");
  });

  it("cache-busts the image URL on a fresh bake (updatedAt in the query)", () => {
    const ls = satimgLayers([FRAMES[0]], feeds({ global: { on: true, opacity: 1 } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((ls[0] as any).props.image).toContain("v=2026-07-02T06%3A00%3A00Z");
  });
});
