import { render } from "@testing-library/react";
import EventTimelinePanel, { eventTimelineSlideHasContent } from "./EventTimelinePanel";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";

const beats: EventTimelineBeat[] = [
  { at: "2026-07-12T14:00:00Z", type: "ISSUED", label: "Warning issued" },
  { at: "2026-07-12T14:17:00Z", type: "IMPACT_UPDATE", label: "GDACS alert level Red", source: "gdacs" },
  { at: "2026-07-12T17:44:00Z", type: "PRODUCT_ADDED", label: "First Copernicus mapping product", source: "copernicus" },
];

describe("eventTimelineSlideHasContent", () => {
  it("is true only when there's more than a lone opening beat", () => {
    expect(eventTimelineSlideHasContent(beats)).toBe(true);
    expect(eventTimelineSlideHasContent([beats[0]])).toBe(false);
    expect(eventTimelineSlideHasContent(undefined)).toBe(false);
  });
});

describe("EventTimelinePanel", () => {
  it("renders cross-source beat labels with their source tags", () => {
    const { getByText } = render(<EventTimelinePanel beats={beats} />);
    expect(getByText("GDACS alert level Red")).toBeTruthy();
    expect(getByText("First Copernicus mapping product")).toBeTruthy();
    expect(getByText("copernicus")).toBeTruthy();
  });

  it("renders nothing when there's only an opening beat", () => {
    const { container } = render(<EventTimelinePanel beats={[beats[0]]} />);
    expect(container.firstChild).toBeNull();
  });
});
