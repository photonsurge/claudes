/**
 * ChannelLauncher — one card per channel with correctly-scoped Control, Watch
 * and Settings links, the per-channel ON AIR badge (live run OR director
 * heartbeat) with YouTube watch/chat links, and the empty-state prompt.
 */
import { render, screen } from "@testing-library/react";
import ChannelLauncher from "./ChannelLauncher";

jest.mock("../lib/scenes", () => ({ listScenes: jest.fn() }));
jest.mock("../lib/director", () => ({ useDirector: jest.fn() }));
jest.mock("../lib/stream", () => ({ usePublicLiveRuns: jest.fn() }));
import { listScenes } from "../lib/scenes";
import { useDirector } from "../lib/director";
import { usePublicLiveRuns } from "../lib/stream";

const mockList = listScenes as jest.MockedFunction<typeof listScenes>;
const mockDirector = useDirector as jest.Mock;
const mockLiveRuns = usePublicLiveRuns as jest.Mock;

const liveRun = (sceneId: string, over: Record<string, unknown> = {}) => ({
  sceneId,
  status: "live",
  title: "Morning loop",
  watchUrl: `https://www.youtube.com/watch?v=vid-${sceneId}`,
  chatUrl: `https://www.youtube.com/live_chat?is_popout=1&v=vid-${sceneId}`,
  startAt: 1,
  ...over,
});

describe("ChannelLauncher", () => {
  beforeEach(() => {
    mockDirector.mockReturnValue(null);
    mockLiveRuns.mockReturnValue({});
  });

  it("renders Control + Watch + Settings links per channel with the right hrefs", async () => {
    mockList.mockResolvedValue([
      { id: "default", name: "Main" },
      { id: "wind", name: "Atlantic Wind" },
    ] as Awaited<ReturnType<typeof listScenes>>);

    render(<ChannelLauncher />);

    const controls = await screen.findAllByRole("link", { name: "Control" });
    expect(controls).toHaveLength(2);
    // main → bare /control; other channels carry the ?scene= deep-link.
    expect(controls[0]).toHaveAttribute("href", "/control");
    expect(controls[1]).toHaveAttribute("href", "/control?scene=wind");

    const watches = screen.getAllByRole("link", { name: "Watch ↗" });
    expect(watches[0]).toHaveAttribute("href", "/watch/default");
    expect(watches[1]).toHaveAttribute("href", "/watch/wind");

    const settings = screen.getAllByRole("link", { name: "Settings" });
    expect(settings[0]).toHaveAttribute("href", "/admin/scenes/default");
    expect(settings[1]).toHaveAttribute("href", "/admin/scenes/wind");

    // Nothing is live — no per-card badge, no platform links.
    expect(screen.queryByText("ON AIR")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "YouTube ↗" })).not.toBeInTheDocument();
  });

  it("shows ON AIR + YouTube/Chat links only on the channel with a live run", async () => {
    mockList.mockResolvedValue([
      { id: "default", name: "Main" },
      { id: "seismic", name: "Seismic" },
    ] as Awaited<ReturnType<typeof listScenes>>);
    mockLiveRuns.mockReturnValue({ seismic: liveRun("seismic") });

    render(<ChannelLauncher />);
    await screen.findAllByRole("link", { name: "Control" });

    expect(screen.getAllByText("ON AIR")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "YouTube ↗" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=vid-seismic",
    );
    expect(screen.getByRole("link", { name: "Chat ↗" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/live_chat?is_popout=1&v=vid-seismic",
    );
  });

  it("omits the YouTube/Chat links when the live run has no platform URLs", async () => {
    mockList.mockResolvedValue([{ id: "default", name: "Main" }] as Awaited<ReturnType<typeof listScenes>>);
    mockLiveRuns.mockReturnValue({ default: liveRun("default", { watchUrl: null, chatUrl: null }) });

    render(<ChannelLauncher />);
    await screen.findAllByRole("link", { name: "Control" });

    expect(screen.getByText("ON AIR")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "YouTube ↗" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Chat ↗" })).not.toBeInTheDocument();
  });

  it("falls back to the director heartbeat for a director-only broadcast", async () => {
    mockList.mockResolvedValue([{ id: "default", name: "Main" }] as Awaited<ReturnType<typeof listScenes>>);
    mockDirector.mockImplementation((sceneId: string) => (sceneId === "default" ? { active: true } : null));

    render(<ChannelLauncher />);
    await screen.findAllByRole("link", { name: "Control" });

    expect(screen.getByText("ON AIR")).toBeInTheDocument();
    // Director-only: no platform run, so no YouTube links.
    expect(screen.queryByRole("link", { name: "YouTube ↗" })).not.toBeInTheDocument();
  });

  it("prompts to create a channel when there are none", async () => {
    mockList.mockResolvedValue([] as Awaited<ReturnType<typeof listScenes>>);
    render(<ChannelLauncher />);
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();
  });
});
