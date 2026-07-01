import { tracksLayer } from "./tracks";
import type { Track } from "../../lib/tracks/types";

const aircraft: Track = {
  id: "ac:ABC123",
  kind: "aircraft",
  code: "ABC123",
  name: "BAW123",
  position: [0, 51],
  heading: 90,
  speedMS: 220,
  altM: 11000,
};
const ship: Track = {
  id: "ship:232000001",
  kind: "ship",
  code: "232000001",
  name: "Boaty",
  position: [1, 50],
  heading: 90,
  sogKn: 18,
};

const ids = (layers: { props: { id: string } }[]) => layers.map((l) => l.props.id);

describe("tracksLayer highlight", () => {
  it("adds a glow + ring locator for the on-air aircraft (case-insensitive code)", () => {
    const layers = tracksLayer([aircraft, ship], { highlight: { kind: "aircraft", code: "abc123" } });
    expect(ids(layers)).toEqual(expect.arrayContaining(["live-tracks-highlight-glow", "live-tracks-highlight-ring"]));
    // The ring layer carries just the one matched track.
    const ring = layers.find((l) => l.props.id === "live-tracks-highlight-ring")!;
    expect((ring.props as { data: Track[] }).data).toEqual([aircraft]);
  });

  it("spotlights a ship by MMSI", () => {
    const layers = tracksLayer([aircraft, ship], { highlight: { kind: "ship", code: "232000001" } });
    const ring = layers.find((l) => l.props.id === "live-tracks-highlight-ring")!;
    expect((ring.props as { data: Track[] }).data).toEqual([ship]);
  });

  it("adds no locator without a highlight, or when the code matches nothing", () => {
    expect(ids(tracksLayer([aircraft, ship]))).not.toContain("live-tracks-highlight-ring");
    const layers = tracksLayer([aircraft, ship], { highlight: { kind: "aircraft", code: "nope" } });
    expect(ids(layers)).not.toContain("live-tracks-highlight-ring");
  });

  it("does not spotlight a target hidden by its own display filter", () => {
    // A min-speed filter drops the ship, so it can't be ringed either.
    const layers = tracksLayer([aircraft, ship], {
      shipStyle: { color: "kind", icon: "glyph", minSpeed: 99 },
      highlight: { kind: "ship", code: "232000001" },
    });
    expect(ids(layers)).not.toContain("live-tracks-highlight-ring");
  });
});
