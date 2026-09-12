/**
 * ChannelNowNext — the home launcher's per-channel NOW/NEXT readout and the Next
 * button that skips the director on to its queued shot.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DirectorState } from "@photonsurge/shared/director";
import ChannelNowNext from "./ChannelNowNext";

jest.mock("../lib/director", () => ({ skipToNextShot: jest.fn() }));
import { skipToNextShot } from "../lib/director";

const mockSkip = skipToNextShot as jest.MockedFunction<typeof skipToNextShot>;

const state = (over: Partial<DirectorState> = {}): DirectorState =>
  ({
    sceneId: "default",
    seq: 4,
    active: true,
    segment: { title: "France", subtitle: "Amber wind warning" },
    startedAt: Date.now(),
    endsAt: Date.now() + 30_000,
    upNext: [
      { kind: "quake", title: "Earthquake", subtitle: "M5.6 · Southern Sumatra" },
      { kind: "global", title: "World View" },
    ],
    ...over,
  }) as DirectorState;

describe("ChannelNowNext", () => {
  beforeEach(() => {
    mockSkip.mockReset();
    mockSkip.mockResolvedValue(undefined);
  });

  it("shows the on-air shot, its countdown and the queued shot", () => {
    render(<ChannelNowNext sceneId="default" director={state()} />);

    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText(/Amber wind warning/)).toBeInTheDocument();
    // Only the FIRST queued shot — the card is a two-line readout, not a rail.
    expect(screen.getByText("Earthquake — M5.6 · Southern Sumatra")).toBeInTheDocument();
    expect(screen.queryByText("World View")).not.toBeInTheDocument();
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument();
  });

  it("keeps the readout but drops the Next button when read-only (the public home)", () => {
    render(<ChannelNowNext sceneId="default" director={state()} readOnly />);

    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText("Earthquake — M5.6 · Southern Sumatra")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders an em-dash when nothing is queued yet", () => {
    render(<ChannelNowNext sceneId="default" director={state({ upNext: [] })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when the director isn't driving the channel", () => {
    const { container, rerender } = render(<ChannelNowNext sceneId="default" director={null} />);
    expect(container).toBeEmptyDOMElement();

    // Heartbeat with no shot yet (director just came up) — still nothing to show.
    rerender(<ChannelNowNext sceneId="default" director={state({ segment: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("skips the channel's director on click and clears once the cut lands", async () => {
    const { rerender } = render(<ChannelNowNext sceneId="seismic" director={state()} />);

    fireEvent.click(screen.getByRole("button", { name: "Next ⏭" }));
    expect(mockSkip).toHaveBeenCalledWith("seismic");
    // Pending until the worker's next cut arrives.
    expect(await screen.findByRole("button", { name: "Cutting…" })).toBeDisabled();

    await act(async () => {
      rerender(<ChannelNowNext sceneId="seismic" director={state({ seq: 5 })} />);
    });
    expect(screen.getByRole("button", { name: "Next ⏭" })).toBeEnabled();
  });

  it("reports a failed skip instead of hanging on Cutting…", async () => {
    mockSkip.mockRejectedValue(new Error("403"));
    render(<ChannelNowNext sceneId="default" director={state()} />);

    fireEvent.click(screen.getByRole("button", { name: "Next ⏭" }));

    await waitFor(() => expect(screen.getByText("Skip failed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Next ⏭" })).toBeEnabled();
  });
});
