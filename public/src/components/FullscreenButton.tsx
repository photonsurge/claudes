"use client";

/**
 * Tap-to-fullscreen button for phone viewers of /watch. Renders ONLY on Android
 * — which by construction keeps it off the OBS browser source (OBS runs desktop
 * Chromium, no "Android" in its UA) and off iOS (no element Fullscreen API on
 * iPhone anyway). The Fullscreen API needs a user gesture, so this is a real
 * button, not an auto-call. Hidden once fullscreen (Android shows its own exit
 * affordance / the back gesture leaves it).
 */
import { useEffect, useState } from "react";

export default function FullscreenButton() {
  const [android, setAndroid] = useState(false);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    // Client-only: navigator is undefined during SSR. Android + supports the API.
    const ua = navigator.userAgent;
    setAndroid(/Android/i.test(ua) && !!document.documentElement.requestFullscreen);

    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!android || isFull) return null;

  return (
    <button
      type="button"
      aria-label="Enter fullscreen"
      onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
      style={{
        position: "absolute",
        right: 14,
        top: 14,
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 10,
        background: "rgba(10,14,22,0.55)",
        color: "rgba(255,255,255,0.9)",
        fontSize: 22,
        lineHeight: 1,
        cursor: "pointer",
        WebkitBackdropFilter: "blur(4px)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
      }}
    >
      ⤢
    </button>
  );
}
