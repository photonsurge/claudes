"use client";

/**
 * Live preview of how an entity looks ON AIR, driven by its edited text + chosen
 * primary image. Builds a synthetic director Segment from the merged entity and
 * renders the REAL broadcast cards: the uniform `OnAirCard` lede (every entity)
 * plus each kind's edit-driven signature card (volcano facts, seismic report).
 * Data-driven deck panels (top cities / forecast / history) are intentionally
 * omitted — they fetch live feeds, not the operator's edits.
 */
import type { Segment, SegmentKind, TrackInfo } from "@photonsurge/shared/director";
import type { AdminEntityType } from "@photonsurge/shared/admin-content/types";
import { adminMediaPath, type AdminImage } from "../../../lib/admin-content/client";
import OnAirCard from "../../broadcast/OnAirCard";
import VolcanoFactsPanel from "../../broadcast/VolcanoFactsPanel";
import QuakeReport from "../../broadcast/QuakeReport";
import { KIND_COLOR, KIND_LABEL } from "../../broadcast/kinds";
import { DeckChromeContext, type DeckChrome } from "../../broadcast/BroadcastCard";
import type { AreaInfo } from "../../broadcast/mode-slides";

/** Which director kind best represents each entity's on-air look. */
const KIND_FOR: Record<AdminEntityType, SegmentKind> = {
  city: "country",
  country: "country",
  region: "tour",
  volcano: "volcano",
  alert: "storm",
  quake: "quake",
  seismic: "quake",
};

const ICON_FOR: Partial<Record<AdminEntityType, string>> = {
  volcano: "🌋",
  alert: "⚠️",
  quake: "🌐",
  seismic: "📡",
};

type Row = { label: string; value: string };
const row = (label: string, value: unknown): Row | null =>
  value === undefined || value === null || value === "" ? null : { label, value: String(value) };

const num = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString() : undefined;

const bboxCenter = (bbox: unknown): [number, number] =>
  Array.isArray(bbox) && bbox.length === 4
    ? [(Number(bbox[0]) + Number(bbox[2])) / 2, (Number(bbox[1]) + Number(bbox[3])) / 2]
    : [0, 0];

interface Built {
  chrome: DeckChrome;
  segment: Segment;
  areaInfo: AreaInfo | null;
  signature: React.ReactNode;
}

function build(type: AdminEntityType, e: Record<string, any>, images: AdminImage[]): Built {
  const kind = KIND_FOR[type];
  const color = KIND_COLOR[kind];
  const primary = images.find((im) => im.primary) ?? images[0] ?? null;
  const photo = primary
    ? adminMediaPath(primary.id, primary.updatedAt)
    : (e.wikiPhoto as string) || (e.wikiThumb as string) || null;
  const gallery = images.map((im) => adminMediaPath(im.id, im.updatedAt));

  let title = String(e.name ?? "");
  let subtitle: string | undefined;
  let center: [number, number] = [Number(e.lng) || 0, Number(e.lat) || 0];
  const details: Row[] = [];
  let signature: React.ReactNode = null;
  let blurb: string | null = (e.wikiExtract as string) || null;
  let areaName = title;

  switch (type) {
    case "city":
      subtitle = [e.region, e.country].filter(Boolean).join(" · ") || undefined;
      details.push(...[row("Population", num(e.population)), row("Elevation", e.elevationM ? `${e.elevationM} m` : "")].filter(Boolean) as Row[]);
      break;
    case "country":
      center = bboxCenter(e.bbox);
      subtitle = [e.continent, e.subregion].filter(Boolean).join(" · ") || undefined;
      details.push(...[row("Capital", e.capital), row("Population", num(e.population)), row("Currency", e.currency)].filter(Boolean) as Row[]);
      break;
    case "region":
      center = bboxCenter(e.bbox);
      subtitle = e.group ? String(e.group) : undefined;
      break;
    case "volcano": {
      subtitle = [e.volcanoType, e.country].filter(Boolean).join(" · ") || undefined;
      details.push(...[row("Status", e.status), row("Type", e.volcanoType), row("Elevation", e.elevationM ? `${e.elevationM} m` : "")].filter(Boolean) as Row[]);
      blurb = (e.wikiExtract as string) || (e.latestReport as string) || null;
      const facts = [e.volcanoType, e.elevationM ? `${e.elevationM} m` : null, e.lastEruptionYear ? `last erupted ${e.lastEruptionYear}` : null].filter(Boolean).join(" · ");
      const info: TrackInfo = {
        gallery: gallery.length ? gallery : undefined,
        facts: facts || undefined,
        alert:
          e.usgsColorCode || e.usgsAlertLevel || e.usgsNoticeSynopsis
            ? { colorCode: e.usgsColorCode, level: e.usgsAlertLevel, synopsis: e.usgsNoticeSynopsis }
            : undefined,
        reportFacts: (e.latestReport as string) || undefined,
      };
      signature = <VolcanoFactsPanel info={info} color={color} />;
      break;
    }
    case "alert": {
      const i = Array.isArray(e.info) ? e.info[0] ?? {} : {};
      title = String(i.event || i.headline || "Alert");
      subtitle = i.headline && i.headline !== title ? String(i.headline) : undefined;
      areaName = String((Array.isArray(i.area) && i.area[0]?.areaDesc) || e.sender || "Alert");
      blurb = (i.description as string) || null;
      details.push(...[row("Severity", i.severity), row("Urgency", i.urgency), row("Action", i.instruction)].filter(Boolean) as Row[]);
      break;
    }
    case "quake": {
      const mag = Number(e.mag) || 0;
      const depthKm = Number(e.depthKm) || 0;
      title = e.place ? String(e.place) : `M${mag.toFixed(1)} earthquake`;
      subtitle = `M${mag.toFixed(1)} · ${Math.round(depthKm)} km deep`;
      areaName = String(e.place || "Epicentre");
      details.push(...[row("Magnitude", `M${mag.toFixed(1)}`), row("Depth", `${Math.round(depthKm)} km`)].filter(Boolean) as Row[]);
      signature = <QuakeReport mag={mag} depthKm={depthKm} center={center} cities={[]} color={color} />;
      break;
    }
    case "seismic":
      title = String(e.siteName || e.key || `${e.net}.${e.sta}`);
      subtitle = [e.net && e.sta ? `${e.net}.${e.sta}` : null, e.cha].filter(Boolean).join(" · ") || undefined;
      areaName = title;
      details.push(...[row("Network", e.net), row("Channel", e.cha), row("Elevation", e.elevation ? `${e.elevation} m` : "")].filter(Boolean) as Row[]);
      break;
  }

  const segment: Segment = {
    id: `preview:${type}`,
    kind,
    title: title || "—",
    icon: ICON_FOR[type],
    subtitle,
    camera: { center, zoom: 4 },
    patch: {},
    holdMs: 0,
    details: details.slice(0, 3),
    ...(type === "quake" ? { quake: { mag: Number(e.mag) || 0, depthKm: Number(e.depthKm) || 0 } } : {}),
  };

  const areaInfo: AreaInfo | null =
    photo || blurb ? { name: areaName || title, photo: photo ?? null, blurb: blurb ?? null } : null;

  // The deck's shared template: the event-type badge + title header repeated on
  // every slide (exactly how the on-air SlideDeck injects it via context).
  const chrome: DeckChrome = { badge: KIND_LABEL[kind], badgeColor: color, title: title || "—", accent: color };

  return { chrome, segment, areaInfo, signature };
}

export default function OnAirPreview({
  type,
  entity,
  images,
}: {
  type: AdminEntityType;
  entity: Record<string, any>;
  images: AdminImage[];
}) {
  const { chrome, segment, areaInfo, signature } = build(type, entity, images);

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#5b6577", marginBottom: 10 }}>
        ON-AIR PREVIEW
      </div>
      <div
        style={{
          background: "radial-gradient(120% 120% at 30% 10%, #12203a 0%, #060b14 60%)",
          border: "1px solid #1b2030",
          borderRadius: 10,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        {/* Provide the same deck chrome (badge + title header) the on-air SlideDeck
            injects, so each card reads exactly as it does on air. */}
        <DeckChromeContext.Provider value={chrome}>
          <OnAirCard segment={segment} areaInfo={areaInfo} />
          {signature}
        </DeckChromeContext.Provider>
      </div>
      <div style={{ fontSize: 11, color: "#5b6577", marginTop: 8 }}>
        The uniform lede plus this kind&apos;s signature card, with the on-air header. Live-data cards (nearby cities, forecast, history) aren&apos;t shown.
      </div>
    </div>
  );
}
