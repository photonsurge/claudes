/**
 * SlotsCard — persistent-stream rows: status derivation from the backing run,
 * the enable switch as the on/off control, and the add form.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  const openAdd = () => {
    fireEvent.click(screen.getByRole("button", { name: "Add stream" }));
    return screen.getByRole("dialog");
  };
  const pick = (dialog: HTMLElement, label: string, option: string | RegExp) => {
    fireEvent.mouseDown(within(dialog).getByLabelText(label));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };

  it("adds a slot switched OFF, chat on and polling every 2 min", async () => {
    const onSave = jest.fn(async () => ({}));
    render(<SlotsCard slots={[]} scenes={SCENES} encoders={ENCODERS} runs={[]} onSave={onSave} onDelete={jest.fn()} />);

    const dialog = openAdd();
    pick(dialog, "channel", "Wind");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add stream" }));

    expect(onSave).toHaveBeenCalledWith(
      // Chat defaults ON — the chat log only records while a run's poller runs.
      expect.objectContaining({
        sceneId: "wind",
        enabled: false,
        chat: { enabled: true, promoteToTicker: false, pollEveryMs: 120_000 },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("submits the chosen channel, restart, monitor, notify and chat→ticker", () => {
    const onSave = jest.fn(async () => ({}));
    render(
      <SlotsCard slots={[]} scenes={SCENES} encoders={ENCODERS} accounts={ACCOUNTS} runs={[]} onSave={onSave} onDelete={jest.fn()} />,
    );

    const dialog = openAdd();
    pick(dialog, "channel", "Wind");
    pick(dialog, "YouTube", "Weather HD");
    pick(dialog, "restart", "24h");
    expect(within(dialog).getByText(/No VOD/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "monitor stream (YouTube preview)" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "📣 notify" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "→ ticker" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add stream" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: "wind",
        accountId: "chan-1",
        restartEveryMs: 24 * 3_600_000,
        monitorStream: true,
        chat: { enabled: true, promoteToTicker: true, pollEveryMs: 120_000 },
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

  it("Edit opens the slot's saved settings and saves every change, keeping it on", () => {
    const onSave = jest.fn(async () => ({}));
    render(
      <SlotsCard
        slots={[slot({ runId: "r1", restartEveryMs: 6 * 3_600_000, title: "Wind %H:%M", chat: { enabled: true, promoteToTicker: false } })]}
        scenes={SCENES}
        encoders={ENCODERS}
        accounts={ACCOUNTS}
        runs={[liveRun()]}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "edit Wind 24/7" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/This stream is live/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("YouTube title (optional)")).toHaveValue("Wind %H:%M");
    // An existing slot without a setting stays on auto until the operator picks one.
    expect(within(dialog).getByLabelText("chat poll")).toHaveTextContent("auto");

    pick(dialog, "restart", "11h");
    pick(dialog, "encoder", /^Wind rig\b/); // EncoderSelect: the name, then what it is doing
    pick(dialog, "chat poll", "every 5 min · ~1.4k units/day");
    fireEvent.change(within(dialog).getByLabelText("name"), { target: { value: "Wind HD" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "s1",
        name: "Wind HD",
        enabled: true,
        encoderId: "obs-1",
        restartEveryMs: 11 * 3_600_000,
        title: "Wind %H:%M",
        chat: { enabled: true, promoteToTicker: false, pollEveryMs: 300_000 },
      }),
    );
  });

  it("removing from the edit dialog asks first", async () => {
    const onDelete = jest.fn(async () => ({}));
    render(
      <SlotsCard slots={[slot({ runId: "r1" })]} scenes={SCENES} encoders={ENCODERS} runs={[liveRun()]} onSave={jest.fn()} onDelete={onDelete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "edit Wind 24/7" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("This ends the live stream too.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("shows the chat poll interval in the row summary", () => {
    render(
      <SlotsCard
        slots={[slot({ chat: { enabled: true, promoteToTicker: false, pollEveryMs: 120_000 } })]}
        scenes={SCENES}
        encoders={ENCODERS}
        runs={[]}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText(/chat 2 min/)).toBeInTheDocument();
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
