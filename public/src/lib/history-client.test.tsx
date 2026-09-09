import { renderHook, waitFor } from "@testing-library/react";
import { usePointHistory } from "./history-client";

it("clears previous readings when the focus changes or is disabled", async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url: string | URL | Request) => ({
    ok: true,
    json: async () => String(url).endsWith("/variables")
      ? { variables: ["wind"] }
      : { variable: "wind", lat: 0, lng: 0, series: [{ speed: 4 }, { speed: 6 }] },
  })) as unknown as typeof fetch;
  try {
    const { result, rerender } = renderHook(
      ({ center }: { center: [number, number] | null }) => usePointHistory(center),
      { initialProps: { center: [0, 0] as [number, number] | null } },
    );
    await waitFor(() => expect(result.current.series).toHaveLength(1));
    global.fetch = jest.fn(() => new Promise(() => {})) as typeof fetch;
    rerender({ center: [-2.5, 54.5] });
    expect(result.current.series).toEqual([]);
    expect(result.current.loading).toBe(true);
    rerender({ center: null });
    expect(result.current.series).toEqual([]);
    expect(result.current.loading).toBe(false);
  } finally {
    global.fetch = originalFetch;
  }
});
