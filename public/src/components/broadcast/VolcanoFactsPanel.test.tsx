import { render, screen } from "@testing-library/react";
import VolcanoFactsPanel, { volcanoFactsSlideHasContent } from "./VolcanoFactsPanel";
import type { TrackInfo } from "@photonsurge/shared/director";

describe("volcanoFactsSlideHasContent", () => {
  it("is false with no gallery/facts/alert/reportFacts", () => {
    expect(volcanoFactsSlideHasContent({ label: "Etna" })).toBe(false);
    expect(volcanoFactsSlideHasContent(undefined)).toBe(false);
  });

  it("is true when any of gallery/facts/alert/reportFacts is present", () => {
    expect(volcanoFactsSlideHasContent({ facts: "stratovolcano" })).toBe(true);
    expect(volcanoFactsSlideHasContent({ gallery: ["a.jpg"] })).toBe(true);
    expect(volcanoFactsSlideHasContent({ alert: { colorCode: "ORANGE" } })).toBe(true);
    expect(volcanoFactsSlideHasContent({ reportFacts: "VEI 2" })).toBe(true);
  });
});

describe("VolcanoFactsPanel", () => {
  const info: TrackInfo = {
    label: "Etna",
    gallery: ["https://example.test/g1.jpg", "https://example.test/g2.jpg"],
    facts: "stratovolcano · 3,357 m · last known eruption 2021",
    alert: { level: "WATCH", colorCode: "ORANGE", synopsis: "Lava fountaining continues." },
    reportFacts: "VEI 2 · plume 3,000 m",
  };

  it("renders the gallery, facts line, USGS alert, and parsed report facts", () => {
    render(<VolcanoFactsPanel info={info} />);
    expect(screen.getByText(/stratovolcano · 3,357 m/)).toBeInTheDocument();
    expect(screen.getByText(/USGS ORANGE \/ WATCH/)).toBeInTheDocument();
    expect(screen.getByText("Lava fountaining continues.")).toBeInTheDocument();
    expect(screen.getByText("VEI 2 · plume 3,000 m")).toBeInTheDocument();
    expect(screen.getAllByAltText("")).toHaveLength(2);
  });

  it("renders nothing when the segment has no second-slide content", () => {
    const { container } = render(<VolcanoFactsPanel info={{ label: "Etna" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows up to 4 gallery photos, capping extras", () => {
    const many: TrackInfo = {
      label: "Etna",
      gallery: ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"],
    };
    render(<VolcanoFactsPanel info={many} />);
    expect(screen.getAllByAltText("")).toHaveLength(4);
  });
});
