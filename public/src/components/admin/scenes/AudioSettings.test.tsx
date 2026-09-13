/**
 * AudioSettings — the per-channel music-bed editor: the master toggle plus
 * mode / mute / volume, all shipped as ONE full audio object per delta so the
 * draft's top-level spread-merge can't drop sibling fields.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import AudioSettings from "./AudioSettings";
import { renderInDraft } from "./draft-harness";

const audio = (over: Partial<typeof DEFAULT_CONTROL_STATE.audio> = {}) => ({
  ...DEFAULT_CONTROL_STATE.audio,
  ...over,
});

describe("AudioSettings", () => {
  it("turns the bed on with the FULL audio object in the delta", () => {
    const d = renderInDraft(<AudioSettings />);
    const toggle = screen.getByRole("checkbox", { name: "Music" });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(d.last()).toEqual({ audio: audio({ enabled: true }) });
  });

  it("pins the arrangement mode", () => {
    const d = renderInDraft(<AudioSettings />, { state: { audio: audio({ enabled: true }) } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Mode" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Deep House"));

    expect(d.last()).toEqual({ audio: audio({ enabled: true, mode: "deep" }) });
  });

  it("mutes without losing the volume level", () => {
    const d = renderInDraft(<AudioSettings />, {
      state: { audio: audio({ enabled: true, volume: 0.4 }) },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mute" }));

    expect(d.last()).toEqual({ audio: audio({ enabled: true, volume: 0.4, muted: true }) });
  });

  it("changes the volume", () => {
    const d = renderInDraft(<AudioSettings />, { state: { audio: audio({ enabled: true }) } });
    fireEvent.change(screen.getByRole("slider", { name: "Audio volume" }), {
      target: { value: 0.25 },
    });

    expect(d.last()).toEqual({ audio: audio({ enabled: true, volume: 0.25 }) });
  });

  it("disables mode/mute/volume while the bed is off", () => {
    renderInDraft(<AudioSettings />);
    // MUI renders the select as a div — disabled surfaces as aria-disabled.
    expect(screen.getByLabelText("Audio mode")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: "Mute" })).toBeDisabled();
  });
});
