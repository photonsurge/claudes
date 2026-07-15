import { render, screen, within } from "@testing-library/react";
import FilesPage from "./page";

const USAGE = {
  enabled: true,
  root: "/app/blobs",
  files: 521,
  bytes: 75_000_000,
  tmpFiles: 0,
  tmpBytes: 0,
  disk: { totalBytes: 1_000_000_000_000, freeBytes: 400_000_000_000, usedBytes: 600_000_000_000 },
  namespaces: [
    { ns: "tex", label: "Weather textures", desc: "Baked textures.", known: true, files: 500, bytes: 74_000_000, tmpFiles: 0, tmpBytes: 0, largestBytes: 65_536, newestMs: Date.now(), oldestMs: Date.now() - 86_400_000 },
    { ns: "legacy-junk", label: "legacy-junk", desc: "Not written by any current store — may be reclaimable.", known: false, files: 21, bytes: 1_000_000, tmpFiles: 0, tmpBytes: 0, largestBytes: 1024, newestMs: Date.now(), oldestMs: Date.now() },
  ],
  emptyNamespaces: ["ad", "aurora"],
  tookMs: 42,
  at: new Date().toISOString(),
};

function mockGet(body: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;
}

afterEach(() => jest.restoreAllMocks());

describe("FilesPage", () => {
  it("summarises the blob folder and flags namespaces nothing writes", async () => {
    mockGet(USAGE);
    render(<FilesPage />);

    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
    const breadcrumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumbs).getByText("Admin").closest("a")).toHaveAttribute("href", "/admin");

    expect(await screen.findByText("/app/blobs")).toBeInTheDocument();
    expect(screen.getByText("Weather textures")).toBeInTheDocument();
    // 74MB of blobs on a disk that is 60% used.
    expect(screen.getByText("70.6 MB")).toBeInTheDocument();
    expect(screen.getByText("60.0% full")).toBeInTheDocument();
    // A directory the registry does not know about is called out, not hidden.
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByText(/Never written: ad, aurora/)).toBeInTheDocument();
  });

  it("warns about abandoned temp writes when there are any", async () => {
    mockGet({ ...USAGE, tmpFiles: 3, tmpBytes: 5_000_000 });
    render(<FilesPage />);

    expect(await screen.findByText(/3 abandoned temp writes holding 4.8 MB/)).toBeInTheDocument();
  });

  it("explains the disabled state rather than showing an empty table", async () => {
    mockGet({ enabled: false, at: new Date().toISOString() });
    render(<FilesPage />);

    expect(await screen.findByText("Blob folder disabled.")).toBeInTheDocument();
    expect(screen.queryByText("Disk free")).not.toBeInTheDocument();
  });

  it("surfaces a walk failure", async () => {
    mockGet({ error: "/app/blobs is not readable by this process (EACCES)" }, false);
    render(<FilesPage />);

    expect(await screen.findByText(/not readable by this process/)).toBeInTheDocument();
  });
});
