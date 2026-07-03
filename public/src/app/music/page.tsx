"use client";

/**
 * /music — sandbox for the generative broadcast audio bed. Client-only (Web
 * Audio needs the browser), loaded ssr:false like the Globe. This is the lab for
 * tuning the engine before it hangs off useDirector inside WatchSurface.
 */
import dynamic from "next/dynamic";

const AudioLab = dynamic(() => import("../../components/audio/AudioLab"), { ssr: false });

export default function MusicPage() {
  return <AudioLab />;
}
