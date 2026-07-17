/**
 * EventUsageTable — renders the per-event memory ledger and re-sorts on a header
 * click. The default sort is by peak heap delta (descending) — that's the "which
 * job type grows the heap most" view the operator asked for.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import EventUsageTable from "./EventUsageTable";
import type { WorkerEventStat } from "../../lib/worker-stats";

const EV = (over: Partial<WorkerEventStat>): WorkerEventStat => ({
  label: "x.y",
  runs: 1,
  errors: 0,
  totalMs: 100,
  peakMs: 100,
  lastMs: 100,
  avgMs: 100,
  peakHeapDeltaMB: 10,
  peakRssMB: 100,
  ...over,
});

const rowLabels = () =>
  screen
    .getAllByRole("row")
    .slice(1) // drop the header row
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("EventUsageTable", () => {
  const events = [
    EV({ label: "cams.ingest", peakHeapDeltaMB: 40 }),
    EV({ label: "weather.refresh", peakHeapDeltaMB: 120 }),
    EV({ label: "tracks.ingest", peakHeapDeltaMB: 80 }),
  ];

  it("defaults to peak-heap descending", () => {
    render(<EventUsageTable events={events} />);
    expect(rowLabels()).toEqual(["weather.refresh", "tracks.ingest", "cams.ingest"]);
  });

  it("re-sorts alphabetically when the event header is clicked", () => {
    render(<EventUsageTable events={events} />);
    fireEvent.click(screen.getByText("event"));
    expect(rowLabels()).toEqual(["cams.ingest", "tracks.ingest", "weather.refresh"]);
  });

  it("toggles direction on a repeat click of the active column", () => {
    render(<EventUsageTable events={events} />);
    // peak-heap is already active (desc) → click flips to ascending
    fireEvent.click(screen.getByText(/peak heap/));
    expect(rowLabels()).toEqual(["cams.ingest", "tracks.ingest", "weather.refresh"]);
  });

  it("flags rows that are running right now", () => {
    render(<EventUsageTable events={events} activeLabels={["weather.refresh"]} />);
    const row = screen.getByText("refresh").closest("tr")!;
    expect(within(row).getByTitle("running now")).toBeInTheDocument();
    // A non-active row has no live dot.
    const idle = screen.getByText("cams.").closest("tr")!;
    expect(within(idle).queryByTitle("running now")).toBeNull();
  });

  it("shows an empty-state when there are no events", () => {
    render(<EventUsageTable events={[]} />);
    expect(screen.getByText(/No events recorded yet/)).toBeInTheDocument();
  });
});
