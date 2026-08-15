/**
 * SlotsCard — persistent-stream rows: status derivation from the backing run,
 * the enable switch as the on/off control, and the add form.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import SlotsCard from "./SlotsCard";
import type { RunState, StreamEncoderInfo, StreamSlot } from "@photonsurge/shared/runs";
import type { SceneMeta } from "@photonsurge/shared/control";

const SCENES: SceneMeta[] = [{ id: "wind", name: "Wind" }] as SceneMeta[];
const ENCODERS: StreamEncoderInfo[] = [
  { id: "obs-1", name: "Wind rig", url: "ws://x:4455", enabled: true, hasPassword: false },
];
const ACCOUNTS = [{ channelId: "chan-1", channelTitle: "Weather HD" }];

const slot = (over: Partial<StreamSlot> = {}): StreamSlot => ({
  id: "s1",
  name: "Wind 24/7",
  sceneId: "wind",
  enabled: true,
  ...over,
});

const liveRun = (over: Partial<RunState> = {}): RunState =>
  ({
    id: "r1",
    sceneId: "wind",
    status: "live",
    needsManualObs: false,
    youtube: { bound: true, watchUrl: "https://youtu.be/abc" },
    ...over,
  }) as RunState;

describe("SlotsCard", () => {
  it("shows a live slot with its watch link", () => {
    render(
      <SlotsCard
        slots={[slot({ runId: "r1" })]}
        scenes={SCENES}
        encoders={ENCODERS}
        runs={[liveRun()]}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Watch ↗" })).toHaveAttribute("href", "https://youtu.be/abc");
  });

  it("shows starting… for an enabled slot the reconciler hasn't served yet", () => {
    render(
      <SlotsCard slots={[slot()]} scenes={SCENES} encoders={ENCODERS} runs={[]} onSave={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(screen.getByText("starting…")).toBeInTheDocument();
  });

  it("shows the retry count while a slot is backing off", () => {
    render(
      <SlotsCard
        slots={[slot({ runId: "r1", failCount: 3 })]}
        scenes={SCENES}
        encoders={ENCODERS}
        runs={[liveRun({ status: "failed" }) as RunState]}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText("retrying (3)")).toBeInTheDocument();
  });

  it("switching a slot off saves enabled:false (the stream's off switch)", () => {
    const onSave = jest.fn(async () => ({}));
    render(
      <SlotsCard
        slots={[slot({ runId: "r1" })]}
        scenes={SCENES}
        encoders={ENCODERS}
        runs={[liveRun()]}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "enable Wind 24/7" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", enabled: false }));
  });

  it("adds a slot switched OFF — the switch is the go-live control", () => {
    const onSave = jest.fn(async () => ({}));
    render(<SlotsCard slots={[]} scenes={SCENES} encoders={ENCODERS} runs={[]} onSave={onSave} onDelete={jest.fn()} />);

    const form = screen.getByRole("button", { name: "Add stream" }).closest("div") as HTMLElement;
    fireEvent.mouseDown(within(form).getByLabelText("channel"));
    fireEvent.click(screen.getByRole("option", { name: "Wind" }));
    fireEvent.click(screen.getByRole("button", { name: "Add stream" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sceneId: "wind", enabled: false }));
  });

  it("submits the chosen channel, monitor and chat→ticker", () => {
    const onSave = jest.fn(async () => ({}));
    render(
      <SlotsCard
        slots={[]}
        scenes={SCENES}
        encoders={ENCODERS}
        accounts={ACCOUNTS}
        runs={[]}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );

    const form = screen.getByRole("button", { name: "Add stream" }).closest("div") as HTMLElement;
    fireEvent.mouseDown(within(form).getByLabelText("channel"));
    fireEvent.click(screen.getByRole("option", { name: "Wind" }));
    fireEvent.mouseDown(within(form).getByLabelText("YouTube"));
    fireEvent.click(screen.getByRole("option", { name: "Weather HD" }));
    fireEvent.click(within(form).getByRole("checkbox", { name: "monitor" }));
    fireEvent.click(within(form).getByRole("checkbox", { name: "chat" }));
    fireEvent.click(within(form).getByRole("checkbox", { name: "→ ticker" }));
    fireEvent.click(screen.getByRole("button", { name: "Add stream" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: "wind",
        accountId: "chan-1",
        monitorStream: true,
        chat: { enabled: true, promoteToTicker: true },
        enabled: false,
      }),
    );
  });

  it("shows a slot's chosen channel title in its summary", () => {
    render(
      <SlotsCard
        slots={[slot({ runId: "r1", accountId: "chan-1" })]}
        scenes={SCENES}
        encoders={ENCODERS}
        accounts={ACCOUNTS}
        runs={[liveRun()]}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText(/Weather HD/)).toBeInTheDocument();
  });
});
