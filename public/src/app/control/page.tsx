"use client";

/**
 * /control — operator console: a live globe preview + the full ControlPanel.
 * Every change updates local state, emits CONTROL_STATE over the socket, and
 * debounce-persists to /api/broadcast/state. Initial state loads from the API.
 */
import { useEffect, useRef, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import { fetchBroadcastState, useControlEmitter } from "../../lib/control";
import { fetchManifest } from "../../lib/manifest";
import { listCities, type City } from "../../lib/cities";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";
import ControlPanel from "../../components/ControlPanel";

export default function ControlPage() {
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const globe = useRef<GlobeHandle | null>(null);
  const emit = useControlEmitter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, m, c] = await Promise.all([
        fetchBroadcastState(),
        fetchManifest(),
        listCities(),
      ]);
      if (cancelled) return;
      setState(s);
      setManifest(m);
      setCities(c);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply a state change: local + live emit + persist.
  const apply = (next: ControlState) => {
    setState(next);
    emit(next);
  };

  return (
    <main style={{ display: "flex", height: "100vh", background: "#0a0e16", color: "#fff" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <GlobeView
          ref={globe}
          state={state}
          manifest={manifest}
          cities={cities}
          interactive
          onCameraChange={(center, zoom) => apply({ ...state, camera: { center, zoom } })}
        />
      </div>
      <aside
        style={{
          width: 360,
          padding: 20,
          overflowY: "auto",
          borderLeft: "1px solid #1b2030",
          background: "#0c111c",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Operator</h2>
        <ControlPanel
          state={state}
          manifest={manifest}
          onChange={apply}
          onFitBounds={(bbox) => globe.current?.fitBounds(bbox)}
          onFlyTo={(center, zoom) => globe.current?.flyTo(center, zoom)}
        />
      </aside>
    </main>
  );
}
