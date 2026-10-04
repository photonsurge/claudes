/**
 * The Schedules section (§8, §6.7): each row's when, next run and last
 * outcome (linking its batch), the enable switch, Run batch now with its
 * "publish as" override, and Delete behind a confirm.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ShortSchedule } from "@photonsurge/shared/short-schedule";
import SchedulesSection from "./SchedulesSection";

const NOW = Date.parse("2026-10-04T12:00:00Z");

const morning: ShortSchedule = {
  id: "sch1",
  name: "Morning batch",
  enabled: true,
  when: { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:15", tz: "Europe/London" },
  encoderId: "v1",
  offline: false,
  startByMs: 3_600_000,
  videos: [
    { formatId: "shorts", what: { type: "template", scope: { type: "area", id: "europe" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
    { formatId: "shorts", what: { type: "template", scope: { type: "country", id: "uk" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
  ],
  fireCount: 3,
  nextAt: Date.parse("2026-10-05T07:15:00Z"),
  lastFire: { at: Date.parse("2026-10-04T07:15:00Z"), batchId: "b-42", outcome: "queued" },
};
const nyc: ShortSchedule = {
  ...morning,
  id: "sch2",
  name: "New York evening",
  enabled: false,
  when: { type: "weekly", days: [1, 2, 3, 4, 5], time: "18:00", tz: "America/New_York" },
  nextAt: null,
  lastFire: { at: Date.parse("2026-10-03T22:00:00Z"), outcome: "missed", note: "worker down" },
};

function setup() {
  const setEnabled = jest.fn(async (id: string, enabled: boolean) => ({ ok: true as const, data: { ...morning, id, enabled } }));
  const runNow = jest.fn(async (id: string) => ({
    ok: true as const,
    data: { ok: true as const, scheduleId: id, batchId: "b-43", n: 2, renders: [] },
  }));
  const remove = jest.fn(async (id: string) => ({ ok: true as const, data: { ok: true as const, id } }));
  const onShowBatch = jest.fn();
  const onQueued = jest.fn();
  render(
    <SchedulesSection
      load={async () => ({ ok: true, data: { schedules: [morning, nyc] } })}
      setEnabled={setEnabled}
      runNow={runNow as never}
      remove={remove}
      onShowBatch={onShowBatch}
      onQueued={onQueued}
      loadOptions={async () => ({ encoders: [], accounts: [] })}
      loadSettings={async () => ({ settings: null as never })}
      now={() => NOW}
    />,
  );
  return { setEnabled, runNow, remove, onShowBatch, onQueued };
}

it("lists each schedule with its when, next run and last outcome", async () => {
  const { onShowBatch } = setup();
  const row = await screen.findByTestId("schedule-sch1");
  expect(within(row).getByText("Morning batch")).toBeInTheDocument();
  expect(row).toHaveTextContent("Every day 08:15 Europe/London");
  expect(within(row).getByTestId("next-run")).toHaveTextContent("Mon 5 Oct 08:15 London");
  expect(within(row).getByTestId("last-fire")).toHaveTextContent("queued");
  fireEvent.click(within(row).getByRole("button", { name: "Show its renders" }));
  expect(onShowBatch).toHaveBeenCalledWith("b-42");

  const other = screen.getByTestId("schedule-sch2");
  expect(other).toHaveTextContent("Weekdays 18:00 America/New_York");
  expect(within(other).getByTestId("next-run")).toHaveTextContent("off");
  expect(within(other).getByTestId("last-fire")).toHaveTextContent("missed");
  expect(within(other).getByTestId("last-fire")).toHaveTextContent("worker down");
  expect(within(other).queryByRole("button", { name: "Show its renders" })).toBeNull();
});

it("switches a schedule on", async () => {
  const { setEnabled } = setup();
  fireEvent.click(await screen.findByRole("switch", { name: "Enable New York evening" }));
  await waitFor(() => expect(setEnabled).toHaveBeenCalledWith("sch2", true));
});

it("Run batch now asks first, then queues as each format says", async () => {
  const { runNow, onQueued } = setup();
  const row = await screen.findByTestId("schedule-sch1");
  fireEvent.click(within(row).getByRole("button", { name: "Run batch now" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Run “Morning batch” now?");
  expect(within(dialog).getByRole("combobox", { name: "Publish as" })).toHaveTextContent("As each format says");
  fireEvent.click(within(dialog).getByRole("button", { name: "Queue batch" }));
  await waitFor(() => expect(runNow).toHaveBeenCalledWith("sch1", undefined));
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ batchId: "b-43", n: 2 })));
  expect(await screen.findByText(/Queued 2 videos from “Morning batch”/)).toBeInTheDocument();
});

it("Run batch now with everything unlisted (§8.1 step 5)", async () => {
  const { runNow } = setup();
  const row = await screen.findByTestId("schedule-sch1");
  fireEvent.click(within(row).getByRole("button", { name: "Run batch now" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.mouseDown(within(dialog).getByRole("combobox", { name: "Publish as" }));
  fireEvent.click(await screen.findByRole("option", { name: "All unlisted" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Queue batch" }));
  await waitFor(() => expect(runNow).toHaveBeenCalledWith("sch1", "unlisted"));
  expect(await screen.findByText(/all unlisted/)).toBeInTheDocument();
});

it("deletes only after the confirm", async () => {
  const { remove } = setup();
  const row = await screen.findByTestId("schedule-sch2");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("sch2"));
});
