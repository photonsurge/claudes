/**
 * PlaceRoundupPanel's round-up depth: a scripted short timed for the summary
 * alone (Segment.roundupDepth "summary") must show only the summary — not the
 * state of play, tally, city outlooks or advice it wasn't timed to read.
 */
import { render, screen } from "@testing-library/react";
import PlaceRoundupPanel, { placeRoundupSummaryText } from "./PlaceRoundupPanel";
import type { PlaceRoundup } from "../../lib/placeRoundups";

const roundup = {
  summary: "Unsettled across the region.",
  stateOfPlay: "Rain bands moving east.",
  cityOutlook: [{ name: "Berlin", outlook: "Showers easing overnight." }],
  advice: "Take an umbrella.",
  inputs: { topCities: [], alerts: [{ id: "a" }], volcanoes: [] },
} as unknown as PlaceRoundup;

it("shows everything at full depth (the default)", () => {
  render(<PlaceRoundupPanel roundup={roundup} />);
  expect(screen.getByText("Unsettled across the region.")).toBeInTheDocument();
  expect(screen.getByText("Rain bands moving east.")).toBeInTheDocument();
  expect(screen.getByText("Take an umbrella.")).toBeInTheDocument();
  expect(screen.getByText("Berlin")).toBeInTheDocument();
});

it("shows only the summary at summary depth", () => {
  render(<PlaceRoundupPanel roundup={roundup} depth="summary" />);
  expect(screen.getByText("Unsettled across the region.")).toBeInTheDocument();
  expect(screen.queryByText("Rain bands moving east.")).toBeNull();
  expect(screen.queryByText("Take an umbrella.")).toBeNull();
  expect(screen.queryByText("Berlin")).toBeNull();
  expect(screen.queryByText("ACTIVE ALERTS")).toBeNull();
});

it("renders nothing at summary depth on the 24h page or without a summary", () => {
  const { container } = render(<PlaceRoundupPanel roundup={roundup} depth="summary" section="next24" />);
  expect(container).toBeEmptyDOMElement();
  const none = { ...roundup, summary: "" } as PlaceRoundup;
  const { container: c2 } = render(<PlaceRoundupPanel roundup={none} depth="summary" />);
  expect(c2).toBeEmptyDOMElement();
});

it("placeRoundupSummaryText falls back to an older round-up's narrative only", () => {
  expect(placeRoundupSummaryText({ narrative: " Old prose ", inputs: {} } as unknown as PlaceRoundup)).toBe("Old prose");
  expect(placeRoundupSummaryText({ stateOfPlay: "x", narrative: "y", inputs: {} } as unknown as PlaceRoundup)).toBe("");
  expect(placeRoundupSummaryText(null)).toBe("");
});
