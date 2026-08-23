import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import { EventTrackingLabel, trackingBlockHeight } from "./EventOverlay";

/** Minimal targeted-event segment for the readout block. */
const quake: Segment = {
  id: "quake:us7000test",
  kind: "quake",
  title: "M5.3 Mid-Atlantic Ridge",
  subtitle: "southern Mid-Atlantic Ridge",
  details: [
    { label: "Magnitude", value: "M5.3 · Moderate" },
    { label: "Depth", value: "10 km · Shallow" },
  ],
  camera: { center: [-13.9, -8.2], zoom: 4 },
  patch: {},
  holdMs: 60_000,
} as Segment;

describe("EventTrackingLabel (deck-embedded tracking readout)", () => {
  it("renders the overlay eyebrow, ACTIVE tag and the segment's detail rows", () => {
    render(<EventTrackingLabel segment={quake} />);
    expect(screen.getByText(/EVENT DETECTION OVERLAY/)).toBeInTheDocument();
    expect(screen.getByText("[ACTIVE]")).toBeInTheDocument();
    expect(screen.getByText("MAGNITUDE")).toBeInTheDocument();
    expect(screen.getByText("M5.3 · Moderate")).toBeInTheDocument();
    expect(screen.getByText("DEPTH")).toBeInTheDocument();
    // The deck card's title bar right above already names the event — the
    // embedded block must NOT repeat the title as a row.
    expect(screen.queryByText("M5.3 MID-ATLANTIC RIDGE")).not.toBeInTheDocument();
  });

  it("tags a future-onset alert (a 'Begins in' row) as UPCOMING", () => {
    const pending = { ...quake, details: [{ label: "Begins in", value: "2h 10m" }] };
    render(<EventTrackingLabel segment={pending} />);
    expect(screen.getByText("[UPCOMING]")).toBeInTheDocument();
    expect(screen.queryByText("[ACTIVE]")).not.toBeInTheDocument();
  });

  it("appends extraDetails after the segment's own rows", () => {
    render(
      <EventTrackingLabel
        segment={quake}
        extraDetails={[{ label: "Nearest City", value: "Jamestown · 1,200 km" }]}
      />,
    );
    expect(screen.getByText("NEAREST CITY")).toBeInTheDocument();
    expect(screen.getByText("Jamestown · 1,200 km")).toBeInTheDocument();
  });

  it("place variant reads NOW VIEWING with a flagged LOCATION row and no status tag", () => {
    const stop = { ...quake, kind: "region" as const, title: "Sapporo", details: [] };
    render(<EventTrackingLabel segment={stop} variant="place" flag="🇯🇵" />);
    expect(screen.getByText(/NOW VIEWING/)).toBeInTheDocument();
    expect(screen.getByText("LOCATION")).toBeInTheDocument();
    expect(screen.getByText("🇯🇵 SAPPORO")).toBeInTheDocument();
    expect(screen.queryByText("[ACTIVE]")).not.toBeInTheDocument();
  });

  it("trackingBlockHeight grows with the row count", () => {
    expect(trackingBlockHeight(5)).toBeGreaterThan(trackingBlockHeight(2));
  });
});
