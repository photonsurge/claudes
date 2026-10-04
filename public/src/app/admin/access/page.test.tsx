/**
 * /admin/access — the tokened OBS URL per channel is built with `watchPath`, so
 * a crossword channel's URL points at its own watch page.
 */
import { render, screen } from "@testing-library/react";
import AccessPage from "./page";

jest.mock("../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [
    { id: "wind", name: "Atlantic Wind", watchToken: "tok-w" },
    { id: "word-up", name: "Word Up", surface: "crossword", watchToken: "tok-x" },
    { id: "fresh", name: "Fresh", surface: "crossword" },
  ]),
  rotateSceneToken: jest.fn(),
}));

describe("Access page", () => {
  it("builds each tokened URL with the channel's own watch path", async () => {
    render(<AccessPage />);
    const origin = window.location.origin;
    expect(await screen.findByText(`${origin}/watch/wind?token=tok-w`)).toBeInTheDocument();
    expect(screen.getByText(`${origin}/watch/crossword/word-up?token=tok-x`)).toBeInTheDocument();
    expect(screen.getAllByText("Crossword")).toHaveLength(2);
  });

  it("still offers to generate a token for a channel without one", async () => {
    render(<AccessPage />);
    expect(await screen.findByText(/no token yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate token" })).toBeInTheDocument();
  });
});
