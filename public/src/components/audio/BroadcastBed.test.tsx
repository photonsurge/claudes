import { render, screen, act } from "@testing-library/react";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import BroadcastBed from "./BroadcastBed";

// Mock the Web Audio engine — jsdom has no AudioContext. Each render constructs
// one bed; tests grab the latest instance to assert the calls driven by props.
jest.mock("../../lib/audio/engine", () => {
  const instances: unknown[] = [];
  class MockAuroraBed {
    playing = false;
    ctxState: string | null = "running";
    start = jest.fn(() => {
      this.playing = true;
    });
    stop = jest.fn(() => {
      this.playing = false;
    });
    setMasterVolume = jest.fn();
    setMode = jest.fn();
    setSeverity = jest.fn();
    triggerEvent = jest.fn();
    contextState = jest.fn(() => this.ctxState);
    constructor() {
      instances.push(this);
    }
  }
  return { AuroraBed: MockAuroraBed, __instances: instances };
});

type MockBed = {
  playing: boolean;
  ctxState: string | null;
  start: jest.Mock;
  stop: jest.Mock;
  setMasterVolume: jest.Mock;
  setMode: jest.Mock;
  setSeverity: jest.Mock;
  triggerEvent: jest.Mock;
};

const lastBed = (): MockBed => {
  const { __instances } = jest.requireMock("../../lib/audio/engine") as { __instances: MockBed[] };
  return __instances[__instances.length - 1];
};

const audio = (p: Partial<AudioSettings> = {}): AudioSettings => ({ ...DEFAULT_AUDIO_SETTINGS, ...p });

const stormSegment: Segment = {
  id: "storm:abc",
  kind: "storm",
  title: "Severe Storm",
  camera: { center: [0, 0], zoom: 3 },
  patch: {},
  holdMs: 30000,
};

describe("BroadcastBed", () => {
  it("starts the bed and applies volume + mode when enabled", () => {
    render(<BroadcastBed audio={audio({ enabled: true, mode: "deep", volume: 0.5 })} />);
    const bed = lastBed();
    expect(bed.start).toHaveBeenCalled();
    expect(bed.setMasterVolume).toHaveBeenCalledWith(0.5);
    expect(bed.setMode).toHaveBeenCalledWith("deep");
  });

  it("does not start while disabled, and stops when disabled again", () => {
    const { rerender } = render(<BroadcastBed audio={audio()} />);
    const bed = lastBed();
    expect(bed.start).not.toHaveBeenCalled();
    rerender(<BroadcastBed audio={audio({ enabled: true })} />);
    expect(bed.start).toHaveBeenCalled();
    rerender(<BroadcastBed audio={audio({ enabled: false })} />);
    expect(bed.stop).toHaveBeenCalled();
  });

  it("mutes to zero gain but keeps the volume setting for unmute", () => {
    const { rerender } = render(<BroadcastBed audio={audio({ enabled: true, volume: 0.8 })} />);
    const bed = lastBed();
    expect(bed.setMasterVolume).toHaveBeenLastCalledWith(0.8);
    rerender(<BroadcastBed audio={audio({ enabled: true, volume: 0.8, muted: true })} />);
    expect(bed.setMasterVolume).toHaveBeenLastCalledWith(0);
    rerender(<BroadcastBed audio={audio({ enabled: true, volume: 0.8, muted: false })} />);
    expect(bed.setMasterVolume).toHaveBeenLastCalledWith(0.8);
  });

  it("maps the on-air segment to severity and pulses new severe events", () => {
    const { rerender } = render(<BroadcastBed audio={audio({ enabled: true })} />);
    const bed = lastBed();
    expect(bed.setSeverity).toHaveBeenLastCalledWith(0.15); // idle
    rerender(<BroadcastBed audio={audio({ enabled: true })} segment={stormSegment} />);
    expect(bed.setSeverity).toHaveBeenLastCalledWith(0.9);
    expect(bed.triggerEvent).toHaveBeenCalledTimes(1);
    // Same event stays on air across re-renders → no repeated riser.
    rerender(<BroadcastBed audio={audio({ enabled: true })} segment={{ ...stormSegment }} />);
    expect(bed.triggerEvent).toHaveBeenCalledTimes(1);
  });

  it("shows the blocked badge while the context stays suspended", () => {
    jest.useFakeTimers();
    try {
      render(<BroadcastBed audio={audio({ enabled: true })} />);
      lastBed().ctxState = "suspended";
      act(() => {
        jest.advanceTimersByTime(700);
      });
      expect(screen.getByText(/Audio bed blocked/)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("renders nothing when audio is flowing normally", () => {
    jest.useFakeTimers();
    try {
      const { container } = render(<BroadcastBed audio={audio({ enabled: true })} />);
      act(() => {
        jest.advanceTimersByTime(700);
      });
      expect(container).toBeEmptyDOMElement();
    } finally {
      jest.useRealTimers();
    }
  });
});
