/**
 * AboutCardSettings — the per-channel ABOUT card copy editor: title / body /
 * data sources / footnote, all shipped as ONE full about object per delta so
 * the draft's top-level spread-merge can't drop sibling fields.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import AboutCardSettings from "./AboutCardSettings";

const patch = jest.fn();
jest.mock("../../../lib/scenes", () => ({
  fetchSceneState: jest.fn(),
  useScenePatcher: () => patch,
}));
import { fetchSceneState } from "../../../lib/scenes";
const mockFetch = fetchSceneState as jest.MockedFunction<typeof fetchSceneState>;

const withAbout = (over: Partial<typeof DEFAULT_CONTROL_STATE.about>) => ({
  ...DEFAULT_CONTROL_STATE,
  about: { ...DEFAULT_CONTROL_STATE.about, ...over },
});

beforeEach(() => {
  patch.mockClear();
  mockFetch.mockResolvedValue({ state: { ...DEFAULT_CONTROL_STATE }, tokenError: false });
});

describe("AboutCardSettings", () => {
  it("stages a title change with the FULL about object in the delta", async () => {
    render(<AboutCardSettings sceneId="wind" />);
    const title = await screen.findByRole("textbox", { name: "About title" });
    fireEvent.change(title, { target: { value: "About Storm Watch" } });

    expect(patch).toHaveBeenCalledWith("wind", {
      about: { ...DEFAULT_CONTROL_STATE.about, title: "About Storm Watch" },
    });
  });

  it("stages the data-sources line without dropping existing copy", async () => {
    mockFetch.mockResolvedValue({
      state: withAbout({ title: "About Storm Watch", body: "Custom body." }),
      tokenError: false,
    });
    render(<AboutCardSettings sceneId="wind" />);
    const sources = await screen.findByRole("textbox", { name: "About sources" });
    fireEvent.change(sources, { target: { value: "NOAA GFS, USGS" } });

    expect(patch).toHaveBeenCalledWith("wind", {
      about: {
        ...DEFAULT_CONTROL_STATE.about,
        title: "About Storm Watch",
        body: "Custom body.",
        sources: "NOAA GFS, USGS",
      },
    });
  });

  it("stages the footnote", async () => {
    render(<AboutCardSettings sceneId="wind" />);
    const footer = await screen.findByRole("textbox", { name: "About footnote" });
    fireEvent.change(footer, { target: { value: "Custom small print." } });

    expect(patch).toHaveBeenCalledWith("wind", {
      about: { ...DEFAULT_CONTROL_STATE.about, footer: "Custom small print." },
    });
  });

  it("shows the channel's saved copy once loaded", async () => {
    mockFetch.mockResolvedValue({
      state: withAbout({ body: "What this channel is.", sources: "NOAA GFS" }),
      tokenError: false,
    });
    render(<AboutCardSettings sceneId="wind" />);

    expect(await screen.findByDisplayValue("What this channel is.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("NOAA GFS")).toBeInTheDocument();
  });
});
