"use client";

/**
 * The crossword channel's whole watch page below the route: the data (the
 * scene's ControlState for theme and audio, the game's public state), the
 * music bed, and the 1920×1080 stage scaled to the window.
 *
 * Of the scene's ControlState only `broadcastTheme`, `themeOverrides` and
 * `audio` are read. No director hooks, no globe, no map library: this is the
 * cheapest page an encoder renders. There is no backdrop blur on it either, so
 * the OBS render mode has nothing to switch off.
 */
import { useEffect, useMemo, useState } from "react";
import { useSceneState } from "../../lib/scenes";
import { useCrosswordState } from "../../lib/crossword";
import { UI_SANS } from "../../lib/fonts";
import BroadcastBed from "../audio/BroadcastBed";
import { broadcastThemeCssVars, getBroadcastTheme } from "../broadcast/config";
import CrosswordSurface from "./CrosswordSurface";
import { FRAME_H, FRAME_W } from "./styles";

const fitScale = () => Math.min(window.innerWidth / FRAME_W, window.innerHeight / FRAME_H) || 1;

/** Scale that fits the stage in the window (resize-driven, no frame loop). */
function useFrameScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const onResize = () => setScale(fitScale());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

function Notice({ text }: { text: string }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        color: "#8b95a7",
        fontFamily: UI_SANS,
        fontSize: 14,
      }}
    >
      {text}
    </main>
  );
}

export default function CrosswordWatch({ sceneId, token }: { sceneId: string; token?: string }) {
  const { state: control, tokenError: sceneTokenError } = useSceneState(sceneId, token);
  const game = useCrosswordState(sceneId, token);
  const scale = useFrameScale();

  const theme = useMemo(
    () => getBroadcastTheme(control.broadcastTheme, control.themeOverrides),
    [control.broadcastTheme, control.themeOverrides],
  );

  // The riser fires on the change into the finale. Undefined until the first
  // state lands, so a page that loads mid-finale does not fire it.
  const pub = game.state;
  const pulseKey = !game.ready ? undefined : pub?.phase === "finale" ? `finale:${pub.puzzleNo}` : null;

  if (sceneTokenError || game.tokenError) return <Notice text="Invalid or missing watch token." />;
  if (game.notCrossword) return <Notice text="This channel is not a crossword channel." />;

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#05090f",
        ...broadcastThemeCssVars(theme),
        ...({ "--cw-live": theme.liveColor } as Record<string, string>),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: FRAME_W,
          height: FRAME_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <CrosswordSurface state={pub} offset={game.offset} brand={theme.name} />
      </div>
      <BroadcastBed audio={control.audio} segment={null} pulseKey={pulseKey} />
    </main>
  );
}
