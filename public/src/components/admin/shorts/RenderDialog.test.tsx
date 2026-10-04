/**
 * The Render form (§6.1): starts from the format's render defaults and video
 * card, shows the title resolved with the script's values, and queues the
 * right request — the title override, offline mode and "At" included.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import type { ShortScript } from "@photonsurge/shared/short-script";
import type { ShortRenderPreflight } from "@photonsurge/shared/short-render";
import RenderDialog, { AT_START_BY_MS } from "./RenderDialog";
import type { EncoderWithOccupancy } from "../../../lib/renders";

const NOW = new Date("2026-10-06T09:00:00Z").getTime(); // a Tuesday

const format = (over: Partial<ShortFormat> = {}): ShortFormat => ({
  ...defaultShortFormat("short-eu", "Europe"),
  ...over,
});

const SCRIPT = {
  id: "s1",
  formatId: "short-eu",
  title: "Europe round-up",
  template: "lineup",
  scope: { type: "area", id: "europe" },
  include: { alerts: false, quakes: false, volcanoes: false },
  values: { place: "Europe", kind: "round-up" },
  clips: [
    { id: "c1", target: "region:europe", durationMs: 60_000, label: { title: "Europe" } },
    { id: "c2", target: "global:spin", durationMs: 6_000, label: { title: "Spin" } },
  ],
  status: "draft",
} as ShortScript;

const occ = (state: string, label: string, canQueueVideo: boolean) => ({ state, label, canQueueVideo, queued: 0 }) as EncoderWithOccupancy["occupancy"];
const ENCODERS: EncoderWithOccupancy[] = [
  { id: "main", name: "Main rig", url: "ws://m", enabled: true, hasPassword: true, use: "channels", occupancy: occ("live", "live: Main", false) },
  { id: "v1", name: "Video 1", url: "ws://v1", enabled: true, hasPassword: true, use: "videos", occupancy: occ("live", "live: Something", false) },
  { id: "v2", name: "Video 2", url: "ws://v2", enabled: true, hasPassword: true, use: "videos", occupancy: occ("free", "free", true) },
];
const ACCOUNTS = [{ channelId: "UC1", channelTitle: "Weather Globe" }];

function setup(
  opts: {
    fmt?: ShortFormat;
    target?: Parameters<typeof RenderDialog>[0]["target"];
    accounts?: typeof ACCOUNTS;
    preflight?: Parameters<typeof RenderDialog>[0]["preflight"];
  } = {},
) {
  const queue = jest.fn(async (req: unknown) => ({ ok: true as const, data: { ok: true as const, render: { id: "r1", ...(req as object) } as never } }));
  const onQueued = jest.fn();
  const onClose = jest.fn();
  render(
    <RenderDialog
      open
      target={opts.target ?? { type: "script", scriptId: "s1" }}
      onClose={onClose}
      onQueued={onQueued}
      loadOptions={async () => ({ encoders: ENCODERS, accounts: opts.accounts ?? ACCOUNTS })}
      loadFormat={async () => ({ ok: true, data: opts.fmt ?? format() })}
      loadScript={async () => ({ ok: true, data: SCRIPT })}
      queue={queue as never}
      preflight={opts.preflight}
      now={() => NOW}
    />,
  );
  return { queue, onQueued, onClose };
}

it("preselects the first video encoder that can take a video and shows the title resolved", async () => {
  setup();
  expect(await screen.findByText(/“Europe round-up” · 1:06/)).toBeInTheDocument();
  expect(screen.getByLabelText("Encoder")).toHaveTextContent("Video 2");
  expect(screen.getByLabelText("Resolved title")).toHaveTextContent("Europe round-up · Tuesday 6 October");
});

it("queues the script live with the format's privacy and no overrides", async () => {
  const { queue, onQueued, onClose } = setup();
  await screen.findByText(/“Europe round-up”/);
  fireEvent.click(screen.getByRole("button", { name: "Queue render" }));
  await waitFor(() => expect(queue).toHaveBeenCalled());
  expect(queue).toHaveBeenCalledWith({ encoderId: "v2", what: { type: "script", scriptId: "s1" }, publishAs: "unlisted", offline: false });
  expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
  expect(onClose).toHaveBeenCalled();
});

it("starts from the format's render defaults and sends a changed title for this video", async () => {
  const fmt = format({ render: { encoderId: "v2", accountId: "UC1" }, video: { ...format().video, publishAs: "public" } });
  const { queue } = setup({ fmt });
  const field = await screen.findByLabelText("Title (this video only)");
  fireEvent.change(field, { target: { value: "Special: %{place}" } });
  expect(screen.getByLabelText("Resolved title")).toHaveTextContent("Special: Europe");
  fireEvent.click(screen.getByRole("button", { name: "Queue render" }));
  await waitFor(() => expect(queue).toHaveBeenCalled());
  expect(queue.mock.calls[0][0]).toEqual({
    encoderId: "v2",
    what: { type: "script", scriptId: "s1" },
    publishAs: "public",
    offline: false,
    accountId: "UC1",
    video: { title: "Special: %{place}" },
  });
});

it("an offline test needs no YouTube channel", async () => {
  const { queue } = setup({ accounts: [] });
  expect(await screen.findByText(/No YouTube channel is connected/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Queue render" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Offline test" }));
  expect(screen.queryByLabelText("YouTube channel")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Queue offline test" }));
  await waitFor(() => expect(queue).toHaveBeenCalled());
  expect(queue.mock.calls[0][0]).toMatchObject({ offline: true });
  expect(queue.mock.calls[0][0]).not.toHaveProperty("accountId");
});

it("'At' queues for later with a start-by an hour after", async () => {
  const { queue } = setup();
  fireEvent.click(await screen.findByRole("button", { name: "At" }));
  const input = screen.getByLabelText("Start at");
  fireEvent.change(input, { target: { value: "2020-01-01T10:00" } });
  expect(screen.getByText("Pick a time in the future.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Queue for later" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "2026-10-07T18:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Queue for later" }));
  await waitFor(() => expect(queue).toHaveBeenCalled());
  const at = new Date("2026-10-07T18:30").getTime();
  expect(queue.mock.calls[0][0]).toMatchObject({ notBefore: at, startBy: at + AT_START_BY_MS });
});

it("from the generate form, queues a generate request in the format", async () => {
  const { queue } = setup({ target: { type: "generate", formatId: "short-eu", scope: { type: "country", id: "uk" } } });
  expect(await screen.findByText(/generated when it reaches the front/)).toBeInTheDocument();
  expect(screen.getByText(/example values until it generates/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Queue render" }));
  await waitFor(() => expect(queue).toHaveBeenCalled());
  expect(queue.mock.calls[0][0]).toMatchObject({ what: { type: "generate", formatId: "short-eu", scope: { type: "country", id: "uk" } } });
});

it("shows the worker's refusal and stays open", async () => {
  const { queue, onClose } = setup();
  queue.mockResolvedValueOnce({ ok: false, error: "no connected YouTube channel" } as never);
  await screen.findByText(/“Europe round-up”/);
  fireEvent.click(screen.getByRole("button", { name: "Queue render" }));
  expect(await screen.findByText("no connected YouTube channel")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

const REPORT: ShortRenderPreflight = {
  ok: true,
  at: NOW,
  format: { id: "short-eu", name: "Europe" },
  script: {
    level: "warn",
    title: "Europe round-up",
    clips: [{ id: "c1", title: "Europe", durationMs: 60_000 }],
    skipped: [{ id: "c2", title: "Spin", reason: "alert is no longer active" }],
  },
  length: { level: "ok", playMs: 60_000, budgetMs: 75_000, note: "1:00 of the format's 1:15 budget." },
  encoder: { level: "ok", checked: [{ id: "v2", name: "Video 2", reachable: true, detail: "OBS 30.2" }] },
  youtube: { level: "ok", used: false, note: "Not used: an offline test never contacts YouTube." },
};

it("Preflight shows the report for what the form would queue, and queues nothing", async () => {
  const preflight = jest.fn(async () => ({ ok: true as const, data: { ok: true as const, report: REPORT } }));
  const { queue } = setup({ preflight });
  fireEvent.click(await screen.findByRole("button", { name: "Offline test" }));
  fireEvent.click(screen.getByRole("button", { name: "Preflight" }));
  expect(await screen.findByLabelText("Preflight report")).toBeInTheDocument();
  expect(preflight).toHaveBeenCalledWith({ encoderId: "v2", what: { type: "script", scriptId: "s1" }, publishAs: "unlisted", offline: true });
  expect(queue).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Clips: warn")).toHaveTextContent("skipped Spin: alert is no longer active");
  expect(screen.getByLabelText("Length: ok")).toHaveTextContent("1:00 of the format's 1:15 budget.");
  expect(screen.getByLabelText("Encoder: ok")).toHaveTextContent("Video 2: OBS 30.2");
  expect(screen.getByLabelText("YouTube: ok")).toHaveTextContent("never contacts YouTube");
  // A change to the request drops the report.
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  expect(screen.queryByLabelText("Preflight report")).not.toBeInTheDocument();
});

it("allows Live with Publish as Private — the test that also exercises YouTube", async () => {
  const { queue } = setup();
  fireEvent.mouseDown(await screen.findByLabelText("Publish as"));
  fireEvent.click(await screen.findByRole("option", { name: "Private" }));
  expect(screen.getByText(/a test that also exercises YouTube/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Queue render" }));
  await waitFor(() => expect(queue).toHaveBeenCalled());
  expect(queue.mock.calls[0][0]).toMatchObject({ publishAs: "private", offline: false });
});
