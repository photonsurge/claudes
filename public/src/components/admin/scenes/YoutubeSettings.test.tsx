/**
 * YoutubeSettings — the per-channel YouTube publishing card: title / description
 * templates + thumbnail source, all shipped as ONE full youtube object per delta
 * so the draft's top-level spread-merge can't drop sibling fields.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import YoutubeSettings from "./YoutubeSettings";

const patch = jest.fn();
jest.mock("../../../lib/scenes", () => ({
  fetchSceneState: jest.fn(),
  useScenePatcher: () => patch,
}));
import { fetchSceneState } from "../../../lib/scenes";
const mockFetch = fetchSceneState as jest.MockedFunction<typeof fetchSceneState>;

const withYoutube = (over: Partial<typeof DEFAULT_CONTROL_STATE.youtube>) => ({
  ...DEFAULT_CONTROL_STATE,
  youtube: { ...DEFAULT_CONTROL_STATE.youtube, ...over },
});

beforeEach(() => {
  patch.mockClear();
  mockFetch.mockResolvedValue({ state: { ...DEFAULT_CONTROL_STATE }, tokenError: false });
});

describe("YoutubeSettings", () => {
  it("stages a description change with the FULL youtube object in the delta", async () => {
    mockFetch.mockResolvedValue({ state: withYoutube({ title: "Wind %d/%m" }), tokenError: false });
    render(<YoutubeSettings sceneId="wind" />);
    const description = await screen.findByLabelText(/youtube description/i);
    fireEvent.change(description, { target: { value: "Gusts on %A" } });

    expect(patch).toHaveBeenCalledWith("wind", {
      youtube: { ...DEFAULT_CONTROL_STATE.youtube, title: "Wind %d/%m", description: "Gusts on %A" },
    });
  });

  it("stages the thumbnail source and previews it", async () => {
    render(<YoutubeSettings sceneId="wind" />);
    const thumb = await screen.findByLabelText(/thumbnail image/i);
    fireEvent.change(thumb, { target: { value: "/thumbs/wind.png" } });

    expect(patch).toHaveBeenCalledWith("wind", {
      youtube: { ...DEFAULT_CONTROL_STATE.youtube, thumbnailUrl: "/thumbs/wind.png" },
    });
    expect(screen.getByAltText(/thumbnail preview/i)).toHaveAttribute("src", expect.stringMatching(/\/thumbs\/wind\.png$/));
  });

  it("flags a thumbnail source that is neither a URL nor a site path", async () => {
    render(<YoutubeSettings sceneId="wind" />);
    const thumb = await screen.findByLabelText(/thumbnail image/i);
    fireEvent.change(thumb, { target: { value: "wind.png" } });
    expect(screen.getByText(/http\(s\) URL or a site path/i)).toBeInTheDocument();
  });

  it("previews the built-in description when the template is empty", async () => {
    render(<YoutubeSettings sceneId="wind" />);
    await screen.findByLabelText(/youtube description/i);
    expect(await screen.findByText(/This is our live weather globe/)).toBeInTheDocument();
  });
});
