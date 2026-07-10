import { render, screen } from "@testing-library/react";
import CountryPanel from "./CountryPanel";
import type { CountryAt } from "../../lib/countries";

const country = (over: Partial<CountryAt> = {}): CountryAt =>
  ({
    countryId: "jp",
    name: "Japan",
    iso2: "JP",
    bbox: [122, 24, 146, 46],
    ...over,
  }) as unknown as CountryAt;

describe("CountryPanel", () => {
  it("renders the name, flag, capital/pop/currency meta, photo and blurb", () => {
    render(
      <CountryPanel
        country={country({
          capital: "Tokyo",
          population: 125_000_000,
          currency: "Yen",
          wikiThumb: "https://example.test/jp.jpg",
          wikiExtract: "Japan is an island country in East Asia.",
        })}
      />,
    );
    expect(screen.getByText("Japan")).toBeInTheDocument();
    // 🇯🇵 flag from iso2 "JP"
    expect(screen.getByText("🇯🇵")).toBeInTheDocument();
    expect(screen.getByText(/Capital Tokyo · Pop\. 125M · Yen/)).toBeInTheDocument();
    expect(screen.getByText(/island country in East Asia/)).toBeInTheDocument();
    expect(screen.getByAltText("Japan")).toBeInTheDocument();
  });

  it("omits the photo and meta line when the country carries neither", () => {
    render(<CountryPanel country={country()} />);
    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.queryByAltText("Japan")).not.toBeInTheDocument();
    expect(screen.queryByText(/Capital/)).not.toBeInTheDocument();
  });
});
