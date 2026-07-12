"use client";

/**
 * Tap-to-fullscreen button for phone viewers of /watch. Renders ONLY on Android
 * — which by construction keeps it off the OBS browser source (OBS runs desktop
 * Chromium, no "Android" in its UA) and off iOS (no element Fullscreen API on
 * iPhone anyway). The Fullscreen API needs a user gesture, so this is a real
 * button, not an auto-call.
 *
 * Once fullscreen we don't disappear — Android's own exit chrome auto-hides and
 * the back gesture is easy to miss mid-stream — so we swap to a deliberately
 * subtle exit affordance: a low-opacity ⤡ that brightens on tap/hover, sitting
 * in the same corner as the enter button.
 */
import { useEffect, useState } from "react";

export default function FullscreenButton() {
  const [android, setAndroid] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    // Client-only: navigator is undefined during SSR. Android + supports the API.
    const ua = navigator.userAgent;
    setAndroid(/Android/i.test(ua) && !!document.documentElement.requestFullscreen);

    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!android) return null;

  return isFull ? (
    <button
      type="button"
      aria-label="Exit fullscreen"
      onClick={() => document.exitFullscreen?.().catch(() => {})}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      style={{
        position: "absolute",
        right: 14,
        top: 14,
        width: 40,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 10,
        // Deliberately faint so it never competes with the broadcast; the tap
        // target stays a full 40px even though the glyph is barely there. Tap/
        // hover/focus brightens it so it's findable the moment you reach for it.
        background: hot ? "rgba(10,14,22,0.55)" : "rgba(10,14,22,0.28)",
        color: hot ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
        fontSize: 18,
        lineHeight: 1,
        cursor: "pointer",
        WebkitBackdropFilter: "blur(3px)",
        backdropFilter: "blur(3px)",
        transition: "background 160ms ease, color 160ms ease",
        zIndex: 50,
      }}
    >
      ⤡
    </button>
  ) : (
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
