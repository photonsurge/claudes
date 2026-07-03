import { fireEvent, render, screen } from "@testing-library/react";
import CitiesTable from "./CitiesTable";

const london = {
  id: "london",
  name: "London",
  country: "United Kingdom",
  lat: 51.5072,
  lng: -0.1276,
  population: 8_800_000,
  isCapital: true,
  wikiTitle: "London",
  wikiFetchedAt: new Date("2026-07-03T10:00:00Z"),
};

it("exposes sortable columns and numbered city pages", () => {
  const onPaginationChange = jest.fn();
  const onSortingChange = jest.fn();
  const onSelect = jest.fn();

  render(
    <CitiesTable
      cities={[london]}
      total={51}
      pageCount={3}
      loading={false}
      pagination={{ pageIndex: 0, pageSize: 25 }}
      sorting={[{ id: "population", desc: true }]}
      onPaginationChange={onPaginationChange}
      onSortingChange={onSortingChange}
      onSelect={onSelect}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "City page 2" }));
  expect(onPaginationChange).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Country" }));
  expect(onSortingChange).toHaveBeenCalled();

  expect(screen.getByRole("link", { name: "★ London" })).toHaveAttribute("href", "/cities/london");
  fireEvent.click(screen.getByRole("button", { name: "Preview London" }));
  expect(onSelect).toHaveBeenCalledWith(london);
});
