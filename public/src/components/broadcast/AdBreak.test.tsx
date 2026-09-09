import { act, render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import AdBreak from "./AdBreak";

const segment: Segment = {
  id: "ad:test", kind: "ad", title: "Test", holdMs: 30000,
  camera: { center: [0, 0], zoom: 1 }, patch: {},
  ad: { adId: "test", title: "Test", mediaType: "image", mediaUrl: "/ad.png" },
};

it("counts down to the director deadline, updates for another airing and clamps at zero", () => {
  jest.useFakeTimers();
  jest.setSystemTime(100000);
  const { rerender, unmount } = render(<AdBreak segment={segment} endsAt={112000} />);
  expect(screen.getByRole("timer")).toHaveTextContent("BACK IN0:12");
  act(() => { jest.advanceTimersByTime(5000); });
  expect(screen.getByRole("timer")).toHaveTextContent("0:07");
  rerender(<AdBreak segment={segment} endsAt={166000} />);
  expect(screen.getByRole("timer")).toHaveTextContent("1:01");
  act(() => { jest.advanceTimersByTime(62000); });
  expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  rerender(<AdBreak segment={null} endsAt={null} />);
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  unmount();
  jest.useRealTimers();
});
