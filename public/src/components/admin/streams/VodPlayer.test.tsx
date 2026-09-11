import { act, render } from "@testing-library/react";
import VodPlayer from "./VodPlayer";

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
});

it("hands the page a seek handle once the player is ready, and withdraws it on unmount", async () => {
  const seekTo = jest.fn();
  const playVideo = jest.fn();
  const destroy = jest.fn();
  const Player = jest.fn(function (this: unknown, _el: HTMLElement, opts: { events: { onReady: () => void } }) {
    setTimeout(() => opts.events.onReady(), 0);
    return { seekTo, playVideo, destroy };
  });
  window.YT = { Player };
  const onApi = jest.fn();

  const { unmount } = render(<VodPlayer videoId="vid1" onApi={onApi} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

  expect(Player).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ videoId: "vid1" }));
  const api = onApi.mock.calls[0][0];
  api.seekTo(83);
  expect(seekTo).toHaveBeenCalledWith(83, true);
  expect(playVideo).toHaveBeenCalled();

  unmount();
  expect(onApi).toHaveBeenLastCalledWith(null);
  expect(destroy).toHaveBeenCalled();
});

it("injects the IFrame API script when the namespace isn't loaded yet", () => {
  render(<VodPlayer videoId="vid1" />);
  expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).not.toBeNull();
});
