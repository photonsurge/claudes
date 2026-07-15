/**
 * QueueBacklog — the shape of the backlog, and the confirm-gate on binning a
 * whole job kind at once.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import QueueBacklog, { type BacklogRow } from "./QueueBacklog";

const NOW = Date.parse("2026-07-15T22:00:00Z");
const minsAgo = (m: number) => NOW - m * 60_000;

const ROWS: BacklogRow[] = [
  { type: "weather", event: "refreshMrms", count: 23, oldest: minsAgo(260) },
  { type: "events", event: "acquire", count: 47, oldest: minsAgo(30) },
  { type: "alerts", event: "ingest", count: 3, oldest: minsAgo(5) },
];

const row = (name: string) => screen.getByText(name).closest("div") as HTMLElement;

describe("QueueBacklog", () => {
  it("says what the backlog is made of", () => {
    render(<QueueBacklog rows={ROWS} now={NOW} busy={false} onCancel={jest.fn()} />);

    expect(screen.getByText(/73 queued across 3 job kinds/)).toBeInTheDocument();
    expect(screen.getByText("weather.refreshMrms")).toBeInTheDocument();
  });

  it("shows how far behind the oldest of each kind is", () => {
    // The number that decides whether a pile is worth binning: 4h-old model
    // refreshes are re-runs of stale work, not a queue that's merely busy.
    render(<QueueBacklog rows={ROWS} now={NOW} busy={false} onCancel={jest.fn()} />);

    expect(screen.getByText("oldest 4.3h")).toBeInTheDocument();
    expect(screen.getByText("oldest 30m")).toBeInTheDocument();
  });

  it("does not cancel on the first click", () => {
    // Binning 47 jobs can't be undone, and the rows sit right next to each other.
    const onCancel = jest.fn();
    render(<QueueBacklog rows={ROWS} now={NOW} busy={false} onCancel={onCancel} />);

    fireEvent.click(within(row("events.acquire")).getByRole("button", { name: "Cancel" }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel 47?" })).toBeInTheDocument();
  });

  it("cancels the kind that was confirmed", () => {
    const onCancel = jest.fn();
    render(<QueueBacklog rows={ROWS} now={NOW} busy={false} onCancel={onCancel} />);

    fireEvent.click(within(row("weather.refreshMrms")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel 23?" }));

    expect(onCancel).toHaveBeenCalledWith("weather", "refreshMrms");
  });

  it("lets you back out", () => {
    const onCancel = jest.fn();
    render(<QueueBacklog rows={ROWS} now={NOW} busy={false} onCancel={onCancel} />);

    fireEvent.click(within(row("events.acquire")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel 47?" })).not.toBeInTheDocument();
  });

  it("only arms one row at a time", () => {
    render(<QueueBacklog rows={ROWS} now={NOW} busy={false} onCancel={jest.fn()} />);

    fireEvent.click(within(row("events.acquire")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(row("alerts.ingest")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Cancel 47?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel 3?" })).toBeInTheDocument();
  });

  it("says so when there's nothing queued", () => {
    render(<QueueBacklog rows={[]} now={NOW} busy={false} onCancel={jest.fn()} />);

    expect(screen.getByText("Nothing queued.")).toBeInTheDocument();
  });

  it("disables cancelling while a request is in flight", () => {
    render(<QueueBacklog rows={ROWS} now={NOW} busy onCancel={jest.fn()} />);

    for (const b of screen.getAllByRole("button", { name: "Cancel" })) expect(b).toBeDisabled();
  });

  it("copes with a kind whose oldest job has no timestamp", () => {
    render(
      <QueueBacklog
        rows={[{ type: "x", event: "y", count: 1, oldest: null }]}
        now={NOW}
        busy={false}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText("oldest —")).toBeInTheDocument();
  });
});
