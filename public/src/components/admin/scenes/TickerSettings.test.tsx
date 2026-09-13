/**
 * TickerSettings — per-channel bottom-crawl content editor. Checkboxes toggle
 * crawl kinds (tickerKindsOff, an off-list); the alert-hazard chips only show
 * while the alert kind is on. All staged into the page's draft.
 */
import { fireEvent, screen } from "@testing-library/react";
import { TICKER_KINDS } from "@photonsurge/shared/broadcast-ticker";
import TickerSettings from "./TickerSettings";
import { renderInDraft } from "./draft-harness";

describe("TickerSettings", () => {
  it("renders every catalog kind, all on by default", () => {
    renderInDraft(<TickerSettings />);
    for (const k of TICKER_KINDS) {
      expect(screen.getByRole("checkbox", { name: k.label })).toBeChecked();
    }
  });

  it("hides a crawl kind via its checkbox (the delta carries the off-list)", () => {
    const d = renderInDraft(<TickerSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Earthquakes" }));
    expect(d.last()).toEqual({ tickerKindsOff: ["quake"] });
  });

  it("re-showing a kind drops it from the staged off-list", () => {
    const d = renderInDraft(<TickerSettings />, { state: { tickerKindsOff: ["ad", "track"] } });
    const ads = screen.getByRole("checkbox", { name: "Sponsor mentions" });
    expect(ads).not.toBeChecked();

    fireEvent.click(ads);
    expect(d.last()).toEqual({ tickerKindsOff: ["track"] });
  });

  it("shows the crawl-specific alert-hazard filter while alerts are on", () => {
    renderInDraft(<TickerSettings />);
    expect(screen.getByText("Alert hazards")).toBeInTheDocument();
  });

  it("hides the alert-hazard filter when the alert kind is off", () => {
    renderInDraft(<TickerSettings />, { state: { tickerKindsOff: ["alert"] } });
    expect(screen.getByRole("checkbox", { name: "Earthquakes" })).toBeInTheDocument();
    expect(screen.queryByText("Alert hazards")).not.toBeInTheDocument();
  });
});
