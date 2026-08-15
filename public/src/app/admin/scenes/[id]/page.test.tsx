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
}));

jest.mock("../../../../components/admin/scenes/ChannelSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="settings">settings:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/SlidesSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="slides">slides:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/ReportSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="report">report:{sceneId}</div>,
}));
jest.mock("../../../../components/admin/scenes/ThemeSettings", () => ({
  __esModule: true,
  default: ({ sceneId }: { sceneId: string }) => <div data-testid="theme">theme:{sceneId}</div>,
}));

describe("ChannelSettingsPage", () => {
  it("renders the form for a named channel with ?scene= links", async () => {
    mockParams = { id: "wind" };
    render(<ChannelSettingsPage />);

    expect(await screen.findByText("settings:wind")).toBeInTheDocument();
    // All three per-channel editors mount for this scene.
    expect(screen.getByText("slides:wind")).toBeInTheDocument();
    expect(screen.getByText("theme:wind")).toBeInTheDocument();
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
