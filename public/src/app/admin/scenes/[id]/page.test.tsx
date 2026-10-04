/**
 * /admin/scenes/:id — the per-channel settings page. It wires the right sceneId
 * into the draft, points Control/Watch at correctly-scoped URLs, and shows ONE
 * group of cards at a time: `?s=` picks a group, a `#card` deep link picks the
 * group that card lives in.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import ChannelSettingsPage from "./page";

let mockParams: { id: string } = { id: "wind" };
jest.mock("next/navigation", () => ({ useParams: () => mockParams }));

jest.mock("../../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [
    { id: "default", name: "Main" },
    { id: "wind", name: "Atlantic Wind" },
    { id: "word-up", name: "Word Up", surface: "crossword" },
  ]),
  // The draft provider reads the channel's state and patches it on Save. The
  // real reader always merges against the defaults, so the mock returns a whole
  // state too.
  fetchSceneState: jest.fn(async () => ({ state: DEFAULT_CONTROL_STATE, tokenError: false })),
  patchScene: jest.fn(async () => ({ ok: true })),
  useScenePatcher: () => jest.fn(),
}));
jest.mock("../../../../lib/director", () => ({
  fetchDirectorConfig: jest.fn(async () => DEFAULT_DIRECTOR_CONFIG),
  patchDirectorConfig: jest.fn(async () => ({})),
  mergeConfig: (prev: object, patch: object) => ({ ...prev, ...patch }),
}));

jest.mock("../../../../components/admin/scenes/crossword-config", () => ({
  fetchCrosswordConfig: jest.fn(async () => jest.requireActual("@photonsurge/shared/crossword").DEFAULT_CROSSWORD_CONFIG),
  patchCrosswordConfig: jest.fn(async () => ({})),
}));
jest.mock("../../../../components/admin/scenes/CrosswordGameSettings", () => ({
  CrosswordOnSettings: () => <div data-testid="crossword-on">on</div>,
  CrosswordPacingSettings: () => <div data-testid="crossword-pacing">pacing</div>,
  CrosswordDifficultySettings: () => <div data-testid="crossword-difficulty">difficulty</div>,
  CrosswordPuzzleSettings: () => <div data-testid="crossword-puzzles">puzzles</div>,
  CrosswordChatSettings: () => <div data-testid="crossword-chat">chat</div>,
}));

/* Each card is stubbed by its anchor id, so a test can see which group rendered.
   The factories are inlined because jest.mock is hoisted above any helper. */
jest.mock("../../../../components/admin/scenes/ChannelSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="widgets">widgets</div>,
}));
jest.mock("../../../../components/admin/scenes/ReportSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="report">report</div>,
}));
jest.mock("../../../../components/admin/scenes/SlidesSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="deck">deck</div>,
}));
jest.mock("../../../../components/admin/scenes/TickerSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="crawl">crawl</div>,
}));
jest.mock("../../../../components/admin/scenes/ThemeSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="theme">theme</div>,
}));
jest.mock("../../../../components/admin/scenes/CameraSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="camera">camera</div>,
}));
jest.mock("../../../../components/admin/scenes/AudioSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="audio">audio</div>,
}));
jest.mock("../../../../components/admin/scenes/PaceSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="pace">pace</div>,
}));
jest.mock("../../../../components/admin/scenes/DirectorSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="director">director</div>,
}));
jest.mock("../../../../components/admin/scenes/AboutCardSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="about">about</div>,
}));
jest.mock("../../../../components/admin/scenes/YoutubeSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="youtube">youtube</div>,
}));

const url = (path: string) => window.history.replaceState(null, "", path);

beforeEach(() => {
  mockParams = { id: "wind" };
  url("/admin/scenes/wind");
});

describe("ChannelSettingsPage", () => {
  it("opens on Layout and shows only that group's cards", async () => {
    render(<ChannelSettingsPage />);

    expect(await screen.findByTestId("widgets")).toBeInTheDocument();
    expect(screen.getByTestId("report")).toBeInTheDocument();
    expect(screen.getByTestId("deck")).toBeInTheDocument();
    expect(screen.getByTestId("crawl")).toBeInTheDocument();
    // Another group's cards are not mounted — the draft, not the card, holds edits.
    expect(screen.queryByTestId("theme")).not.toBeInTheDocument();
    expect(screen.queryByTestId("youtube")).not.toBeInTheDocument();
  });

  it("switches group from the rail and records it in the URL", async () => {
    render(<ChannelSettingsPage />);
    await screen.findByTestId("widgets");

    const rail = screen.getByRole("navigation", { name: "Settings groups" });
    fireEvent.click(within(rail).getByText("Identity"));

    expect(screen.getByTestId("youtube")).toBeInTheDocument();
    expect(screen.getByTestId("about")).toBeInTheDocument();
    expect(screen.queryByTestId("widgets")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?s=identity");
  });

  it("opens the group named by ?s=", async () => {
    url("/admin/scenes/wind?s=programme");
    render(<ChannelSettingsPage />);

    expect(await screen.findByTestId("director")).toBeInTheDocument();
    expect(screen.queryByTestId("widgets")).not.toBeInTheDocument();
  });

  it("opens the group that owns a #card deep link", async () => {
    url("/admin/scenes/wind#youtube");
    render(<ChannelSettingsPage />);

    // The stream panel and the streams slot card both link to #youtube.
    expect(await screen.findByTestId("youtube")).toBeInTheDocument();
    expect(screen.queryByTestId("widgets")).not.toBeInTheDocument();
  });

  it("ignores an unknown group and falls back to Layout", async () => {
    url("/admin/scenes/wind?s=nonsense");
    render(<ChannelSettingsPage />);

    expect(await screen.findByTestId("widgets")).toBeInTheDocument();
  });

  it("links Control and Watch at this channel", async () => {
    render(<ChannelSettingsPage />);

    expect(await screen.findByRole("link", { name: "Control" })).toHaveAttribute(
      "href",
      "/control?scene=wind",
    );
    expect(screen.getByRole("link", { name: "Watch ↗" })).toHaveAttribute("href", "/watch/wind");
    // Title resolves to the channel's display name once listScenes loads.
    expect(await screen.findByText("Channel: Atlantic Wind")).toBeInTheDocument();
  });

  it("uses the bare /control link for the main channel", async () => {
    mockParams = { id: "default" };
    render(<ChannelSettingsPage />);

    expect(await screen.findByRole("link", { name: "Control" })).toHaveAttribute("href", "/control");
    expect(screen.getByRole("link", { name: "Watch ↗" })).toHaveAttribute("href", "/watch/default");
  });

  it("does not offer a weather channel the Game group", async () => {
    render(<ChannelSettingsPage />);
    await screen.findByTestId("widgets");
    const rail = screen.getByRole("navigation", { name: "Settings groups" });
    expect(within(rail).queryByText("Game")).not.toBeInTheDocument();
  });

  describe("a crossword channel", () => {
    beforeEach(() => {
      mockParams = { id: "word-up" };
      url("/admin/scenes/word-up");
    });

    it("opens on Game and offers only the groups a crossword has", async () => {
      render(<ChannelSettingsPage />);

      expect(await screen.findByTestId("crossword-pacing")).toBeInTheDocument();
      expect(screen.getByTestId("crossword-on")).toBeInTheDocument();
      expect(screen.getByTestId("crossword-chat")).toBeInTheDocument();
      const rail = screen.getByRole("navigation", { name: "Settings groups" });
      expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual([
        "Game",
        "Presentation",
        "Viewers",
        "Identity",
      ]);
    });

    it("shows the shared cards but not the globe's in Presentation", async () => {
      url("/admin/scenes/word-up?s=presentation");
      render(<ChannelSettingsPage />);

      expect(await screen.findByTestId("theme")).toBeInTheDocument();
      expect(screen.getByTestId("audio")).toBeInTheDocument();
      expect(screen.queryByTestId("camera")).not.toBeInTheDocument();
      expect(screen.queryByTestId("pace")).not.toBeInTheDocument();
    });

    it("ignores a globe-only group or card in the URL", async () => {
      url("/admin/scenes/word-up?s=programme");
      render(<ChannelSettingsPage />);
      expect(await screen.findByTestId("crossword-pacing")).toBeInTheDocument();
      expect(screen.queryByTestId("director")).not.toBeInTheDocument();
    });

    it("links the Desk and the crossword watch page", async () => {
      render(<ChannelSettingsPage />);
      expect(await screen.findByRole("link", { name: "Desk" })).toHaveAttribute(
        "href",
        "/admin/crosswords/desk/word-up",
      );
      expect(screen.getByRole("link", { name: "Watch ↗" })).toHaveAttribute("href", "/crossword/word-up");
    });
  });
});
