import { render } from "@testing-library/react";
import AlertTimelinePanel, { alertTimelineSlideHasContent } from "./AlertTimelinePanel";
import type { AlertTimelineBeat } from "@photonsurge/shared/alerts/timeline";

const beats: AlertTimelineBeat[] = [
  { at: "2026-07-12T14:00:00Z", type: "ISSUED", label: "Warning issued" },
  { at: "2026-07-12T14:17:00Z", type: "SEVERITY_CHANGED", label: "Severity raised to Severe", severityRank: 3 },
  { at: "2026-07-12T14:42:00Z", type: "AREA_CHANGED", label: "Area expanded to 18,900 km² (+52%)" },
];

describe("alertTimelineSlideHasContent", () => {
  it("is true only when there's more than a lone ISSUED beat", () => {
    expect(alertTimelineSlideHasContent(beats)).toBe(true);
    expect(alertTimelineSlideHasContent([beats[0]])).toBe(false);
    expect(alertTimelineSlideHasContent([])).toBe(false);
    expect(alertTimelineSlideHasContent(undefined)).toBe(false);
  });
});

describe("AlertTimelinePanel", () => {
  it("renders the change labels", () => {
    const { getByText, queryByText } = render(<AlertTimelinePanel beats={beats} />);
    expect(getByText("Severity raised to Severe")).toBeTruthy();
    expect(getByText("Area expanded to 18,900 km² (+52%)")).toBeTruthy();
    expect(queryByText("+1 earlier")).toBeNull(); // 3 beats fit under the row cap
  });

  it("renders nothing when there are no meaningful beats", () => {
    const { container } = render(<AlertTimelinePanel beats={[beats[0]]} />);
    expect(container.firstChild).toBeNull();
  });
});
