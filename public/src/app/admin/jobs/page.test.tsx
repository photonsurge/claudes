import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { spanForCount } from "../../../components/admin/jobs/JobGroupPanel";
import JobsPage from "./page";

const job = (id: string, label: string, group: string, description: string, extra = {}) => ({
  id,
  label,
  description,
  group,
  domain: "d",
  type: "t",
  event: "e",
  ...extra,
});

/**
 * Shaped like the real catalog in the way that matters: a small group sits
 * FIRST in catalog order and a big one after it, so panel ordering is a real
 * assertion rather than a coincidence.
 */
const JOBS = [
  job("weather-check", "Check weather run", "Weather maps", "Look for a newer GFS run and bake it."),
  job("weather-hrrr", "HRRR (US 3 km)", "Weather maps", "Re-ingest the NOAA HRRR CONUS nest."),
  job("volcanoes-snapshot", "Refresh active volcanoes", "Volcanoes", "Re-pull the Smithsonian report."),
  job("volcanoes-enrich", "Enrich volcanoes", "Volcanoes", "Fetch a Wikipedia photo."),
  job("volcanoes-usgs", "Refresh USGS volcano alerts", "Volcanoes", "Re-pull the USGS VHP status."),
  job("volcanoes-geonet", "Refresh GeoNet volcano alerts", "Volcanoes", "Re-pull GeoNet alert levels."),
  job("volcanoes-cams", "Capture volcano camera frames", "Volcanoes", "Archive one still per camera."),
  job("volcanoes-prune", "Prune old volcano camera frames", "Volcanoes", "Drop frames past retention."),
  job("cities-enrich-all", "Enrich all cities", "Cities", "Restartable batches. Use Stop to halt a run in progress.", {
    stoppable: true,
  }),
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
    expect(screen.getByText("9 jobs")).toBeInTheDocument();
    // Group headings, so an 80-job catalog stays navigable.
    expect(screen.getByRole("heading", { name: /Weather maps/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Volcanoes/ })).toBeInTheDocument();
  });

  it("filters to one group when its chip is picked, and back out again", async () => {
    mockApi();
    render(<JobsPage />);
    await screen.findByText("Check weather run");

    fireEvent.click(screen.getByRole("button", { name: /Volcanoes 6/ }));

    expect(screen.getByText("Refresh active volcanoes")).toBeInTheDocument();
    expect(screen.queryByText("Check weather run")).not.toBeInTheDocument();
    expect(screen.getByText("6 of 9 jobs")).toBeInTheDocument();

    // Clicking the active chip clears the filter.
    fireEvent.click(screen.getByRole("button", { name: /Volcanoes 6/ }));
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

    // A 1-job group claims a single column rather than an empty full-width band.
    expect(container.querySelector(".job-panel.job-span-1")).toBeTruthy();
    expect(spanForCount(1)).toBe(1);
    expect(spanForCount(2)).toBe(1);
    expect(spanForCount(7)).toBe(3);
    expect(spanForCount(21)).toBe(4);
  });

  it("lays the widest panels out first so narrow ones backfill the row", async () => {
    mockApi();
    const { container } = render(<JobsPage />);
    await screen.findByText("Check weather run");

    // Volcanoes (6 jobs → span 3) jumps ahead of Weather maps (2 → span 1),
    // which the catalog lists first.
    const panels = [...container.querySelectorAll(".job-panel")];
    expect(panels.map((el) => el.querySelector("h3")?.textContent)).toEqual([
      "Volcanoes6",
      "Weather maps2",
      "Cities1",
    ]);
    const spans = panels.map((el) => Number(/job-span-(\d)/.exec(el.className)?.[1]));
    expect(spans).toEqual([3, 1, 1]);

    // The chips keep catalog order regardless of how the panels are packed.
    const chips = [...container.querySelectorAll(".MuiChip-label")].map((el) => el.textContent);
    expect(chips).toEqual(["All 9", "Weather maps 2", "Volcanoes 6", "Cities 1"]);
  });

  it("only offers Stop on stoppable jobs", async () => {
    mockApi();
    render(<JobsPage />);
    await screen.findByText("Enrich all cities");

    expect(screen.getAllByRole("button", { name: "Run now" })).toHaveLength(9);
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
