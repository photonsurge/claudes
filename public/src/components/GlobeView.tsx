"use client";

/**
 * SSR-disabled wrapper around the WebGL Globe. Pages import THIS, never Globe
 * directly, so MapLibre/deck.gl never run on the server.
 */
import dynamic from "next/dynamic";
import { forwardRef } from "react";
import type { GlobeHandle, GlobeProps } from "./Globe";

export type { GlobeHandle, GlobeProps } from "./Globe";

const GlobeImpl = dynamic(() => import("./Globe"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, background: "#0a0e16" }} />
  ),
});

const GlobeView = forwardRef<GlobeHandle, GlobeProps>(function GlobeView(props, ref) {
  return <GlobeImpl {...props} ref={ref} />;
});

export default GlobeView;
