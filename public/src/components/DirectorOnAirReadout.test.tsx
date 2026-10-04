import { render, screen } from "@testing-library/react";
import type { DirectorState } from "@photonsurge/shared/director";
import DirectorOnAirReadout from "./DirectorOnAirReadout";

const NOW = Date.UTC(2026, 9, 4);
const live = (over: Partial<DirectorState>): DirectorState => ({
  sceneId: "wind",
  seq: 1,
  active: true,
  segment: { id: "quake:x", kind: "quake", title: "M6 Chile", camera: { center: [0, 0], zoom: 4 }, patch: {}, holdMs: 1 },
  startedAt: NOW - 1000,
  endsAt: NOW + 20_000,
  upNext: [],
  ...over,
});

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

it("counts down the shot", () => {
  render(<DirectorOnAirReadout auto live={live({})} />);
  expect(screen.getByText("ON AIR · 20s")).toBeInTheDocument();
});

it("says PAUSED instead of counting down", () => {
  render(<DirectorOnAirReadout auto live={live({ paused: { since: NOW } })} />);
  expect(screen.getByText("ON AIR · PAUSED")).toBeInTheDocument();
  expect(screen.queryByText(/20s/)).not.toBeInTheDocument();
});

it("shows when a timed pause lifts", () => {
  render(<DirectorOnAirReadout auto live={live({ paused: { since: NOW, until: NOW + 45_000 } })} />);
  expect(screen.getByText("ON AIR · PAUSED · resumes in 45s")).toBeInTheDocument();
});

it("lists the command queue, marking viewer requests", () => {
  render(
    <DirectorOnAirReadout
      auto
      live={live({
        queued: [
          { id: "a", label: "Next: a quake", source: "operator" },
          { id: "b", label: "Take Japan", source: "viewer" },
        ],
      })}
    />,
  );
  expect(screen.getByLabelText("Command queue")).toHaveTextContent("Queued: Next: a quakeTake Japan (viewer)");
});

it("flags a break-in that interrupted the previous shot, the waiting queue and the last break-in", () => {
  render(
    <DirectorOnAirReadout
      auto
      live={live({
        segment: { ...live({}).segment!, breakIn: { reason: "storm", interrupted: true } },
        breakInQueue: [
          { reason: "storm", title: "Flood · Gulf", at: NOW },
          { reason: "quake", title: "M6 Chile", at: NOW },
        ],
        lastBreakInAt: NOW - 5 * 60_000,
      })}
    />,
  );
  expect(screen.getByText("⚡ BREAK-IN · interrupted the previous shot")).toBeInTheDocument();
  expect(screen.getByLabelText("Break-in queue")).toHaveTextContent("2 breaking events waiting: Flood · Gulf · M6 Chile");
  expect(screen.getByText("Last break-in 5m ago")).toBeInTheDocument();
});
