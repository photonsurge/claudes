/**
 * ClipList — the ordered clip list: label, target, start/duration, the
 * template's tour fields, and skip reasons from the last preview play.
 */
import { render, screen, within } from "@testing-library/react";
import type { ShortScript } from "@photonsurge/shared/short-script";
import ClipList from "./ClipList";

const script: ShortScript = {
  id: "s1",
  template: "lineup",
  scope: { type: "country", id: "japan" },
  include: { alerts: false, quakes: false, volcanoes: false },
  title: "Japan round-up",
  status: "draft",
  clips: [
    {
      id: "a",
      target: "country:japan",
      durationMs: 45_000,
      maxStops: 3,
      tourDwellMs: 8_000,
      leadSlide: "roundup",
      label: { title: "Japan", subtitle: "National tour", icon: "🇯🇵" },
    },
    { id: "b", target: "storm:jma:123", durationMs: 15_000, label: { title: "Heavy rain" } },
  ],
};

it("lists clips in order with their timing and tour settings", () => {
  render(<ClipList script={script} />);
  expect(screen.getByText(/2 clip\(s\) · 1:00/)).toBeInTheDocument();
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText("🇯🇵 Japan")).toBeInTheDocument();
  expect(within(items[0]).getByText("National tour")).toBeInTheDocument();
  expect(within(items[0]).getByText("country:japan")).toBeInTheDocument();
  expect(within(items[0]).getByText("max stops 3")).toBeInTheDocument();
  expect(within(items[0]).getByText("dwell 0:08/stop")).toBeInTheDocument();
  expect(within(items[0]).getByText("leads with roundup")).toBeInTheDocument();
  expect(within(items[1]).getByText("0:15")).toBeInTheDocument();
  expect(within(items[1]).getByText("@ 0:45")).toBeInTheDocument();
  expect(within(items[1]).queryByText(/max stops/)).toBeNull();
});

it("shows why the last preview skipped a clip", () => {
  render(
    <ClipList
      script={script}
      play={{ sceneId: "shorts-preview", playNonce: 1, startedAt: 1, clips: [], skipped: [{ id: "b", reason: "alert no longer active" }] }}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(within(items[1]).getByText("Skipped in the last preview: alert no longer active")).toBeInTheDocument();
  expect(within(items[0]).queryByText(/Skipped/)).toBeNull();
});
