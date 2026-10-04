/**
 * PublicChannels — the anonymous home's per-channel cards. What matters here is
 * as much what is ABSENT as what is shown: a viewer gets ON AIR, now/next and
 * the public YouTube links, and never an operator control (Control / Watch /
 * Settings links, the Next button) or a link for a channel that isn't publishing.
 */
import { render, screen, within } from "@testing-library/react";
import PublicChannels from "./PublicChannels";

jest.mock("../lib/scenes", () => ({ listScenes: jest.fn() }));
jest.mock("../lib/director", () => ({ useDirector: jest.fn(), skipToNextShot: jest.fn() }));
jest.mock("../lib/stream", () => ({ usePublicLiveRuns: jest.fn() }));
import { listScenes } from "../lib/scenes";
import { useDirector } from "../lib/director";
import { usePublicLiveRuns } from "../lib/stream";

const mockList = listScenes as jest.MockedFunction<typeof listScenes>;
const mockDirector = useDirector as jest.Mock;
const mockLiveRuns = usePublicLiveRuns as jest.Mock;

type Scenes = Awaited<ReturnType<typeof listScenes>>;

const liveRun = (sceneId: string, over: Record<string, unknown> = {}) => ({
  sceneId,
  status: "live",
  title: "Morning loop",
  watchUrl: `https://www.youtube.com/watch?v=vid-${sceneId}`,
  chatUrl: `https://www.youtube.com/live_chat?is_popout=1&v=vid-${sceneId}`,
  startAt: 1,
  ...over,
});

describe("PublicChannels", () => {
  beforeEach(() => {
    mockDirector.mockReturnValue(null);
    mockLiveRuns.mockReturnValue({});
  });

  it("links a live channel to its YouTube watch page and live chat, and nothing else", async () => {
    mockList.mockResolvedValue([{ id: "default", name: "Main" }] as Scenes);
    mockLiveRuns.mockReturnValue({ default: liveRun("default") });

    render(<PublicChannels />);
    const card = await screen.findByRole("article", { name: "Main" });

    expect(within(card).getByText("ON AIR")).toBeInTheDocument();
    expect(within(card).getByText("Morning loop")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Watch on YouTube ↗" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=vid-default",
    );
    expect(within(card).getByRole("link", { name: "Live chat ↗" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/live_chat?is_popout=1&v=vid-default",
    );
    // No operator surface leaks through.
    expect(screen.queryByRole("link", { name: "Control" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Watch ↗" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is streaming/)).not.toBeInTheDocument();
  });

  it("shows an off-air channel with no links and says nothing is streaming", async () => {
    mockList.mockResolvedValue([{ id: "default", name: "Main" }] as Scenes);

    render(<PublicChannels />);
    const card = await screen.findByRole("article", { name: "Main" });

    expect(within(card).getByText("OFF AIR")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing is streaming right now/)).toBeInTheDocument();
  });

  it("reads ON AIR for a director-only broadcast but has nothing to link to", async () => {
    mockList.mockResolvedValue([{ id: "default", name: "Main" }] as Scenes);
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

    render(<PublicChannels />);
    await screen.findByRole("article", { name: "Main" });

    expect(screen.getByText("ON AIR")).toBeInTheDocument();
    // What's on / what's next, read-only: no Next button for a viewer.
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText("World View")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // A viewer still can't watch this anywhere.
    expect(screen.getByText(/Nothing is streaming right now/)).toBeInTheDocument();
  });

  it("sorts live channels ahead of off-air ones", async () => {
    mockList.mockResolvedValue([
      { id: "default", name: "Main" },
      { id: "seismic", name: "Seismic" },
    ] as Scenes);
    mockLiveRuns.mockReturnValue({ seismic: liveRun("seismic") });

    render(<PublicChannels />);
    const cards = await screen.findAllByRole("article");

    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Seismic", "Main"]);
    expect(screen.getAllByRole("link", { name: "Watch on YouTube ↗" })).toHaveLength(1);
  });

  it("leaves hidden (production) scenes off the list", async () => {
    mockList.mockResolvedValue([
      { id: "default", name: "Main" },
      { id: "shorts", name: "Shorts · Render", hidden: true },
    ] as Scenes);
    render(<PublicChannels />);
    const cards = await screen.findAllByRole("article");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Main"]);
  });

  it("says no channels when every scene is hidden", async () => {
    mockList.mockResolvedValue([{ id: "shorts", name: "Shorts · Render", hidden: true }] as Scenes);
    render(<PublicChannels />);
    expect(await screen.findByText("No channels yet.")).toBeInTheDocument();
  });

  it("says so when there are no channels at all", async () => {
    mockList.mockResolvedValue([] as Scenes);
    render(<PublicChannels />);
    expect(await screen.findByText("No channels yet.")).toBeInTheDocument();
    // …without pointing a viewer at the admin.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
