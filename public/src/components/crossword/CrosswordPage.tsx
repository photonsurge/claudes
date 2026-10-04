"use client";

/**
 * The crossword channel's whole page below the route: the data (the game's
 * public state and the channel's theme, the scene's ControlState for audio),
 * the music bed, and the 1920×1080 stage scaled to the window.
 *
 * The look is the crossword's own: config.theme becomes --cw-* CSS variables
 * once, here, and every component reads those. Of the scene's ControlState only
 * `audio` is read; the weather broadcast theme is not used. No director hooks,
 * no globe, no map library: this is the cheapest page an encoder renders. There
 * is no backdrop blur on it either, so the OBS render mode has nothing to
 * switch off (any later blur is written var(--panel-blur, …)).
 */
import { useEffect, useMemo, useState } from "react";
import { useSceneState } from "../../lib/scenes";
import { useCrosswordState } from "../../lib/crossword";
import { UI_SANS } from "../../lib/fonts";
import BroadcastBed from "../audio/BroadcastBed";
import { crosswordThemeVars } from "@photonsurge/shared/crossword";
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

export default function CrosswordPage({ sceneId, token }: { sceneId: string; token?: string }) {
  const { state: control, tokenError: sceneTokenError } = useSceneState(sceneId, token);
  const game = useCrosswordState(sceneId, token);
  const scale = useFrameScale();

  const theme = game.theme;
  const vars = useMemo(() => crosswordThemeVars(theme), [theme]);

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
        background: "var(--cw-background)",
        color: "var(--cw-ink)",
        fontFamily: "var(--cw-font-text)",
        ...vars,
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
        <CrosswordSurface state={pub} offset={game.offset} brand={theme.brand.title} logoUrl={theme.brand.logoUrl} />
      </div>
      <BroadcastBed audio={control.audio} segment={null} pulseKey={pulseKey} />
    </main>
  );
}
