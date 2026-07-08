import { fireEvent, render, screen } from "@testing-library/react";
import VolcanoesTable from "./VolcanoesTable";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { useVolcanoes } from "../../lib/volcanoes-overlay";

jest.mock("../../lib/volcanoes-overlay", () => ({ useVolcanoes: jest.fn() }));

const etna: Volcano = {
  id: "gvp:211060",
  name: "Etna",
  country: "Italy",
  lat: 37.748,
  lng: 14.999,
  status: "erupting",
  firstDate: 1_751_000_000_000,
  lastDate: 1_751_500_000_000,
  statusChangedAt: 1_751_500_000_000,
  latestReport: "INGV reported ongoing eruptive activity at Etna's summit craters.",
  wikiTitle: "Mount Etna",
  wikiThumb: "https://example.test/thumb.jpg",
  wikiPhoto: "https://example.test/full.jpg",
  wikiGallery: ["https://example.test/g1.jpg", "https://example.test/g2.jpg"],
  volcanoType: "stratovolcano",
  elevationM: 3357,
  lastEruptionYear: 2021,
  usgsAlertLevel: "WATCH",
  usgsColorCode: "ORANGE",
  usgsNoticeSynopsis: "Lava fountaining continues.",
  usgsNoticeUrl: "https://volcanoes.usgs.gov/hans2/view/notice/x",
  usgsUpdatedAt: 1_751_500_000_000,
  reportVei: 2,
  reportPlumeHeightM: 3000,
};

describe("VolcanoesTable", () => {
  beforeEach(() => {
    (useVolcanoes as jest.Mock).mockReturnValue([etna]);
  });

  it("shows the USGS colour code in the table and prefers wikiPhoto + gallery + facts in the detail panel", () => {
    render(<VolcanoesTable />);

    expect(screen.getByText("● ORANGE")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Etna"));

    const [mainPhoto] = screen.getAllByAltText("") as HTMLImageElement[];
    expect(mainPhoto.src).toContain("full.jpg");

    expect(screen.getByText(/stratovolcano/)).toBeInTheDocument();
    expect(screen.getByText(/3,357 m/)).toBeInTheDocument();
    expect(screen.getByText(/last known eruption 2021/)).toBeInTheDocument();

    expect(screen.getByText(/Lava fountaining continues\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "USGS notice ↗" })).toHaveAttribute(
      "href",
      "https://volcanoes.usgs.gov/hans2/view/notice/x",
    );

    expect(screen.getByText(/VEI 2/)).toBeInTheDocument();
    expect(screen.getByText(/plume 3,000 m/)).toBeInTheDocument();
  });

  it("renders without a USGS badge or gallery when those fields are absent", () => {
    (useVolcanoes as jest.Mock).mockReturnValue([{ ...etna, usgsColorCode: undefined, wikiGallery: undefined }]);
    render(<VolcanoesTable />);
    expect(screen.getByText("—")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Etna"));
    expect(screen.queryByText(/USGS notice/)).not.toBeInTheDocument();
  });
});
