import { render, screen } from "@testing-library/react";
import { useDirector } from "../lib/director";
import StreamStatusBadge from "./StreamStatusBadge";

jest.mock("../lib/director", () => ({ useDirector: jest.fn() }));

const mockUseDirector = useDirector as jest.Mock;

describe("StreamStatusBadge", () => {
  // The badge cold-starts its live-run state from /api/streams/live
  // (usePublicLiveRun); jsdom has no fetch. Nothing here asserts on the run, so
  // an empty list is enough — the socket RUN_STATE path is tested in stream.ts.
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ runs: [] }) })) as any;
  });

  it("shows OFF AIR when the director isn't driving the main scene", () => {
    mockUseDirector.mockReturnValue(null);
    render(<StreamStatusBadge />);
    expect(screen.getByText("OFF AIR")).toBeInTheDocument();
  });

  it("shows ON AIR + the segment title when the director is active", () => {
    mockUseDirector.mockReturnValue({ active: true, segment: { title: "Pacific storm" } });
    render(<StreamStatusBadge />);
    expect(screen.getByText("ON AIR")).toBeInTheDocument();
    expect(screen.getByText("· Pacific storm")).toBeInTheDocument();
  });

  it("shows ON AIR with no title suffix when the segment has none", () => {
    mockUseDirector.mockReturnValue({ active: true, segment: {} });
    render(<StreamStatusBadge />);
    expect(screen.getByText("ON AIR")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});
