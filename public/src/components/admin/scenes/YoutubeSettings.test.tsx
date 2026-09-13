/**
 * YoutubeSettings — the per-channel YouTube publishing card: title / description
 * templates + thumbnail source, all shipped as ONE full youtube object per delta
 * so the draft's top-level spread-merge can't drop sibling fields.
 */
import { fireEvent, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import YoutubeSettings from "./YoutubeSettings";
import { renderInDraft } from "./draft-harness";

const youtube = (over: Partial<typeof DEFAULT_CONTROL_STATE.youtube> = {}) => ({
  ...DEFAULT_CONTROL_STATE.youtube,
  ...over,
});

describe("YoutubeSettings", () => {
  it("stages a description change with the FULL youtube object in the delta", () => {
    const d = renderInDraft(<YoutubeSettings />, {
      state: { youtube: youtube({ title: "Wind %d/%m" }) },
    });
    fireEvent.change(screen.getByLabelText(/youtube description/i), {
      target: { value: "Gusts on %A" },
    });

    expect(d.last()).toEqual({
      youtube: youtube({ title: "Wind %d/%m", description: "Gusts on %A" }),
    });
  });

  it("stages the thumbnail source and previews it", () => {
    const d = renderInDraft(<YoutubeSettings />);
    fireEvent.change(screen.getByLabelText(/thumbnail image/i), {
      target: { value: "/thumbs/wind.png" },
    });

    expect(d.last()).toEqual({ youtube: youtube({ thumbnailUrl: "/thumbs/wind.png" }) });
    expect(screen.getByAltText(/thumbnail preview/i)).toHaveAttribute(
      "src",
      expect.stringMatching(/\/thumbs\/wind\.png$/),
    );
  });

  it("flags a thumbnail source that is neither a URL nor a site path", () => {
    renderInDraft(<YoutubeSettings />);
    fireEvent.change(screen.getByLabelText(/thumbnail image/i), { target: { value: "wind.png" } });
    expect(screen.getByText(/http\(s\) URL or a site path/i)).toBeInTheDocument();
  });

  it("previews the built-in description when the template is empty", async () => {
    renderInDraft(<YoutubeSettings />);
    expect(await screen.findByText(/This is our live weather globe/)).toBeInTheDocument();
  });
});
