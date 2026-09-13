#!/usr/bin/env node
/**
 * check-flag-font.mjs — does a deployment actually draw country flags on air?
 *
 *   node scripts/check-flag-font.mjs http://localhost:10100/watch
 *   node scripts/check-flag-font.mjs https://<host>/watch/<scene>?token=…
 *   node scripts/check-flag-font.mjs <url> --keep   # leave the crops on disk
 *
 * WHY THIS EXISTS
 * Country flags are regional-indicator emoji (U+1F1E6-1F1FF), so they draw only
 * if the box running the browser owns a font covering that block. A normal
 * workstation's Chrome does; the Chromium embedded in OBS on the encoder host
 * does NOT. That asymmetry is the whole trap: the operator's preview is not
 * evidence about the stream, and the bug reads as "the fonts are fine here".
 *
 * The app answers it by self-hosting a flags-only slice of Noto Color Emoji
 * (public/public/fonts, declared in src/app/globals.css over that range only).
 * This script checks that the fix is actually reaching a given deployment, in
 * the only way that counts — by reproducing the encoder box:
 *
 *   1. fetch the font URL the stylesheet points at, and confirm the bytes are a
 *      real woff2 (a stale image or a lost static dir 404s or serves HTML here);
 *   2. load the page in Chromium under a FONTCONFIG_FILE that exposes ONE plain
 *      text font and no emoji font whatsoever, which is the OBS box;
 *   3. draw a flag in each family the broadcast chrome sets directly and count
 *      the COLOURED pixels. A flag is colourful; a .notdef box is the text
 *      colour. That distinction is the measurement — a width, or a
 *      `document.fonts.check()`, still passes while boxes are on screen.
 *
 * Exit code 0 = flags drew, 1 = they did not (or the page would not load).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
// playwright is a devDependency of the `public` workspace, not of the repo root.
const require = createRequire(path.join(REPO, "public", "package.json"));

const FONT_PATH = "/fonts/noto-color-emoji-flags.woff2";
/** 🇨🇳 — a red flag, so "did it draw" is a question about saturated pixels. */
const FLAG = "\u{1F1E8}\u{1F1F3}";

/**
 * The stacks the on-air chrome actually writes into `fontFamily`, kept in step
 * with src/lib/fonts.ts. Every one of them LEADS with the flag family, which is
 * the fix these probes exist to verify: an earlier attempt instead re-declared
 * `Saira` / `JetBrains Mono` in globals.css over the flag range, and that is
 * silently defeated by the Google Fonts stylesheet declaring the same families
 * at exact weights. Probing a bare `Saira, …` stack now would be testing
 * something the app no longer ships.
 */
const FLAG_FAMILY = '"Noto Color Emoji Flags"';
const PROBES = [
  { id: "sans", label: "BRAND_SANS (GodsPanel SANS — cards, ACTIVE FEED)", family: `${FLAG_FAMILY}, Saira, 'Helvetica Neue', Helvetica, sans-serif` },
  { id: "mono", label: "BRAND_MONO (GodsPanel MONO — badges, readouts)", family: `${FLAG_FAMILY}, 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace` },
  { id: "body", label: "inherited body stack (lib/fonts UI_SANS)", family: "inherit" },
];

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("-"));
const keep = args.includes("--keep");
if (!url) {
  console.error("usage: node scripts/check-flag-font.mjs <url of a /watch page> [--keep]");
  process.exit(2);
}

/**
 * A fontconfig tree holding exactly one ordinary text face and no emoji face.
 * This is the point of the whole script: the encoder's Chromium is not missing
 * "some" fonts, it is missing the emoji font specifically, and a machine that
 * has one cannot observe the bug.
 */
function buildBareFontEnv(dir) {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  ];
  const face = candidates.find((p) => fs.existsSync(p));
  if (!face) return null;
  const fontsDir = path.join(dir, "fonts");
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.copyFileSync(face, path.join(fontsDir, path.basename(face)));
  const conf = path.join(dir, "fonts.conf");
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir}</dir>
  <cachedir>${path.join(dir, "fccache")}</cachedir>
  <match target="pattern">
    <edit name="family" mode="prepend" binding="strong"><string>${path.basename(face, path.extname(face))}</string></edit>
  </match>
</fontconfig>
`,
  );
  return conf;
}

/**
 * Draw the flag in each family and count its pixels — INSIDE the page.
 *
 * This used to screenshot a probe element through Playwright, which hangs on a
 * live /watch: `locator.screenshot()` waits for the element to hold still and
 * for `document.fonts.ready`, and a broadcast page satisfies neither. It is
 * always animating, and it keeps pulling new Google subsets as fresh place
 * names arrive, so the font set never settles. Canvas sidesteps both waits and
 * measures the same thing, because canvas2d resolves families through the same
 * font matching the layout engine uses.
 *
 * The one catch is that canvas does NOT kick off a lazy @font-face fetch — it
 * draws with whatever is already in hand. So each family is explicitly loaded
 * for this text first; without that an unloaded (not broken) face would draw
 * fallback boxes and the check would report a failure that isn't there.
 */
const PROBE_IN_PAGE = ({ probes, flag }) => {
  const body = getComputedStyle(document.body).fontFamily;
  return Promise.all(
    probes.map(async (p) => {
      const family = p.family === "inherit" ? body : p.family;
      let loadError = null;
      try {
        await document.fonts.load(`48px ${family}`, flag);
      } catch (err) {
        loadError = String(err && err.message ? err.message : err);
      }
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 72;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "top";
      ctx.font = `48px ${family}`;
      ctx.fillText(flag, 4, 8);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      // `ink` separates "drew nothing" from "drew a box": a .notdef box is ink
      // with no colour, and blank is neither. Both fail, for different reasons.
      let coloured = 0;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (Math.max(r, g, b) > 24) ink += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured += 1;
      }
      return { id: p.id, family, coloured, ink, loadError, png: c.toDataURL("image/png") };
    }),
  );
};

async function main() {
  const origin = new URL(url).origin;
  const fontUrl = origin + FONT_PATH;

  // ── 1. the bytes the stylesheet asks for ───────────────────────────────────
  let fontOk = false;
  try {
    const res = await fetch(fontUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const magic = buf.subarray(0, 4).toString("latin1");
    fontOk = res.ok && magic === "wOF2";
    console.log(
      `font   ${fontUrl}\n       ${res.status} ${res.headers.get("content-type") ?? "?"} · ${buf.length} bytes · magic ${JSON.stringify(magic)}`,
    );
    if (!fontOk) {
      console.log(
        res.ok
          ? "       NOT a woff2 — the static dir is missing this file and something else answered."
          : "       the deployment is not serving the flag font at all (stale image, or public/public lost).",
      );
    }
  } catch (err) {
    console.log(`font   ${fontUrl}\n       unreachable: ${err.message}`);
  }

  // ── 2 & 3. the page, in a browser with no emoji font ───────────────────────
  const { chromium } = require("playwright");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flagfont-"));
  const conf = buildBareFontEnv(tmp);
  if (!conf) console.log("\nnote   no DejaVu/Liberation found — running with THIS box's fonts, which may mask the bug.");
  if (conf) process.env.FONTCONFIG_FILE = conf;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  let failed = 0;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Raced, never awaited outright: `document.fonts.ready` only settles once
    // nothing is loading, and a broadcast page keeps pulling new Google subsets
    // as fresh place names arrive. Waiting for quiet that may never come is the
    // same trap the probes used to fall into. The probes load what they need
    // themselves, so this is only a courtesy pause.
    await page.evaluate(
      () => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 10_000))]),
    );
    await page.waitForTimeout(3000); // let a swap-period face land

    /** Every @font-face covering the flag block, with its load status. */
    const readFaces = () =>
      page.evaluate(() =>
        [...document.fonts]
          .filter((f) => (f.unicodeRange || "").includes("1F1E6"))
          .map((f) => `${f.family} · ${f.status}`),
      );

    // Taken BEFORE the probes go in, so it describes the page's own content
    // rather than anything this script forced. CSS font loading is lazy per
    // face: a face only fetches once a character in its range is laid out in
    // that family, so `unloaded` here means "no flag happens to be on screen in
    // this family", which is the normal state of the mono family (badges,
    // timers, readouts — none of them carry a flag). Only `error` is a fault.
    const before = await readFaces();
    console.log(
      `\nfaces  on the page's own content (lazy — 'unloaded' just means no flag is on screen in that family):\n       ${
        before.length ? before.join("\n       ") : "NONE — globals.css never declared the flag range on this page."
      }`,
    );

    // Measured in the page (see PROBE_IN_PAGE) rather than screenshotted, so a
    // live broadcast surface that never stops animating cannot stall the check.
    const results = await page.evaluate(PROBE_IN_PAGE, { probes: PROBES, flag: FLAG });

    console.log("");
    for (const p of PROBES) {
      const r = results.find((x) => x.id === p.id);
      const ok = r.coloured > 80;
      if (!ok) failed += 1;
      const verdict = ok ? "FLAG" : r.ink > 40 ? "BOXES" : "BLANK";
      const file = path.join(tmp, `${p.id}.png`);
      fs.writeFileSync(file, Buffer.from(r.png.split(",")[1], "base64"));
      console.log(`probe  ${p.label}\n       ${verdict} · ${r.coloured} coloured px of ${r.ink} inked${keep || !ok ? ` · ${file}` : ""}`);
      if (r.loadError) console.log(`       font load rejected: ${r.loadError}`);
      if (!ok) console.log(`       resolved stack: ${r.family}`);
    }

    // Now every family has had a flag laid out in it, so this snapshot is the
    // real verdict on the faces themselves: anything still short of `loaded`
    // here failed to fetch, and that IS a fault.
    const after = await readFaces();
    console.log(`\nfaces  after the probes forced every family:\n       ${after.join("\n       ")}`);
    // " · loaded" in full: `"unloaded".endsWith("loaded")` is true, and that is
    // exactly the status this has to catch.
    const broken = after.filter((f) => !f.endsWith(" · loaded"));
    if (broken.length) {
      failed += 1;
      console.log(`       ${broken.length} face(s) never loaded — the font URL is not being served to this browser.`);
    }
  } catch (err) {
    console.error(`\npage   ${url}\n       ${err.message}`);
    failed += 1;
  } finally {
    await browser.close();
  }

  const ok = failed === 0 && fontOk;
  console.log(`\n${ok ? "PASS — flags draw on a box with no emoji font." : "FAIL — this deployment shows .notdef boxes where flags belong."}`);
  if (!keep && ok) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log(`crops  ${tmp}`);
  process.exit(ok ? 0 : 1);
}

main();
