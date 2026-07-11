"use client";

/**
 * /regions/[id] body: the full region record — name/group header, latest
 * bbox-averaged area-weather + recent-history trend charts, a bbox-glow globe
 * preview, Wikipedia enrichment and gallery. Mirrors CountryDetail.tsx; the
 * globe highlight is a framed region bbox (glowRegionBbox) rather than a
 * single country boundary.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { getRegion, regionEnrichmentStatus, type RegionDetail as RegionDetailData } from "../../lib/regions";
import { areaWeatherSeries } from "../../lib/area-weather";
import GlobeView, { type GlobeHandle } from "../GlobeView";
import { MiniChart } from "../broadcast/PointHistoryPanel";
import PlaceRoundupCard from "../PlaceRoundupCard";

const muted = "#8b95a7";
const panel = { border: "1px solid #1b2030", borderRadius: 9, background: "#0c111c" } as const;

function formatDate(value?: Date): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatPop(n?: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ color: muted, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</dt>
      <dd style={{ margin: "4px 0 0", color: "#e2e8f0", fontSize: 14, overflowWrap: "anywhere" }}>{children ?? "—"}</dd>
    </div>
  );
}

export default function RegionDetail({ id }: { id: string }) {
  const [data, setData] = useState<RegionDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const globe = useRef<GlobeHandle | null>(null);

  useEffect(() => {
    let active = true;
    getRegion(id).then((result) => {
      if (!active) return;
      if (result.detail) setData(result.detail);
      else setError(result.error ?? "Region not found.");
    });
    return () => { active = false; };
  }, [id]);

  const region = data?.region ?? null;

  const previewState = useMemo(() => region ? ({
    ...DEFAULT_CONTROL_STATE,
    activeVariable: null,
    showWind: false,
    showCities: false,
    camera: {
      center: [(region.bbox[0] + region.bbox[2]) / 2, (region.bbox[1] + region.bbox[3]) / 2] as [number, number],
      zoom: 2.5,
    },
  }) : null, [region]);

  useEffect(() => {
    if (region) globe.current?.fitBounds(region.bbox);
  }, [region]);

  if (!region && !error) return <div style={{ ...panel, padding: 20, color: muted }}>Loading region…</div>;
  if (!region) return <div role="alert" style={{ ...panel, padding: 20, color: "#fca5a5" }}>{error}</div>;

  const status = regionEnrichmentStatus(region);
  const series = areaWeatherSeries(data?.history ?? []);
  const latest = data?.weather ?? null;
  const articleUrl = region.wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(region.wikiTitle.replace(/ /g, "_"))}`
    : null;

  return (
    <div>
      <article style={{ ...panel, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 28 }}>{region.name}</h1>
              <span style={{ color: status.color, fontSize: 12 }}>● {status.label}</span>
            </div>
            <div style={{ color: muted, marginTop: 5 }}>{region.group}</div>
          </div>
          {articleUrl && <a href={articleUrl} target="_blank" rel="noreferrer" style={linkButton}>Wikipedia ↗</a>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: (region.wikiPhoto || region.wikiThumb) ? "minmax(260px, .8fr) minmax(0, 1.2fr)" : "1fr", gap: 22, marginTop: 22 }}>
          {(region.wikiPhoto || region.wikiThumb) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={region.wikiPhoto || region.wikiThumb} alt="" style={{ width: "100%", maxHeight: 380, objectFit: "cover", borderRadius: 8, background: "#080b11" }} />
          )}
          <div>
            <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Region data</h2>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px 20px", margin: 0 }}>
              <Field label="Group">{region.group}</Field>
              <Field label="Catalog ID">{region.regionId}</Field>
              <Field label="Bounding box">{region.bbox.map((n) => n.toFixed(1)).join(", ")}</Field>
            </dl>
            {region.wikiExtract && <p style={{ color: "#cbd5e1", lineHeight: 1.6, fontSize: 14, margin: "20px 0 0" }}>{region.wikiExtract}</p>}
          </div>
        </div>

        {region.wikiGallery && region.wikiGallery.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 14, overflowX: "auto" }}>
            {region.wikiGallery.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" style={{ width: 120, height: 88, objectFit: "cover", borderRadius: 6, background: "#080b11", flexShrink: 0 }} />
            ))}
          </div>
        )}

        <h2 style={{ fontSize: 14, margin: "24px 0 12px" }}>Wikipedia enrichment</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 20px", margin: 0 }}>
          <Field label="Result">{status.label}</Field>
          <Field label="Article title">{region.wikiTitle || "—"}</Field>
          <Field label="Last checked">{formatDate(region.wikiFetchedAt)}</Field>
        </dl>
      </article>

      {region.group !== "ocean" ? (
        <section style={{ ...panel, marginTop: 16, padding: 15 }}>
          <div style={{ color: "#cbd5e1", fontSize: 13 }}>Places</div>
          <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
            {region.placesFetchedAt
              ? `Member countries + biggest cities · updated ${formatDate(region.placesFetchedAt)}`
              : "Not built yet — hit Rebuild places on the catalog page."}
          </div>

          {region.countries && region.countries.length > 0 && (
            <>
              <div style={historySectionLabel}>Countries ({region.countries.length})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {region.countries.map((c) => (
                  <div key={c.cc} style={countryChip} title={c.cityCount ? `${c.cityCount} cities` : undefined}>
                    <span style={{ color: "#e2e8f0", fontSize: 13 }}>{c.name}</span>
                    {c.topCity && <span style={{ color: muted, fontSize: 11 }}>· {c.topCity}</span>}
                    {c.population ? <span style={{ color: "#64748b", fontSize: 11 }}>· {formatPop(c.population)}</span> : null}
                  </div>
                ))}
              </div>
            </>
          )}

          {region.topCities && region.topCities.length > 0 && (
            <>
              <div style={historySectionLabel}>Biggest cities ({region.topCities.length})</div>
              <div style={cityGrid}>
                {region.topCities.map((c, i) => (
                  <div key={`${c.name}-${c.lat}-${c.lng}-${i}`} style={cityRow}>
                    <span style={{ color: "#e2e8f0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <span style={{ color: muted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.country ?? c.cc ?? ""}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12, textAlign: "right" }}>{formatPop(c.population)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      {data?.activity && (
        <section style={{ ...panel, marginTop: 16, padding: 15 }}>
          <div style={{ color: "#cbd5e1", fontSize: 13 }}>Activity now</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <span style={activityChip}>⚠ {data.activity.alerts.count} alerts</span>
            <span style={activityChip}>◒ {data.activity.seismic.count} quakes{data.activity.seismic.maxMag ? ` · max M${data.activity.seismic.maxMag.toFixed(1)}` : ""}</span>
            <span style={activityChip}>🌋 {data.activity.volcanic.count} volcanoes</span>
          </div>

          {data.activity.alerts.items.length > 0 && (
            <>
              <div style={historySectionLabel}>Alerts</div>
              <div style={{ display: "grid", gap: 4 }}>
                {data.activity.alerts.items.map((a) => (
                  <div key={a.id} style={activityRow}>
                    <span style={{ color: "#fca5a5", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.event || "Alert"}</span>
                    <span style={{ color: muted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.area || a.headline || ""}</span>
                    <span style={{ color: "#f97316", fontSize: 11, textAlign: "right" }}>sev {a.severity}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.activity.seismic.items.length > 0 && (
            <>
              <div style={historySectionLabel}>Earthquakes</div>
              <div style={{ display: "grid", gap: 4 }}>
                {data.activity.seismic.items.map((q) => (
                  <div key={q.id} style={activityRow}>
                    <span style={{ color: "#e2e8f0", fontSize: 13 }}>M{q.mag.toFixed(1)}</span>
                    <span style={{ color: muted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.place || ""}</span>
                    <span style={{ color: "#94a3b8", fontSize: 11, textAlign: "right" }}>{formatDate(q.time)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.activity.volcanic.items.length > 0 && (
            <>
              <div style={historySectionLabel}>Volcanoes</div>
              <div style={{ display: "grid", gap: 4 }}>
                {data.activity.volcanic.items.map((v) => (
                  <div key={v.id} style={activityRow}>
                    <span style={{ color: "#e2e8f0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                    <span style={{ color: muted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.country || ""}</span>
                    <span style={{ color: "#f59e0b", fontSize: 11, textAlign: "right" }}>{v.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {previewState && (
        <section style={{ ...panel, marginTop: 16, overflow: "hidden" }}>
          <div style={{ padding: "12px 15px", borderBottom: "1px solid #1b2030", color: "#cbd5e1", fontSize: 13 }}>Location preview</div>
          <div style={{ position: "relative", height: 420 }}>
            <GlobeView ref={globe} state={previewState} manifest={null} cities={[]} glowRegionBbox={region.bbox} interactive />
          </div>
        </section>
      )}

      <section style={{ ...panel, marginTop: 16, padding: 15 }}>
        <div style={{ color: "#cbd5e1", fontSize: 13 }}>Area-weather</div>
        <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
          {latest
            ? `Latest snapshot ${formatDate(latest.generatedAt)} · averaged over the region bbox`
            : "No area-weather snapshot yet — run the hourly job or hit Refresh weather on the catalog page."}
        </div>
        {latest && latest.hazards.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {latest.hazards.map((h) => (
              <span key={h.hazard} style={{ color: "#f97316", border: "1px solid #7c3a12", borderRadius: 5, padding: "2px 8px", fontSize: 12 }}>
                ⚠ {h.label}
              </span>
            ))}
          </div>
        )}
        {series.length > 0 && (
          <>
            <div style={historySectionLabel}>Recent trend</div>
            <div style={historyGrid}>
              {series.map((s) => (
                <div key={s.variable} style={historyCard}>
                  <MiniChart label={s.label} color={s.color} units={s.units} points={s.points} avg={s.avg} caption={s.caption} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <PlaceRoundupCard kind="region" placeId={region.regionId} />

      <details style={{ ...panel, padding: 14, marginTop: 16 }}>
        <summary style={{ color: muted, cursor: "pointer", fontSize: 12 }}>Raw region record</summary>
        <pre style={{ margin: "12px 0 0", color: "#aab4c5", fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(region, null, 2)}</pre>
      </details>
    </div>
  );
}

const linkButton: React.CSSProperties = {
  display: "inline-block",
  padding: "7px 11px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: "#1a1f2b",
  color: "#dbeafe",
  textDecoration: "none",
  fontSize: 12,
};
const historySectionLabel: React.CSSProperties = {
  margin: "16px 0 8px",
  color: "#8b95a7",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
};
const historyGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: 12,
};
const historyCard: React.CSSProperties = {
  minWidth: 0,
  padding: 12,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#080c14",
};
const countryChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 5,
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid #1b2030",
  background: "#080c14",
};
const cityGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "4px 14px",
};
const cityRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto auto",
  alignItems: "baseline",
  gap: 8,
  padding: "5px 8px",
  borderBottom: "1px solid #131926",
  minWidth: 0,
};
const activityChip: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #1b2030",
  background: "#080c14",
  color: "#cbd5e1",
  fontSize: 12,
};
const activityRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "baseline",
  gap: 8,
  padding: "5px 8px",
  borderBottom: "1px solid #131926",
  minWidth: 0,
};
