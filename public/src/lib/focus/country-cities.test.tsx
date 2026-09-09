import { renderHook, waitFor } from "@testing-library/react";
import { useTopCities } from "./focus-client";
import { listCities, type City } from "../cities";

jest.mock("../cities", () => ({ listCities: jest.fn() }));
const list = jest.mocked(listCities);
const bbox: [number, number, number, number] = [70, 15, 135, 55];

it("requests country membership and rejects neighbouring cities", async () => {
  list.mockResolvedValue([
    { id: "sh", name: "Shanghai", cc: "CN", lat: 31, lng: 121 },
    { id: "pk", name: "Lahore", cc: "pk", lat: 31, lng: 74 },
  ] as City[]);
  const { result, rerender } = renderHook(({ cc }) => useTopCities(bbox, cc), { initialProps: { cc: "CN" } });
  await waitFor(() => expect(result.current).toHaveLength(1));
  expect(result.current[0].name).toBe("Shanghai");
  expect(list).toHaveBeenCalledWith({ cc: "cn", limit: 8 });
  list.mockImplementation(() => new Promise(() => {}));
  rerender({ cc: "jp" });
  expect(result.current).toEqual([]);
  expect(list).toHaveBeenLastCalledWith({ cc: "jp", limit: 8 });
});
