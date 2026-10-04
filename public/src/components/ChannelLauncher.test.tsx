/**
 * ChannelLauncher — one card per channel with correctly-scoped Control, Watch
 * and Settings links, the per-channel ON AIR badge (live run OR director
 * heartbeat) with YouTube watch/chat links, the director NOW/NEXT strip, and
 * the empty-state prompt. A crossword card shows its puzzle progress instead of
 * now/next and links its Desk; Watch links come from `outputPath`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import ChannelLauncher from "./ChannelLauncher";
import { puzzleProgress } from "./ChannelPuzzleLine";

jest.mock("../lib/scenes", () => ({ listScenes: jest.fn() }));
jest.mock("../lib/director", () => ({ useDirector: jest.fn(), skipToNextShot: jest.fn() }));
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

    const watches = screen.getAllByRole("link", { name: "Output ↗" });
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

  it("carries the director's NOW/NEXT strip on the channel it is driving", async () => {
    mockList.mockResolvedValue([
      { id: "default", name: "Main" },
      { id: "seismic", name: "Seismic" },
    ] as Awaited<ReturnType<typeof listScenes>>);
    mockDirector.mockImplementation((sceneId: string) =>
      sceneId === "default"
        ? {
            sceneId,
            active: true,
            seq: 2,
            segment: { title: "France", subtitle: "Amber wind warning" },
            endsAt: Date.now() + 20_000,
            upNext: [{ kind: "global", title: "World View" }],
          }
        : null,
    );

    render(<ChannelLauncher />);
    await screen.findAllByRole("link", { name: "Control" });

    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText("World View")).toBeInTheDocument();
    // Only the driven channel gets a Next button — the other card has no queue.
    expect(screen.getAllByRole("button", { name: "Next ⏭" })).toHaveLength(1);
  });

  it("leaves hidden (production) scenes off the launcher", async () => {
    mockList.mockResolvedValue([
      { id: "default", name: "Main" },
      { id: "shorts-preview", name: "Shorts · Preview", hidden: true },
    ] as Awaited<ReturnType<typeof listScenes>>);
    render(<ChannelLauncher />);
    expect(await screen.findByText("Main")).toBeInTheDocument();
    expect(screen.queryByText("Shorts · Preview")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Control" })).toHaveLength(1);
  });

  it("prompts to create a channel when there are none", async () => {
    mockList.mockResolvedValue([] as Awaited<ReturnType<typeof listScenes>>);
    render(<ChannelLauncher />);
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();
  });

  describe("a crossword channel", () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    const xwState = {
      puzzleNo: 42,
      entries: [
        { id: "1A", solved: { name: "Ann", points: 3 } },
        { id: "2D", solved: { name: "Host", points: 0 } },
        { id: "3A" },
      ],
    };

    it("shows the puzzle line and links Desk / Output / Settings", async () => {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => xwState })) as unknown as typeof fetch;
      mockList.mockResolvedValue([
        { id: "default", name: "Main" },
        { id: "word-up", name: "Word Up", surface: "crossword" },
      ] as Awaited<ReturnType<typeof listScenes>>);

      render(<ChannelLauncher />);

      expect(await screen.findByText(/Puzzle 42 · 2 of 3 solved/)).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith("/api/crossword/word-up/state", { cache: "no-store" });
      // Only the crossword card reads game state.
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("link", { name: "Desk" })).toHaveAttribute("href", "/admin/crosswords/desk/word-up");
      const watches = screen.getAllByRole("link", { name: "Output ↗" });
      expect(watches[1]).toHaveAttribute("href", "/crossword/word-up");
      expect(screen.getAllByRole("link", { name: "Settings" })[1]).toHaveAttribute("href", "/admin/crosswords/channels/word-up");
      expect(screen.getAllByRole("link", { name: "Control" })).toHaveLength(1);
    });

    it("fails soft when the state can't be read", async () => {
      global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
      mockList.mockResolvedValue([{ id: "word-up", name: "Word Up", surface: "crossword" }] as Awaited<
        ReturnType<typeof listScenes>
      >);

      render(<ChannelLauncher />);

      expect(await screen.findByRole("link", { name: "Desk" })).toBeInTheDocument();
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(screen.queryByText(/Puzzle/)).not.toBeInTheDocument();
    });

    it("reads ON AIR from a live run, not a director heartbeat", async () => {
      global.fetch = jest.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch;
      mockList.mockResolvedValue([{ id: "word-up", name: "Word Up", surface: "crossword" }] as Awaited<
        ReturnType<typeof listScenes>
      >);
      mockDirector.mockReturnValue({ active: true });

      render(<ChannelLauncher />);
      await screen.findByRole("link", { name: "Desk" });
      expect(screen.queryByText("ON AIR")).not.toBeInTheDocument();
    });
  });
});

describe("puzzleProgress", () => {
  it("counts solved entries, and is null before a puzzle is laid out", () => {
    expect(puzzleProgress({ puzzleNo: 3, entries: [{ solved: {} }, {}] as never })).toEqual({
      puzzleNo: 3,
      solved: 1,
      total: 2,
    });
    expect(puzzleProgress({ puzzleNo: 0, entries: [] })).toBeNull();
    expect(puzzleProgress(null)).toBeNull();
  });
});
