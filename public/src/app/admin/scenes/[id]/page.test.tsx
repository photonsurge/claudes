/**
 * /admin/scenes/:id — the per-channel settings page wires the right sceneId into
 * the form and points Control/Watch at the correctly-scoped URLs (bare /control
 * for the main channel, ?scene= for the rest).
 */
import { render, screen } from "@testing-library/react";
import ChannelSettingsPage from "./page";

let mockParams: { id: string } = { id: "wind" };
jest.mock("next/navigation", () => ({ useParams: () => mockParams }));

jest.mock("../../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [
    { id: "default", name: "Main" },
    { id: "wind", name: "Atlantic Wind" },
  ]),
  // The SceneDraftProvider wrapping the cards needs a patcher for its Save bar.
  useScenePatcher: () => jest.fn(),
}));

jest.mock("../../../../components/admin/scenes/ChannelSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="settings">settings:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/CameraSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="camera">camera:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/SlidesSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="slides">slides:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/ReportSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="report">report:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/PaceSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="pace">pace:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/TickerSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="ticker">ticker:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/ThemeSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="theme">theme:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/AudioSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="audio">audio:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/AboutCardSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="about">about:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/YoutubeSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="youtube">youtube:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/DirectorSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="director">director:{sceneId}</div>,
}));

describe("ChannelSettingsPage", () => {
  it("renders the form for a named channel with ?scene= links", async () => {
    mockParams = { id: "wind" };
    render(<ChannelSettingsPage />);

    expect(await screen.findByText("settings:wind")).toBeInTheDocument();
    // All the per-channel editors mount for this scene.
    expect(screen.getByText("camera:wind")).toBeInTheDocument();
    expect(screen.getByText("ticker:wind")).toBeInTheDocument();
    expect(screen.getByText("pace:wind")).toBeInTheDocument();
    expect(screen.getByText("slides:wind")).toBeInTheDocument();
    expect(screen.getByText("about:wind")).toBeInTheDocument();
    expect(screen.getByText("audio:wind")).toBeInTheDocument();
    expect(screen.getByText("theme:wind")).toBeInTheDocument();
    expect(screen.getByText("director:wind")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Control" })).toHaveAttribute("href", "/control?scene=wind");
    expect(screen.getByRole("link", { name: "Watch ↗" })).toHaveAttribute("href", "/watch/wind");
    // Title resolves to the channel's display name once listScenes loads.
    expect(await screen.findByText("Channel: Atlantic Wind")).toBeInTheDocument();
  });

  it("uses the bare /control link for the main channel", async () => {
    mockParams = { id: "default" };
    render(<ChannelSettingsPage />);

    expect(await screen.findByText("settings:default")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Control" })).toHaveAttribute("href", "/control");
    expect(screen.getByRole("link", { name: "Watch ↗" })).toHaveAttribute("href", "/watch/default");
  });
});
