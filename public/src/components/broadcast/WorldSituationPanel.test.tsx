import { render, screen } from "@testing-library/react";
import WorldSituationPanel from "./WorldSituationPanel";
import type { WorldWatchState } from "../../lib/world-watch";

/** A watch state with data in every category so each column has something to
 *  show — the tests then assert which columns survive a channel's kindsOff. */
const watch = {
  alertTotal: 12,
  quakeCount: 7,
  volcanoCount: 3,
  maxQuake: null,
  bySeverity: [{ rank: 4, label: "Extreme", color: "#f00", count: 12 }],
  byMagClass: [{ cls: "major", label: "Major", color: "#fa0", count: 7 }],
  byVolcanoStatus: [{ status: "erupting", label: "Erupting", color: "#f70", count: 3 }],
  byContinent: [
    {
      continent: "Asia",
      alertCount: 12,
      bySeverity: [{ rank: 4, color: "#f00", count: 12 }],
      quakeCount: 7,
      byMagClass: [{ cls: "major", color: "#fa0", count: 7 }],
      volcanoCount: 3,
      byVolcanoStatus: [{ status: "erupting", color: "#f70", count: 3 }],
    },
  ],
  feed: [],
} as unknown as WorldWatchState;

describe("WorldSituationPanel per-channel columns", () => {
  it("shows all three columns by default", () => {
    render(<WorldSituationPanel worldWatch={watch} />);
    // Each label appears twice — hero tile + continent-graph legend.
    expect(screen.getAllByText("ALERTS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SEISMIC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VOLCANIC").length).toBeGreaterThan(0);
    expect(screen.getByText("Extreme")).toBeInTheDocument();
  });

  it("drops the whole ALERTS column (tile, chips, legend) on a geo channel", () => {
    render(<WorldSituationPanel worldWatch={watch} kindsOff={["alert"]} />);
    expect(screen.queryByText("ALERTS")).not.toBeInTheDocument();
    expect(screen.queryByText("Extreme")).not.toBeInTheDocument();
    expect(screen.getAllByText("SEISMIC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VOLCANIC").length).toBeGreaterThan(0);
  });

  it("keeps only ALERTS on a weather channel", () => {
    render(<WorldSituationPanel worldWatch={watch} kindsOff={["quake", "volcano"]} />);
    expect(screen.getAllByText("ALERTS").length).toBeGreaterThan(0);
    expect(screen.queryByText("SEISMIC")).not.toBeInTheDocument();
    expect(screen.queryByText("VOLCANIC")).not.toBeInTheDocument();
    expect(screen.queryByText("Major")).not.toBeInTheDocument();
    expect(screen.queryByText("Erupting")).not.toBeInTheDocument();
  });

  it("still renders the card shell and feed with every kind off", () => {
    render(<WorldSituationPanel worldWatch={watch} kindsOff={["alert", "quake", "volcano"]} />);
    expect(screen.getByText("DETECTION GRID")).toBeInTheDocument();
    expect(screen.queryByText("ALERTS")).not.toBeInTheDocument();
    expect(screen.getByText("ACTIVE FEED")).toBeInTheDocument();
  });
});
