"use client";

/**
 * The bottom line telling viewers how to play. With no live chat attached
 * (`inputLive` off) nobody can answer, so it says the host is playing a demo.
 */
import { ACCENT, INK, PLATE, SANS } from "./styles";

export default function HowToStrip({ inputLive }: { inputLive: boolean }) {
  return (
    <div
      data-testid="cw-howto"
      style={{
        ...PLATE,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        fontFamily: SANS,
        fontSize: 26,
        color: INK,
      }}
    >
      {inputLive ? (
        <>
          <span style={{ color: ACCENT, fontWeight: 600, letterSpacing: 2 }}>PLAY</span>
          Type your answer in the chat — the first correct answer takes the word
        </>
      ) : (
        <>
          <span style={{ color: ACCENT, fontWeight: 600, letterSpacing: 2 }}>DEMO ROUND</span>
          The host is playing on its own — chat answers open when we go live
        </>
      )}
    </div>
  );
}
