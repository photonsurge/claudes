/**
 * The schedule editor (§8): validation blocks a bad save, videos reorder,
 * the round-up slot hint says when each place's round-up is written, the
 * quota-hour warning (§13) shows without blocking, the Morning batch preset
 * saves Europe, the UK and the main areas, and skip-if-quiet needs an event
 * switch.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_ROUNDUP_SETTINGS, sanitizeRoundupSettings } from "@photonsurge/shared/roundup-settings";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import type { ShortSchedule } from "@photonsurge/shared/short-schedule";
import { MAIN_AREAS_PLACES } from "@photonsurge/shared/short-script";
import ScheduleEditor from "./ScheduleEditor";
import { morningBatchDraft, type ScheduleInput } from "../../../lib/short-schedules";
import type { EncoderWithOccupancy } from "../../../lib/renders";

// The editor is a big form (the title card's token chips per video): its queries are slow in jsdom.
jest.setTimeout(30_000);

const NOW = Date.parse("2026-10-04T12:00:00Z"); // Sunday, London on BST

const ENCODERS: EncoderWithOccupancy[] = [
  { id: "main", name: "Main rig", url: "ws://m", enabled: true, hasPassword: true, use: "channels" },
  {
    id: "v1",
    name: "Video 1",
    url: "ws://v1",
    enabled: true,
    hasPassword: true,
    use: "videos",
    occupancy: { state: "free", label: "free", canQueueVideo: true, queued: 0 } as EncoderWithOccupancy["occupancy"],
  },
];

const stored: ShortSchedule = {
  id: "sch1",
  name: "Europe and UK",
  enabled: true,
  when: { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:15", tz: "Europe/London" },
  encoderId: "v1",
  offline: false,
  startByMs: 3_600_000,
  videos: [
    { formatId: "shorts", what: { type: "template", scope: { type: "area", id: "europe" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
    { formatId: "shorts", what: { type: "template", scope: { type: "country", id: "uk" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
  ],
  fireCount: 0,
  nextAt: null,
};

function setup(opts: { schedule?: ShortSchedule | null; preset?: ReturnType<typeof morningBatchDraft> } = {}) {
  const ok = (input: ScheduleInput) => ({ ok: true as const, data: { ...stored, ...input, accountId: undefined } });
  const create = jest.fn(async (input: ScheduleInput) => ok(input));
  const save = jest.fn(async (_id: string, input: ScheduleInput) => ok(input));
  const onSaved = jest.fn();
  render(
    <ScheduleEditor
      open
      schedule={opts.schedule === undefined ? stored : opts.schedule}
      preset={opts.preset}
      onClose={() => {}}
      onSaved={onSaved}
      formats={[{ id: "shorts", name: "Round-up" }]}
      scripts={[{ id: "s1", title: "World round-up", formatId: "shorts" }]}
      loadOptions={async () => ({ encoders: ENCODERS, accounts: [{ channelId: "UC1", channelTitle: "Weather Globe" }] })}
      loadSettings={async () => ({ settings: sanitizeRoundupSettings(DEFAULT_ROUNDUP_SETTINGS) })}
      loadFormat={async (id) => ({ ok: true, data: { ...defaultShortFormat(id, "Round-up") } })}
      create={create}
      save={save}
      now={() => NOW}
    />,
  );
  return { create, save, onSaved };
}

it("refuses to save without a name, days or a valid zone, and says why", async () => {
  const { save } = setup();
  await screen.findAllByTestId("slot-hint");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
  const days = screen.getByRole("group", { name: "Days" });
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) fireEvent.click(within(days).getByText(day));
  fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Mars/Olympus" } });
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("Give the schedule a name.")).toBeInTheDocument();
  expect(screen.getByText("Pick at least one day.")).toBeInTheDocument();
  expect(screen.getByText("An IANA time zone, like Europe/London.")).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it("a new schedule needs a video", async () => {
  const { create } = setup({ schedule: null });
  fireEvent.click(await screen.findByRole("button", { name: "Create schedule" }));
  expect(await screen.findByText("Add at least one video.")).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Add a video"));
  fireEvent.click(screen.getByText("Create schedule"));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0].videos).toEqual([
    { formatId: "shorts", what: { type: "template", scope: { type: "globe" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
  ]);
});

it("reorders videos, and saves them in the new order", async () => {
  const { save } = setup();
  await screen.findAllByTestId("slot-hint");
  expect(screen.getByLabelText("Move video 1 up")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Move video 1 down"));
  expect(screen.getByTestId("video-0")).toHaveTextContent(/^1\. \S+ United Kingdom/);
  fireEvent.click(screen.getByLabelText("Remove video 2"));
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const [id, input] = save.mock.calls[0];
  expect(id).toBe("sch1");
  expect(input.videos.map((v) => v.what)).toEqual([{ type: "template", scope: { type: "country", id: "uk" } }]);
  expect(input).toMatchObject({ encoderId: "v1", enabled: true, when: stored.when, startByMs: 3_600_000, accountId: "" });
});

it("shows when each place's round-up is next written, in London time", async () => {
  setup();
  const [europe, uk] = await screen.findAllByTestId("slot-hint");
  // Europe phases at +1: 06:00 / 18:00 local are 06:00 / 18:00 London in summer.
  expect(europe).toHaveTextContent("Europe's round-up is written at 06:00 and 18:00 local; next Sun 4 Oct 18:00 London.");
  expect(europe).toHaveTextContent("latest is from Mon 5 Oct 06:00 London, 2.3 h old");
  // The UK phases at 0: 06:00 local is 07:00 London (BST).
  expect(uk).toHaveTextContent("next Sun 4 Oct 19:00 London");
  expect(uk).toHaveTextContent("1.3 h old");
});

it("warns, without blocking, when the batch runs in the quota day's last hour", async () => {
  const { save } = setup();
  await screen.findAllByTestId("slot-hint");
  expect(screen.queryByTestId("quota-warning")).toBeNull();
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "07:00" } });
  const warning = await screen.findByTestId("quota-warning");
  expect(warning).toHaveTextContent("Mon 5 Oct 07:00 London");
  expect(warning).toHaveTextContent("08:00 London");
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].when).toMatchObject({ time: "07:00" });
});

it("Morning batch: Europe, the UK and the main areas, every day at 08:15 London on the video encoder", async () => {
  const { create } = setup({ schedule: null, preset: morningBatchDraft(NOW) });
  expect(await screen.findByLabelText("Name")).toHaveValue("Morning batch");
  await waitFor(() => expect(screen.getAllByTestId("slot-hint")).toHaveLength(3));
  expect(screen.getByLabelText("Places in order")).toHaveTextContent("Europe");
  fireEvent.click(screen.getByText("Create schedule"));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const input = create.mock.calls[0][0];
  expect(input.encoderId).toBe("v1");
  expect(input.when).toEqual({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:15", tz: "Europe/London" });
  expect(input.videos.map((v) => v.what)).toEqual([
    { type: "template", scope: { type: "area", id: "europe" } },
    { type: "template", scope: { type: "country", id: "uk" } },
    { type: "template", scope: { type: "places", places: [...MAIN_AREAS_PLACES] } },
  ]);
});

it("skip-if-quiet needs an event switch; per-video title and privacy overrides are saved", async () => {
  const { save } = setup();
  await screen.findAllByTestId("slot-hint");
  const card = screen.getByTestId("video-0");
  const quiet = within(card).getByRole("switch", { name: "Skip if quiet" });
  expect(quiet).toBeDisabled();
  fireEvent.click(within(card).getByRole("switch", { name: "The format's event switches" }));
  fireEvent.click(within(card).getByRole("switch", { name: "Alerts" }));
  expect(quiet).toBeEnabled();
  fireEvent.click(quiet);

  fireEvent.change(within(card).getByRole("textbox", { name: "Title" }), { target: { value: "Europe this morning · %A" } });
  expect(within(card).getByTestId("video-title-preview")).toHaveTextContent(/^Europe this morning · \w+day/);
  fireEvent.mouseDown(within(card).getByRole("combobox", { name: "Publish as" }));
  fireEvent.click(await screen.findByRole("option", { name: "Public" }));

  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const v = save.mock.calls[0][1].videos[0];
  expect(v.what).toEqual({
    type: "template",
    scope: { type: "area", id: "europe" },
    include: { alerts: true, quakes: false, volcanoes: false },
  });
  expect(v.skipIfQuiet).toBe(true);
  expect(v.video).toEqual({ title: "Europe this morning · %A", publishAs: "public" });
});
