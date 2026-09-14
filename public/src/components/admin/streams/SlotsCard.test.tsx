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

    expect(onSave).toHaveBeenCalledWith(
      // Chat defaults ON — the chat log only records while a run's poller runs.
      expect.objectContaining({ sceneId: "wind", enabled: false, chat: { enabled: true, promoteToTicker: false } }),
    );
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
    fireEvent.mouseDown(within(form).getByLabelText("restart"));
    fireEvent.click(screen.getByRole("option", { name: "24h" }));
    fireEvent.click(within(form).getByRole("checkbox", { name: "monitor" }));
    fireEvent.click(within(form).getByRole("checkbox", { name: "📣 notify" }));
    // chat is already checked by default; only opt into ticker promotion
    fireEvent.click(within(form).getByRole("checkbox", { name: "→ ticker" }));
    fireEvent.click(screen.getByRole("button", { name: "Add stream" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: "wind",
        accountId: "chan-1",
        restartEveryMs: 24 * 3_600_000,
        monitorStream: true,
        chat: { enabled: true, promoteToTicker: true },
        announce: true,
        enabled: false,
      }),
    );
  });

  it("warns when a slot's cadence means YouTube won't archive its videos", () => {
    render(
      <SlotsCard
        slots={[slot({ id: "s-never", restartEveryMs: null }), slot({ id: "s-6h", restartEveryMs: 6 * 3_600_000 }), slot({ id: "s-12h", restartEveryMs: 12 * 3_600_000 })]}
        scenes={SCENES}
        encoders={ENCODERS}
        runs={[]}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getAllByText("no VOD")).toHaveLength(2);
  });

  it("changing a row's restart interval saves restartEveryMs on the slot", () => {
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

    // First "restart" select is the row's (the add form renders after the rows).
    fireEvent.mouseDown(screen.getAllByLabelText("restart")[0]);
    fireEvent.click(screen.getByRole("option", { name: "12h" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", restartEveryMs: 12 * 3_600_000 }));
  });

  it("offers an 11h cadence — the longest one YouTube still archives", () => {
    const onSave = jest.fn(async () => ({}));
    render(
      <SlotsCard
        slots={[
          slot({ id: "s1", runId: "r1", restartEveryMs: 6 * 3_600_000 }),
          slot({ id: "s2", restartEveryMs: 11 * 3_600_000 }),
        ]}
        scenes={SCENES}
        encoders={ENCODERS}
        runs={[liveRun()]}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );

    // 11h sits under the 12h archive cut-off, so that row keeps its VOD.
    expect(screen.queryByText("no VOD")).not.toBeInTheDocument();

    // A row select, then the add form's — both read the same cadence list.
    fireEvent.mouseDown(screen.getAllByLabelText("restart")[0]);
    fireEvent.click(screen.getByRole("option", { name: "11h" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", restartEveryMs: 11 * 3_600_000 }));

    fireEvent.mouseDown(screen.getAllByLabelText("restart")[2]);
    expect(screen.getByRole("option", { name: "11h" })).toBeInTheDocument();
  });

  it("toggling a row's 📣 saves the announce flag on the slot", () => {
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

    // Exact-name match: the row checkbox is "📣", the add form's is "📣 notify".
    fireEvent.click(screen.getByRole("checkbox", { name: "📣" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", announce: true }));
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
