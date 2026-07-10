import { render, screen } from "@testing-library/react";
import AreaAlertsPanel, { distinctAlerts } from "./AreaAlertsPanel";
import type { AlertFeature } from "../../lib/alerts";

const alert = (over: Partial<AlertFeature["properties"]> = {}): AlertFeature =>
  ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      id: "a",
      source: "nws",
      identifier: "x",
      event: "Gale Warning",
      severityRank: 2,
      hazard: "wind",
      areaDesc: "Coast",
      ...over,
    },
  }) as unknown as AlertFeature;

describe("distinctAlerts", () => {
  it("de-dupes by area+hazard keeping the most severe, and sorts severity-first", () => {
    const list = [
      alert({ id: "1", areaDesc: "Coast", hazard: "wind", severityRank: 1 }),
      alert({ id: "2", areaDesc: "Coast", hazard: "wind", severityRank: 3 }), // same bucket, higher sev → wins
      alert({ id: "3", areaDesc: "Inland", hazard: "flood", severityRank: 2 }),
    ];
    const out = distinctAlerts(list);
    expect(out.map((a) => a.properties.id)).toEqual(["2", "3"]); // 2 (sev3) before 3 (sev2), dupe dropped
  });
});

describe("AreaAlertsPanel", () => {
  it("renders nothing when there are no alerts", () => {
    const { container } = render(<AreaAlertsPanel alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists distinct alerts with the count and a +N more overflow line", () => {
    const alerts = Array.from({ length: 8 }, (_, i) =>
      alert({ id: `a${i}`, areaDesc: `Zone ${i}`, event: `Warning ${i}` }),
    );
    render(<AreaAlertsPanel alerts={alerts} />);
    expect(screen.getByText("8")).toBeInTheDocument(); // header count
    expect(screen.getByText("Warning 0")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument(); // 8 - 6 shown
  });
});
