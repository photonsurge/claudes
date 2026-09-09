import { act, render, screen } from "@testing-library/react";
import type { AlertFeature } from "../../lib/alerts";
import LiveAlertPanel from "./LiveAlertPanel";

const warning = (id: string, area: string): AlertFeature => ({
  type: "Feature", geometry: { type: "Point", coordinates: [0, 0] },
  properties: { id, source: "test", identifier: id, event: "Thunderstorms",
    hazard: "thunderstorm", severityRank: 2, areaDesc: area, sent: new Date().toISOString(),
    instruction: "Take extra care in exposed areas.",
  },
} as AlertFeature);

it("separates location, severity, timing and official advice", () => {
  render(<LiveAlertPanel alerts={[warning("a", "Reutte")]} />);
  expect(screen.getByText("Area: Reutte")).toBeInTheDocument();
  expect(screen.getByText(/Severity:/)).toBeInTheDocument();
  expect(screen.getByText(/Issued /)).toBeInTheDocument();
  expect(screen.getByText("OFFICIAL ADVICE")).toBeInTheDocument();
  expect(screen.getByText("Take extra care in exposed areas.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "New weather alert" })).toHaveStyle({ backgroundColor: "#081420" });
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
