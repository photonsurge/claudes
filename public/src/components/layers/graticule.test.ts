import { graticuleLayer } from "./graticule";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (layers: any[]) => layers.map((l) => l.props.id);

describe("graticuleLayer", () => {
  it("draws the line layer, plus a label layer only when labels are on", () => {
    expect(ids(graticuleLayer("#7dd3fc", false))).toEqual(["graticule-lines"]);
    expect(ids(graticuleLayer("#7dd3fc", true))).toEqual(["graticule-lines", "graticule-labels"]);
  });

  it("covers the named parallels and the key meridians", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (graticuleLayer("#7dd3fc", true)[1] as any).props.data.map((d: any) => d.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Equator",
        "Tropic of Cancer",
        "Tropic of Capricorn",
        "Arctic Circle",
        "Antarctic Circle",
        "Prime Meridian",
      ]),
    );
  });

  it("tints every line with the operator's colour", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = graticuleLayer("#ff8800", false)[0] as any;
    const equator = lines.props.data.find((d: any) => d.label === "Equator");
    // getColor returns [r,g,b,alpha] for a datum; the rgb is the chosen colour.
    expect(lines.props.getColor(equator).slice(0, 3)).toEqual([255, 136, 0]);
  });

  it("floats the lines above the surface so they don't z-fight the basemap", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = graticuleLayer("#7dd3fc", false)[0] as any;
    const equator = lines.props.data.find((d: any) => d.label === "Equator");
    // Every vertex carries a positive altitude (the third coordinate).
    expect(equator.path.every((p: number[]) => p[2] > 0)).toBe(true);
    expect(lines.props.parameters.depthTest).toBe(true);
  });
});
