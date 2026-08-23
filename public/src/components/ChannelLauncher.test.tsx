/**
 * ChannelLauncher — one card per channel with correctly-scoped Control, Watch
 * and Settings links, and the empty-state prompt.
 */
import { render, screen } from "@testing-library/react";
import ChannelLauncher from "./ChannelLauncher";

jest.mock("../lib/scenes", () => ({ listScenes: jest.fn() }));
import { listScenes } from "../lib/scenes";

const mockList = listScenes as jest.MockedFunction<typeof listScenes>;

describe("ChannelLauncher", () => {
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
  });

  it("prompts to create a channel when there are none", async () => {
    mockList.mockResolvedValue([] as Awaited<ReturnType<typeof listScenes>>);
    render(<ChannelLauncher />);
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();
  });
});
