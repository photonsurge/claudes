import { render, screen } from "@testing-library/react";
import BakePoolStrip from "./BakePoolStrip";

const base = { worker: 0, inline: 0, spawned: 0, recycled: 0, crashed: 0 };

describe("BakePoolStrip", () => {
  it("renders nothing without pool stats (old worker build)", () => {
    const { container } = render(<BakePoolStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when the pool has not baked anything yet", () => {
    render(<BakePoolStrip pool={{ ...base }} />);
    expect(screen.getByText(/no bakes since boot/i)).toBeInTheDocument();
  });

  it("shows the lifecycle counters for a healthy pool", () => {
    render(<BakePoolStrip pool={{ ...base, worker: 42, spawned: 6, recycled: 4, threads: 2 }} />);
    expect(screen.getByText("Bake threads")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument(); // baked in thread
    expect(screen.getByText("6")).toBeInTheDocument(); // spawned
    expect(screen.getByText("4")).toBeInTheDocument(); // recycled — memory handed back
    expect(screen.getByText("2")).toBeInTheDocument(); // live isolates
    // crashed and queued are omitted when zero — no noise on the healthy path
    expect(screen.queryByText("crashed")).not.toBeInTheDocument();
    expect(screen.queryByText("queued")).not.toBeInTheDocument();
  });

  it("flags inline-only serving (pool off/broken) and crashes", () => {
    render(<BakePoolStrip pool={{ ...base, inline: 7, crashed: 3, threads: 0, queued: 5 }} />);
    expect(screen.getByText("inline")).toBeInTheDocument();
    expect(screen.getByText("crashed")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
