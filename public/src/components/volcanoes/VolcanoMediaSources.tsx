"use client";

/**
 * The operator's picture-source switchboard: which volcano media feeds we fetch
 * and store at all.
 *
 * Switching a source off is not cosmetic — the worker skips it before spending a
 * request, so nothing is downloaded and nothing lands on disk. Some feeds simply
 * aren't broadcast-quality, and there's no point paying for pictures that will
 * never air.
 *
 * These are GLOBAL (per adapter, not per volcano), which is why they live on the
 * volcano index rather than any single volcano's page.
 */
import { useCallback, useEffect, useState } from "react";

interface MediaSource {
  source: string;
  name: string;
  enabled: boolean;
  attribution?: string;
  defaultLicence?: string;
  lastDiscoveredAt?: string;
  lastError?: string;
}

export default function VolcanoMediaSources() {
  const [sources, setSources] = useState<MediaSource[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/volcano-media-sources", { cache: "no-store" });
      const body = (await res.json()) as { sources?: MediaSource[] };
      setSources(body.sources ?? []);
    } catch {
      setError("Could not load media sources.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (source: string, enabled: boolean) => {
    setBusy(source);
    setError(null);
    // Optimistic: the switch should feel instant, but reload after so the row
    // reflects what actually persisted rather than what we hoped for.
    setSources((prev) => prev?.map((s) => (s.source === source ? { ...s, enabled } : s)) ?? prev);
    try {
      const res = await fetch("/api/admin/volcano-media-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, enabled }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await load();
    } catch {
      setError(`Could not switch ${source} ${enabled ? "on" : "off"}.`);
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (!sources) return <div style={{ color: "#8ea3bf", fontSize: 12 }}>Loading media sources…</div>;
  if (!sources.length) {
    return (
      <div style={{ color: "#8ea3bf", fontSize: 12 }}>
        No media sources registered yet — the worker adds them on its first media pass.
      </div>
    );
  }

  const on = sources.filter((s) => s.enabled).length;

  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 14, color: "#dbe6f5", margin: "0 0 2px" }}>
        Picture sources ({on} of {sources.length} on)
      </h2>
      <p style={{ fontSize: 11, color: "#8ea3bf", margin: "0 0 8px" }}>
        Switched-off sources are never fetched or stored. Cameras keep only their latest frame; published photos are kept.
      </p>
      {error && <div style={{ fontSize: 11, color: "#f87171", marginBottom: 6 }}>{error}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sources.map((s) => (
          <button
            key={s.source}
            type="button"
            disabled={busy === s.source}
            onClick={() => void toggle(s.source, !s.enabled)}
            title={[s.attribution, s.defaultLicence && `Licence: ${s.defaultLicence}`, s.lastError && `Last error: ${s.lastError}`]
              .filter(Boolean)
              .join(" · ")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              borderRadius: 6,
              cursor: busy === s.source ? "wait" : "pointer",
              fontSize: 11,
              border: `1px solid ${s.enabled ? "#1f6feb" : "#2b3648"}`,
              background: s.enabled ? "#0d2440" : "#111722",
              color: s.enabled ? "#dbe6f5" : "#6b7c94",
              opacity: busy === s.source ? 0.6 : 1,
            }}
          >
            <span style={{ color: s.enabled ? "#3fb950" : "#4d5b70" }}>{s.enabled ? "●" : "○"}</span>
            <span>{s.name}</span>
            {s.lastError && <span style={{ color: "#f87171" }} title={s.lastError}>!</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
