# appSandbox — mobile, app-like `/sandbox`

status: PLAN — ready to implement

## Context
Make the interactive `/sandbox` globe usable on a phone and **look like an app**,
in the **same codebase** (no fork, no React Native). The globe is deck.gl WebGL2
(`_GlobeView`), so the approach is a mobile-optimized page you can install to the
home screen (PWA) — full-screen, own icon, no browser chrome. A Capacitor store
shell around the *same* page is a later bolt-on, not built now.

## Decisions locked
- **Wrapper:** PWA-first ("looks like an app" via Add to Home Screen). Capacitor deferred.
- **Overlays:** keep all, **cap the heavy trio** on mobile (wind particles, live tracks, all-textures-in-RAM preload).
- **Control UI:** a new simplified touch overlay-toggle sheet (not the full ControlPanel).
- **Single codebase:** new mobile route + PWA scaffolding inside `public`; heavy work reuses existing hooks/components.

## Deliverables (build now)

### 1. Doc write-up → `docs/app-sandbox-mobile-plan.md`
The refined feasibility + approach (this file's content, repo-styled `#` H1): why
PWA-not-rewrite, the remote/relative-URL + env socket + no-auth facts, the
per-overlay mobile-readiness table, the capping strategy, and the Capacitor-later note.

### 2. `appSandbox` — mobile sandbox route in `public`
New route `public/src/app/appSandbox/page.tsx` (mirrors [sandbox/page.tsx](public/src/app/sandbox/page.tsx), mobile-first):
- **Full-screen globe** — `100dvh` / `fixed inset:0` (not the `100vh` two-pane + 360px `aside`).
- Reuses the exact sandbox data path: `fetchSceneState(MAIN_SCENE_ID)` (defaults, no auth), `fetchManifest`, `listCities`, all `use*` overlay hooks, `GlobeView`, socket live-refresh.
- **New `public/src/components/MobileOverlaySheet.tsx`** — a touch-sized bottom sheet exposing the map-overlay booleans (`showAlerts`, `showSeismic`, `showAurora`, `showMagneticField`, `showSatImg`, `showFires`, `showVolcanoes`, `showCables`, `showFaults`, `showSatellites/Aircraft/Ships`) + variable picker, writing the **same `ControlState`** via the same `apply(next)` setter. Reuses the `Toggle` idiom from [ControlPanel.tsx:1003-1023](public/src/components/ControlPanel.tsx#L1003).
- **Curated caps on mobile** (thread a `mobile` flag into layer props): clamp wind `numParticles` ([props.ts:117](public/src/components/layers/props.ts#L117)), lower track caps + skip dense global fetch ([useTracks.ts:55-66](public/src/lib/tracks/useTracks.ts#L55)), trim texture preload to the active variable ([Globe.tsx:764-774](public/src/components/Globe.tsx#L764)); seed a mobile ControlState with the memory-heavy overlays (satimg, wind) default-off.
- Keep corner readouts minimal (Legend + selected-point card) so they don't crowd a narrow screen.

### 3. PWA scaffolding (makes it "an app")
- `public/public/manifest.webmanifest` — `name`, `display: "standalone"`, `start_url: "/appSandbox"`, `theme_color`, icons (source from existing `public/public/LogoHorizontal.png`).
- `viewport` (with `viewport-fit=cover`) + `apple-mobile-web-app-*` + manifest link in [layout.tsx](public/src/app/layout.tsx) (or route metadata). No viewport meta exists today.
- Minimal service worker only if needed for install; app is a live client (online-only is fine).

## Out of scope now
Capacitor native shell + store submission (identical page, add later); `/watch` mobile chrome; audio (bed not mounted on sandbox).

## Verification
1. `public` dev → open `/appSandbox` in Chrome device-mode (iPhone/mid-Android viewport): full-screen globe, overlay sheet toggles each layer, capped wind/tracks, no desktop sidebar.
2. Deploy → Android Chrome / iOS Safari "Add to Home Screen" → launches full-screen, no browser bars, own icon.
3. On a real phone: touch pan/pinch/tap-select; socket connects (guest JWT) and `WEATHER_RUN`/`CITIES_UPDATED` refresh; watch FPS/thermals with overlays on.
4. Regression: existing `/sandbox` unchanged; run `./test`.
