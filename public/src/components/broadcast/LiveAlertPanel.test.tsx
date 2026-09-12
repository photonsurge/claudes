import { act, render, screen } from "@testing-library/react";
import type { AlertFeature } from "../../lib/alerts";
import type { AlertSlotAd } from "@photonsurge/shared/ads/alert-slot";
import LiveAlertPanel from "./LiveAlertPanel";

const sponsor = (adId: string, advertiser = "Acme"): AlertSlotAd => ({
  adId, title: `${adId} spot`, advertiser, mediaUrl: `/api/ads/${adId}/media?v=1`,
});

const warning = (id: string, area: string, extra: Record<string, unknown> = {}): AlertFeature => ({
  type: "Feature", geometry: { type: "Point", coordinates: [0, 0] },
  properties: { id, source: "test", identifier: id, event: "Thunderstorms",
    hazard: "thunderstorm", severityRank: 2, areaDesc: area, sent: new Date().toISOString(),
    instruction: "Take extra care in exposed areas.",
    ...extra,
  },
} as AlertFeature);

it("separates location, severity, timing and official advice", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte")]} />);
  expect(screen.getByText("Reutte")).toBeInTheDocument();
  expect(screen.getByLabelText(/Severity:/)).toBeInTheDocument();
  expect(screen.getByText(/Issued /)).toBeInTheDocument();
  expect(screen.getByText("OFFICIAL ADVICE")).toBeInTheDocument();
  expect(screen.getByText("Take extra care in exposed areas.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "New weather alert" })).toHaveStyle({ backgroundColor: "#081420" });
});

it("scrolls long advice through a three-line window instead of clamping it to an ellipsis", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte")]} />);
  const text = screen.getByText("Take extra care in exposed areas.");
  expect(text).not.toHaveStyle({ display: "-webkit-box" });
  // The AutoScroll window: capped at 3 lines (12px × 1.4, whole px) and clipping — never growing the card.
  const win = text.closest<HTMLElement>("[style*='max-height']");
  expect(win).not.toBeNull();
  expect(win).toHaveStyle({ maxHeight: "50px", overflow: "hidden" });
});

it("gives viewers ten seconds to read each warning", () => {
  jest.useFakeTimers();
  const { unmount } = render(<LiveAlertPanel alerts={[warning("a", "Reutte"), warning("b", "Tyrol")]} />);
  expect(screen.getByText("Alert 1 of 2")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(5000); });
  expect(screen.getByText("Alert 1 of 2")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(5000); });
  expect(screen.getByText("Alert 2 of 2")).toBeInTheDocument();
  unmount();
  jest.useRealTimers();
});

it("drops the advice section rather than holding empty space open", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte", { instruction: undefined })]} />);
  expect(screen.queryByText("OFFICIAL ADVICE")).not.toBeInTheDocument();
  expect(screen.queryByText("DETAILS")).not.toBeInTheDocument();
  // The card sizes to its content, so nothing pins a fixed height any more.
  expect(screen.getByRole("region", { name: "New weather alert" }).style.height).toBe("");
});

it("falls back to a headline that says more than the title does", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte", {
    instruction: undefined,
    headline: "Storms with damaging gusts expected through Tuesday evening",
  })]} />);
  expect(screen.getByText("DETAILS")).toBeInTheDocument();
  expect(screen.getByText(/damaging gusts/)).toBeInTheDocument();
});

it("ignores a headline that only restates the warning", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte", {
    instruction: undefined, headline: "Thunderstorm warning",
  })]} />);
  expect(screen.queryByText("DETAILS")).not.toBeInTheDocument();
});

it("tells viewers how long the warning runs and how many it stands for", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte", {
    expires: new Date(Date.now() + 3 * 3600_000).toISOString(), memberCount: 37,
  })]} />);
  expect(screen.getByText(/runs 3h more/)).toBeInTheDocument();
  expect(screen.getByText("37 WARNINGS")).toBeInTheDocument();
});

it("renders nothing with no fresh warnings and no sponsors placed", () => {
  const { container } = render(<LiveAlertPanel alerts={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it("keeps the slot in use with sponsor cards when nothing fresh has been issued", () => {
  render(<LiveAlertPanel alerts={[]} sponsors={[sponsor("s1")]} />);
  expect(screen.getByRole("region", { name: "Sponsor message" })).toBeInTheDocument();
  expect(screen.getByText("SPONSORED")).toBeInTheDocument();
  expect(screen.getByText("ACME")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "s1 spot" })).toHaveAttribute("src", "/api/ads/s1/media?v=1");
  expect(screen.queryByRole("region", { name: "New weather alert" })).not.toBeInTheDocument();
});

it("gives a sponsor its own turn after every two warnings, never sharing a warning's card", () => {
  jest.useFakeTimers();
  const { unmount } = render(
    <LiveAlertPanel
      alerts={[warning("a", "Reutte"), warning("b", "Tyrol"), warning("c", "Vorarlberg")]}
      sponsors={[sponsor("s1")]}
    />,
  );
  expect(screen.getByText("Alert 1 of 3")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(10000); });
  expect(screen.getByText("Alert 2 of 3")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(10000); });
  expect(screen.getByRole("region", { name: "Sponsor message" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "New weather alert" })).not.toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(10000); });
  expect(screen.getByText("Alert 3 of 3")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Sponsor message" })).not.toBeInTheDocument();
  unmount();
  jest.useRealTimers();
});

it("alternates a lone warning with the sponsor instead of holding the warning twice", () => {
  jest.useFakeTimers();
  const { unmount } = render(<LiveAlertPanel alerts={[warning("a", "Reutte")]} sponsors={[sponsor("s1")]} />);
  expect(screen.getByRole("region", { name: "New weather alert" })).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(10000); });
  expect(screen.getByRole("region", { name: "Sponsor message" })).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(10000); });
  expect(screen.getByRole("region", { name: "New weather alert" })).toBeInTheDocument();
  unmount();
  jest.useRealTimers();
});
