"use client";

/**
 * The YouTube player on /admin/streams/:id, driven through the IFrame Player
 * API so the as-run timeline's ▶ buttons can seek it. Loads the API script
 * once per page; hands the page a tiny `seekTo` handle via `onApi` (null again
 * on unmount). If the script never loads (offline, blocked) the timeline still
 * works — it falls back to `watchUrl&t=` links.
 */
import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";

export interface VodPlayerApi {
  /** Jump to a video offset (seconds) and play. */
  seekTo(seconds: number): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";
let apiPromise: Promise<any> | null = null;

/** Resolve the global `YT` namespace, injecting the API script on first use. */
function loadYouTubeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      if (!document.querySelector(`script[src="${API_SRC}"]`)) {
        const s = document.createElement("script");
        s.src = API_SRC;
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }
  return apiPromise;
}

export default function VodPlayer({ videoId, onApi }: { videoId: string; onApi?: (api: VodPlayerApi | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest callback without re-creating the player when the parent re-renders.
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;

  useEffect(() => {
    let player: any;
    let disposed = false;
    loadYouTubeApi()
      .then((YT) => {
        if (disposed || !hostRef.current) return;
        const mount = document.createElement("div");
        hostRef.current.replaceChildren(mount);
        player = new YT.Player(mount, {
          videoId,
          playerVars: { rel: 0 },
          events: {
            onReady: () =>
              onApiRef.current?.({
                seekTo: (seconds: number) => {
                  player.seekTo(seconds, true);
                  player.playVideo?.();
                },
              }),
          },
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      onApiRef.current?.(null);
      try {
        player?.destroy?.();
      } catch {
        /* player already gone */
      }
    };
  }, [videoId]);

  return (
    <Box
      ref={hostRef}
      data-testid="vod-player"
      sx={{ width: "100%", aspectRatio: "16 / 9", bgcolor: "#000", "& iframe": { width: "100%", height: "100%", display: "block" } }}
    />
  );
}
