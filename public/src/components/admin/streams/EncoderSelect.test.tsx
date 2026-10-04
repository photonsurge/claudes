/**
 * EncoderSelect — every occupancy state shown (§6.2), what a video can and
 * can't be queued on, and channel forms never offering a video encoder (§6.6).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import EncoderSelect from "./EncoderSelect";
import type { EncoderWithOccupancy } from "../../../lib/renders";

const enc = (id: string, use: "channels" | "videos", occupancy?: EncoderWithOccupancy["occupancy"], enabled = true): EncoderWithOccupancy => ({
  id,
  name: id.toUpperCase(),
  url: `ws://${id}`,
  enabled,
  hasPassword: false,
  use,
  occupancy,
});

const occ = (state: string, label: string, canQueueVideo: boolean) => ({ state, label, canQueueVideo, queued: 0 }) as EncoderWithOccupancy["occupancy"];

const ENCODERS: EncoderWithOccupancy[] = [
  enc("main", "channels", occ("live", "live: Main channel, since 14:02, until 14:32", false)),
  enc("slotted", "channels", occ("held", "held by always-on slot Main", false)),
  enc("spare", "channels", occ("free", "free", true)),
  enc("v1", "videos", occ("rendering", "rendering: Europe round-up, 2 more queued", true)),
  enc("v2", "videos", occ("booked", "free, batch booked 18:00", true)),
  enc("v3", "videos", occ("disabled", "disabled", false), false),
];

const open = () => fireEvent.mouseDown(screen.getByRole("combobox"));
const option = (name: RegExp) => screen.getByRole("option", { name });

describe("EncoderSelect for a video", () => {
  it("lists video encoders first, then Any, then channel encoders, each with its state", () => {
    render(<EncoderSelect purpose="video" encoders={ENCODERS} value="v1" onChange={jest.fn()} />);
    open();
    const names = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual([
      "V1rendering: Europe round-up, 2 more queued",
      "V2free, batch booked 18:00",
      "V3disabled",
      "Any video encoderthe first idle video encoder takes it",
      "Channel encoders",
      "MAINlive: Main channel, since 14:02, until 14:32",
      "SLOTTEDheld by always-on slot Main",
      "SPAREfree",
    ]);
  });

  it("a live, held or disabled encoder can't be chosen; a rendering one can (it queues)", () => {
    const onChange = jest.fn();
    render(<EncoderSelect purpose="video" encoders={ENCODERS} value="v2" onChange={onChange} />);
    open();
    expect(option(/^MAIN/)).toHaveAttribute("aria-disabled", "true");
    expect(option(/^SLOTTED/)).toHaveAttribute("aria-disabled", "true");
    expect(option(/^V3/)).toHaveAttribute("aria-disabled", "true");
    expect(option(/^V1/)).not.toHaveAttribute("aria-disabled");
    fireEvent.click(option(/^V1/));
    expect(onChange).toHaveBeenCalledWith("v1");
  });

  it("warns when a channel encoder is picked for a video", () => {
    render(<EncoderSelect purpose="video" encoders={ENCODERS} value="spare" onChange={jest.fn()} />);
    expect(screen.getByText(/A channel encoder/)).toBeInTheDocument();
  });

  it("shows the picked encoder with its state", () => {
    render(<EncoderSelect purpose="video" encoders={ENCODERS} value="v1" onChange={jest.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("V1 · rendering: Europe round-up, 2 more queued");
  });
});

describe("EncoderSelect for a channel", () => {
  it("never offers an encoder assigned to videos", () => {
    render(<EncoderSelect purpose="channel" encoders={ENCODERS} value="" onChange={jest.fn()} />);
    open();
    const names = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["auto", "MAINlive: Main channel, since 14:02, until 14:32", "SLOTTEDheld by always-on slot Main", "SPAREfree"]);
  });

  it("greys out a disabled encoder", () => {
    render(<EncoderSelect purpose="channel" encoders={[enc("off", "channels", undefined, false)]} value="" onChange={jest.fn()} />);
    open();
    expect(option(/^OFF/)).toHaveAttribute("aria-disabled", "true");
  });
});
