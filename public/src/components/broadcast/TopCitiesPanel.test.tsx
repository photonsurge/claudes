import { act, render, screen } from "@testing-library/react";
import TopCitiesPanel, { TopCityPanel, citySlideKey } from "./TopCitiesPanel";
import type { City } from "../../lib/cities";

const mockForecast = jest.fn((_center: [number, number]) => ({ days: [], loading: true }));
jest.mock("../../lib/focus/focus-client", () => ({
  usePointForecastDays: (center: [number, number]) => mockForecast(center),
}));

const cities = [
  { id: "sh", name: "Shanghai", country: "China", population: 25000000, lat: 31, lng: 121 },
  { id: "bj", name: "Beijing", country: "China", population: 19000000, lat: 40, lng: 116 },
] as unknown as City[];

it("lists every city on the overview page", () => {
  render(<TopCitiesPanel cities={cities} />);
  expect(screen.getByText("MAJOR CITIES · BY POPULATION")).toBeInTheDocument();
  expect(screen.getByText("Shanghai")).toBeInTheDocument();
  expect(screen.getByText("Beijing")).toBeInTheDocument();
});

it("gives one city its own page, with that city's forecast", () => {
  render(<TopCityPanel city={cities[0]} rank={1} total={2} />);
  expect(screen.getByText("CITY 1 OF 2")).toBeInTheDocument();
  expect(screen.getByText("TODAY’S WEATHER · SHANGHAI")).toBeInTheDocument();
  expect(mockForecast).toHaveBeenLastCalledWith([121, 31]);
  expect(screen.queryByText("Beijing")).not.toBeInTheDocument();
});

// The regression this split fixes: the card used to swap its featured city
// every 7s while the deck was still scrolling the body, so the content changed
// under the viewer mid-read. A page now holds still for as long as it is on air.
it("never swaps its own content on a timer", () => {
  jest.useFakeTimers();
  const { unmount } = render(<TopCityPanel city={cities[0]} rank={1} total={2} />);
  act(() => { jest.advanceTimersByTime(30000); });
  expect(screen.getByText("TODAY’S WEATHER · SHANGHAI")).toBeInTheDocument();
  expect(mockForecast).toHaveBeenLastCalledWith([121, 31]);
  unmount();
  jest.useRealTimers();
});

it("keys a city's slide id off its city id, colon-free", () => {
  expect(citySlideKey(cities[0])).toBe("sh");
  expect(citySlideKey({ id: "geonames:123", lng: 1, lat: 2 } as unknown as City)).toBe("geonames-123");
});
