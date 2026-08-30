import { act, render, screen } from "@testing-library/react";
import { BILLBOARD_HOLD_MS, type BillboardAd } from "@photonsurge/shared/ads/billboard";
import SponsorBillboard, { BILLBOARD_MIN_H } from "./SponsorBillboard";

const ad = (adId: string, over: Partial<BillboardAd> = {}): BillboardAd => ({
  adId,
  title: adId,
  mediaUrl: `/api/ads/${adId}/media?v=1`,
  ...over,
});

describe("SponsorBillboard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing with an empty rotation — no empty frame ever airs", () => {
    const { container } = render(<SponsorBillboard ads={[]} maxHeight={200} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("yields the corner when the free band is under the floor", () => {
    const { container } = render(
      <SponsorBillboard ads={[ad("a")]} maxHeight={BILLBOARD_MIN_H - 1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the creative with the SPONSORED header and the advertiser name", () => {
    render(
      <SponsorBillboard
        ads={[ad("a", { title: "Spring push", advertiser: "Acme Weather Gear" })]}
        maxHeight={200}
      />,
    );
    expect(screen.getByText("SPONSORED")).toBeInTheDocument();
    expect(screen.getByText("ACME WEATHER GEAR")).toBeInTheDocument();
    expect(screen.getByAltText("Spring push")).toHaveAttribute("src", "/api/ads/a/media?v=1");
  });

  it("falls back to the title when there is no advertiser", () => {
    render(<SponsorBillboard ads={[ad("a", { title: "House promo" })]} maxHeight={200} />);
    expect(screen.getByText("HOUSE PROMO")).toBeInTheDocument();
  });

  it("advances on the shared wall-clock hold boundary", () => {
    render(<SponsorBillboard ads={[ad("a"), ad("b")]} maxHeight={200} />);
    expect(screen.getByAltText("a")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(BILLBOARD_HOLD_MS + 50);
    });
    expect(screen.getByAltText("b")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(BILLBOARD_HOLD_MS);
    });
    expect(screen.getByAltText("a")).toBeInTheDocument();
  });

  it("fades out for the cut window via hidden", () => {
    render(<SponsorBillboard ads={[ad("a")]} maxHeight={200} hidden />);
    expect(screen.getByTestId("sponsor-billboard").style.opacity).toBe("0");
  });
});
