import { act, render, screen } from "@testing-library/react";
import TopCitiesPanel from "./TopCitiesPanel";

const mockForecast = jest.fn((_center: [number, number]) => ({ days: [], loading: true }));
jest.mock("../../lib/focus/focus-client", () => ({
  useTopCities: () => [
    { id: "sh", name: "Shanghai", country: "China", population: 25000000, lat: 31, lng: 121 },
    { id: "bj", name: "Beijing", country: "China", population: 19000000, lat: 40, lng: 116 },
  ],
  usePointForecastDays: (center: [number, number]) => mockForecast(center),
}));

it("labels the other cities and follows the featured city's forecast as it rotates", () => {
  jest.useFakeTimers();
  const { unmount } = render(<TopCitiesPanel bbox={[70, 15, 135, 55]} cc="cn" />);
  expect(screen.getByText("TODAY’S WEATHER · SHANGHAI")).toBeInTheDocument();
  expect(screen.getByText("OTHER MAJOR CITIES · BY POPULATION")).toBeInTheDocument();
  expect(mockForecast).toHaveBeenLastCalledWith([121, 31]);
  act(() => { jest.advanceTimersByTime(7000); });
  expect(screen.getByText("TODAY’S WEATHER · BEIJING")).toBeInTheDocument();
  expect(screen.queryByText("TODAY’S WEATHER · SHANGHAI")).not.toBeInTheDocument();
  expect(mockForecast).toHaveBeenLastCalledWith([116, 40]);
  unmount();
  jest.useRealTimers();
});
