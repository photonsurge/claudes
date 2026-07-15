import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { spanForCount } from "../../../components/admin/jobs/JobGroupPanel";
import JobsPage from "./page";

const JOBS = [
  { id: "weather-check", label: "Check weather run", description: "Look for a newer GFS run and bake it.", domain: "weather", type: "weather", event: "check", group: "Weather maps" },
  { id: "weather-hrrr", label: "HRRR (US 3 km)", description: "Re-ingest the NOAA HRRR CONUS nest.", domain: "weather", type: "weather", event: "refreshHrrr", group: "Weather maps" },
  { id: "volcanoes-snapshot", label: "Refresh active volcanoes", description: "Re-pull the Smithsonian report.", domain: "volcanoes", type: "volcanoes", event: "snapshot", group: "Volcanoes" },
  { id: "cities-enrich-all", label: "Enrich all cities", description: "Restartable batches. Use Stop to halt a run in progress.", domain: "cities", type: "cities", event: "enrichWikiAll", group: "Cities", stoppable: true },
];

const COUNTS = { active: 3, waiting: 0, completed: 1160, failed: 4 };

function mockApi() {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jobs: JOBS, counts: COUNTS }),
  })) as unknown as typeof fetch;
}

const search = () => screen.getByRole("searchbox", { name: "Search jobs" });

afterEach(() => jest.restoreAllMocks());

describe("JobsPage", () => {
  it("groups the catalog and shows every job by default", async () => {
    mockApi();
    render(<JobsPage />);

    expect(await screen.findByText("Check weather run")).toBeInTheDocument();
    expect(screen.getByText("Refresh active volcanoes")).toBeInTheDocument();
    expect(screen.getByText("4 jobs")).toBeInTheDocument();
    // Group headings, so a 60-job catalog stays navigable.
    expect(screen.getByRole("heading", { name: /Weather maps/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Volcanoes/ })).toBeInTheDocument();
  });

  it("filters to one group when its chip is picked, and back out again", async () => {
    mockApi();
    render(<JobsPage />);
    await screen.findByText("Check weather run");

    fireEvent.click(screen.getByRole("button", { name: /Volcanoes 1/ }));

    expect(screen.getByText("Refresh active volcanoes")).toBeInTheDocument();
    expect(screen.queryByText("Check weather run")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 4 jobs")).toBeInTheDocument();

    // Clicking the active chip clears the filter.
    fireEvent.click(screen.getByRole("button", { name: /Volcanoes 1/ }));
    expect(screen.getByText("Check weather run")).toBeInTheDocument();
  });

  it("searches across label and description", async () => {
    mockApi();
    render(<JobsPage />);
    await screen.findByText("Check weather run");

    // Matches a description, not a label.
    fireEvent.change(search(), { target: { value: "smithsonian" } });
    expect(screen.getByText("Refresh active volcanoes")).toBeInTheDocument();
    expect(screen.queryByText("HRRR (US 3 km)")).not.toBeInTheDocument();

    fireEvent.change(search(), { target: { value: "nothing here" } });
    expect(screen.getByText("No jobs match that search.")).toBeInTheDocument();
  });

  it("sizes each group's panel to how many jobs it holds", async () => {
    mockApi();
    const { container } = render(<JobsPage />);
    await screen.findByText("Check weather run");

    // A 2-job group claims a narrow panel; the 1-job groups claim a single
    // column rather than an empty full-width band.
    expect(container.querySelector(".job-panel.job-span-1")).toBeTruthy();
    expect(spanForCount(1)).toBe(1);
    expect(spanForCount(2)).toBe(1);
    expect(spanForCount(7)).toBe(3);
    expect(spanForCount(21)).toBe(4);
  });

  it("only offers Stop on stoppable jobs", async () => {
    mockApi();
    render(<JobsPage />);
    await screen.findByText("Enrich all cities");

    expect(screen.getAllByRole("button", { name: "Run now" })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
  });

  it("enqueues the job and reports its live state", async () => {
    global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
      const u = String(url);
      const method = (init as { method?: string } | undefined)?.method;
      if (u.includes("jobId=")) return { ok: true, json: async () => ({ state: "completed", durationMs: 3200 }) };
      if (method === "POST") return { ok: true, json: async () => ({ ok: true, jobId: "77" }) };
      return { ok: true, json: async () => ({ jobs: JOBS, counts: COUNTS }) };
    }) as unknown as typeof fetch;

    render(<JobsPage />);
    await screen.findByText("Check weather run");

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Run now" })[0]);
    });

    await waitFor(() => expect(screen.getByText(/done in 3.2s/)).toBeInTheDocument(), { timeout: 5000 });
  });
});
