"use client";

/**
 * Bottom-left sponsor billboard — the always-on corner card rotating through
 * every active `billboard`-placed image creative (see shared/ads/billboard).
 * Rotation is wall-clock derived (billboardIndex), so every /watch output
 * shows the same creative at the same moment with no server coordination;
 * consecutive creatives cross-fade like the rest of the broadcast chrome.
 *
 * The corner is not a fixed hole — the top-anchored left deck above grows
 * (Kp stack, tracking header), so BroadcastFrame passes the free band as
 * `maxHeight` (design px, pre-scale) and this clamps its media box to fit,
 * rendering nothing under the floor (targeted-event tracking modes — where
 * yielding the corner is editorially right anyway) or when nothing is placed.
 * Pointer-inert like the rest of the /watch surface.
 */
import { useEffect, useRef, useState } from "react";
import {
  BILLBOARD_HOLD_MS,
  billboardIndex,
  type BillboardAd,
} from "@photonsurge/shared/ads/billboard";
import { CARD_W } from "./BroadcastCard";
import {
  GodsPanel,
  GODS_TILE,
  GODS_TILE_BORDER,
  INK_DIM,
  INK_FAINT,
  MONO,
  accentRule,
  GODS_ACCENT,
} from "./GodsPanel";

/** Below this free band (design px) the corner yields — no cramped creative. */
export const BILLBOARD_MIN_H = 100;

/** Panel overhead around the media box: border+padding+header+gap. */
const CHROME_H = 58;
const FADE_MS = 450;

export interface SponsorBillboardProps {
  ads: BillboardAd[];
  /** Free vertical band for the whole panel, design px (pre-scale). */
  maxHeight: number;
  /** Cut-transition hide, like the deck's FadeSwap window. */
  hidden?: boolean;
  accent?: string;
}

export default function SponsorBillboard({
  ads,
  maxHeight,
  hidden = false,
  accent = GODS_ACCENT,
}: SponsorBillboardProps) {
  const [index, setIndex] = useState(() => billboardIndex(Date.now(), ads.length));
  // The outgoing creative, kept mounted through its fade-out for a cross-fade.
  const [prev, setPrev] = useState<BillboardAd | null>(null);
  const prevTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownRef = useRef<BillboardAd | null>(null);

  // Advance on the shared wall-clock boundary (aligned setTimeout, re-armed
  // each tick) so every channel flips creative together.
  useEffect(() => {
    setIndex(billboardIndex(Date.now(), ads.length));
    if (ads.length <= 1) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const wait = BILLBOARD_HOLD_MS - (Date.now() % BILLBOARD_HOLD_MS) + 20;
      timer = setTimeout(() => {
        setIndex(billboardIndex(Date.now(), ads.length));
        arm();
      }, wait);
    };
    arm();
    return () => clearTimeout(timer);
  }, [ads]);

  const ad = ads.length ? ads[Math.min(index, ads.length - 1)] : null;

  // A creative change starts the outgoing layer's fade-out.
  useEffect(() => {
    const last = shownRef.current;
    shownRef.current = ad;
    if (!last || !ad || last.adId === ad.adId) return;
    setPrev(last);
    if (prevTimer.current) clearTimeout(prevTimer.current);
    prevTimer.current = setTimeout(() => setPrev(null), FADE_MS);
    return () => {
      if (prevTimer.current) clearTimeout(prevTimer.current);
    };
  }, [ad?.adId]);

  if (!ad || maxHeight < BILLBOARD_MIN_H) return null;

  const mediaH = Math.min(maxHeight, 220) - CHROME_H;
  const sponsor = (ad.advertiser?.trim() || ad.title).toUpperCase();

  return (
    <div
      data-testid="sponsor-billboard"
      style={{
        opacity: hidden ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    >
      <GodsPanel width={CARD_W} notch={[10, 18]} padding="10px 14px 12px" gap={8}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              color: INK_FAINT,
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: 3,
              whiteSpace: "nowrap",
            }}
          >
            SPONSORED
          </div>
          <div style={{ flex: 1, height: 1, background: accentRule(accent) }} />
          <div
            style={{
              color: INK_DIM,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 220,
            }}
          >
            {sponsor}
          </div>
        </div>
        <div
          style={{
            position: "relative",
            height: mediaH,
            background: GODS_TILE,
            border: `1px solid ${GODS_TILE_BORDER}`,
            overflow: "hidden",
          }}
        >
          {prev && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`out-${prev.adId}`}
              src={prev.mediaUrl}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                animation: `sbFadeOut ${FADE_MS}ms ease forwards`,
              }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={ad.adId}
            src={ad.mediaUrl}
            alt={ad.title}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              animation: prev ? `sbFadeIn ${FADE_MS}ms ease` : undefined,
            }}
          />
          <style>{`@keyframes sbFadeIn{from{opacity:0}to{opacity:1}}
@keyframes sbFadeOut{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion: reduce){[data-testid="sponsor-billboard"] img{animation:none !important}}`}</style>
        </div>
      </GodsPanel>
    </div>
  );
}
