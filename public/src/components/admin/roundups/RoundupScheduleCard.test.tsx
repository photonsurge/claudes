/**
 * RoundupScheduleCard — rows per id, the draft/Save/Revert cycle (Save sends
 * only this card's ids), and the not-scheduled wording for off/empty rows.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_ROUNDUP_SETTINGS } from "@photonsurge/shared/roundup-settings";
import RoundupScheduleCard from "./RoundupScheduleCard";

const NOW = new Date("2026-10-04T13:30:00Z");
let puts: unknown[];

beforeEach(() => {
  puts = [];
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, settings: { ...DEFAULT_ROUNDUP_SETTINGS, ...body.settings } }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ settings: DEFAULT_ROUNDUP_SETTINGS, lastRun: { "global-hourly": "2026-10-04T13:00:00.000Z", "global-12h": null } }),
    };
  }) as unknown as typeof fetch;
});

const renderCard = async (ids: Parameters<typeof RoundupScheduleCard>[0]["ids"]) => {
  await act(async () => {
    render(<RoundupScheduleCard ids={ids} now={NOW} />);
  });
};
const save = () => screen.getByRole("button", { name: "Save" });

it("renders a row per id with the clock and captions", async () => {
  await renderCard(["global-hourly", "global-12h"]);
  expect(screen.getByText("Global hourly")).toBeInTheDocument();
  expect(screen.getByText("Global 12-hour")).toBeInTheDocument();
  expect(screen.queryByText("Countries")).not.toBeInTheDocument();
  expect(screen.getAllByText("UTC")).toHaveLength(2);
  expect(screen.getByText("Next 2026-10-04 14:00 UTC · last 2026-10-04 13:00 UTC")).toBeInTheDocument();
  expect(screen.getByText(/Next 2026-10-05 00:00 UTC · last never/)).toBeInTheDocument();
});

it("shows place hours as local times", async () => {
  await renderCard(["place-country"]);
  expect(screen.getByText("local time at each place")).toBeInTheDocument();
  expect(screen.getByText("06:00 and 18:00 local")).toBeInTheDocument();
});

it("toggling an hour dirties the draft; Revert restores it", async () => {
  await renderCard(["place-country"]);
  expect(save()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Countries 12:00" }));
  expect(save()).toBeEnabled();
  expect(screen.getByText("06:00, 12:00 and 18:00 local")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));
  expect(save()).toBeDisabled();
  expect(screen.getByText("06:00 and 18:00 local")).toBeInTheDocument();
});

it("Save PUTs only this card's ids and then goes clean", async () => {
  await renderCard(["place-country", "place-region"]);
  fireEvent.click(screen.getByRole("button", { name: "Countries 12:00" }));
  await act(async () => {
    fireEvent.click(save());
  });
  const sent = (puts[0] as { settings: Record<string, unknown> }).settings;
  expect(Object.keys(sent).sort()).toEqual(["place-country", "place-region"]);
  expect(sent["place-country"]).toEqual({ enabled: true, hours: [6, 12, 18] });
  expect(save()).toBeDisabled();
});

it("off or empty rows say they are not scheduled", async () => {
  await renderCard(["global-daily", "global-12h"]);
  fireEvent.click(screen.getByRole("switch", { name: "Global daily enabled" }));
  const clears = screen.getAllByRole("button", { name: "Clear" });
  fireEvent.click(clears[1]);
  expect(screen.getAllByText(/Not generated on a schedule — “Generate now” still works\./)).toHaveLength(2);
});

it("shows a save failure inline", async () => {
  await renderCard(["global-daily"]);
  fireEvent.click(screen.getByRole("button", { name: "Global daily 05:00" }));
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "db down" }) });
  await act(async () => {
    fireEvent.click(save());
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed: db down");
  expect(save()).toBeEnabled();
});
