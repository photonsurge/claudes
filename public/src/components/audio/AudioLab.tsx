"use client";

/**
 * AudioLab — the /music sandbox for the generative broadcast bed. Drives an
 * AuroraBed engine (public/src/lib/audio/engine.ts) with a transport, a weather
 * "severity" control (stand-in for the director's on-air segment) and a per-stem
 * mixer, plus a live spectrum. High-frequency readouts (energy bar, beat strip,
 * stem LEDs, spectrum) are updated imperatively via refs on a rAF, not React
 * state, so the animation stays cheap. Next step is to hang the same engine off
 * useDirector inside WatchSurface.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AuroraBed, STEMS } from "../../lib/audio/engine";
import { type BedWeather, moodFrom } from "../../lib/audio/weather";

/** Lab slider values — the non-null subset of BedWeather. */
type WxNums = Record<keyof BedWeather, number>;

const PRESETS = [
  { label: "Calm ocean", sub: "intro · chill", sev: 0, riser: false, kc: "var(--teal)" },
  { label: "Weather tour", sub: "lounge house", sev: 26, riser: false, kc: "var(--aurora)" },
  { label: "Orbital pass", sub: "minimal techno", sev: 52, riser: true, kc: "var(--violet)" },
  { label: "Severe / quake", sub: "breaks · tension", sev: 76, riser: true, kc: "var(--severe)" },
];

export default function AudioLab() {
  const bedRef = useRef<AuroraBed | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sev, setSev] = useState(0);
  const [vol, setVol] = useState(70);
  const [preset, setPreset] = useState(0);
  const [stemOn, setStemOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STEMS.map((s) => [s.id, true])),
  );
  // mirror for the rAF closure (which is created once, on mount).
  const stemOnRef = useRef(stemOn);
  useEffect(() => {
    stemOnRef.current = stemOn;
  }, [stemOn]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const energyRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLSpanElement | null>(null);
  const keyRef = useRef<HTMLSpanElement | null>(null);
  const phraseRef = useRef<HTMLSpanElement | null>(null);
  const beatRefs = useRef<HTMLDivElement[]>([]);
  const ledRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  // engine + animation loop
  useEffect(() => {
    const bed = new AuroraBed();
    bedRef.current = bed;
    const canvas = canvasRef.current!;
    const g = canvas.getContext("2d")!;
    let vw = 0;
    let vh = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      vw = r.width;
      vh = r.height;
      canvas.width = vw * dpr;
      canvas.height = vh * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);

    let raf = 0;
    let curLabel = "";
    const bins = 72;
    const draw = () => {
      const st = bed.getState();
      const e = st.energy;

      if (energyRef.current) energyRef.current.style.width = (e * 100).toFixed(0) + "%";
      if (keyRef.current && keyRef.current.textContent !== st.key) keyRef.current.textContent = st.key;
      if (phraseRef.current && phraseRef.current.textContent !== st.phrase) phraseRef.current.textContent = st.phrase;
      if (sectionRef.current) {
        const label = st.section.name + (st.inBreak ? " · breakdown" : "");
        if (label !== curLabel) {
          curLabel = label;
          sectionRef.current.textContent = st.section.name;
          sectionRef.current.className = "ro-v big " + st.section.cls;
          const fx = sectionRef.current.querySelector<HTMLSpanElement>(".fx");
          if (fx) fx.remove();
          if (st.inBreak) {
            const s = document.createElement("span");
            s.className = "fx";
            s.textContent = "· breakdown";
            sectionRef.current.appendChild(s);
          }
        }
      }

      for (let i = 0; i < 16; i++) {
        const b = beatRefs.current[i];
        if (!b) continue;
        const active = st.playing && i === st.beatStep;
        const isKick =
          active && !st.inBreak && e > 0.34 && (e <= 0.75 ? i % 4 === 0 : i === 0 || i === 6 || i === 10);
        b.className = "beat" + (i % 4 === 0 ? " q" : "") + (active ? " on" : "") + (isKick ? " kick" : "");
      }

      for (const s of STEMS) {
        const led = ledRefs.current[s.id];
        if (!led) continue;
        const lit = st.playing && stemOnRef.current[s.id] && s.live(e) && !(st.inBreak && s.drum);
        led.style.background = lit ? s.color : "";
        led.style.boxShadow = lit ? `0 0 8px ${s.color}` : "";
      }

      // spectrum
      const data = bed.spectrum();
      g.clearRect(0, 0, vw, vh);
      const step = Math.floor((data.length * 0.62) / bins);
      const grad = g.createLinearGradient(0, vh, 0, 0);
      grad.addColorStop(0, "rgba(53,214,208,0.05)");
      grad.addColorStop(0.5, `rgba(84,230,166,${0.14 + e * 0.3})`);
      grad.addColorStop(1, `rgba(169,139,255,${0.25 + e * 0.35})`);
      const crest = () => {
        for (let i = 0; i < bins; i++) {
          let v = 0;
          for (let j = 0; j < step; j++) v += data[i * step + j];
          v = v / step / 255;
          const x = (i / (bins - 1)) * vw;
          const y = vh - Math.pow(v, 1.35) * vh * 0.82;
          g.lineTo(x, y);
        }
      };
      g.beginPath();
      g.moveTo(0, vh);
      crest();
      g.lineTo(vw, vh);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
      g.beginPath();
      g.moveTo(0, vh);
      crest();
      g.strokeStyle = `rgba(140,245,205,${0.5 + e * 0.4})`;
      g.lineWidth = 1.4;
      g.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      bed.stop();
    };
    // stemOn is read via closure each frame; we intentionally don't re-init on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [wx, setWx] = useState<WxNums>({ wind: 0, gust: 0, rain: 0, temp: 15, kp: 2 });
  const applyWx = (patch: Partial<WxNums>) => {
    setWx((w) => {
      const next = { ...w, ...patch };
      bedRef.current?.setWeather(moodFrom(next));
      return next;
    });
  };
  const toggle = () => setPlaying(bedRef.current?.toggle() ?? false);
  const applySeverity = (pct: number, riser: boolean) => {
    setSev(pct);
    bedRef.current?.setSeverity(pct / 100);
    if (riser) bedRef.current?.triggerEvent();
  };
  const setStem = (id: string) => {
    setStemOn((m) => {
      const on = !m[id];
      bedRef.current?.setStem(id, on);
      return { ...m, [id]: on };
    });
  };

  return (
    <div className="aurora-lab">
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="brand">
            <div className="kicker">Live Weather Globe · Audio Bed</div>
            <h1>
              Aurora <b>Bed</b> — generative broadcast music
            </h1>
            <div className="sub">
              An infinite, copyright-safe music engine synthesized live in the browser: FM Rhodes comping, a supersaw
              wash, a motif lead and a swung groove that breaks down and builds back on its own — chill by default,
              leaning up only when the weather turns severe.
            </div>
          </div>
          <div className={"status" + (playing ? " live" : "")}>
            <span className="dot" />
            <span>{playing ? "On air" : "Standby"}</span>
          </div>
        </header>

        <div className="panel transport">
          <div className="deck">
            <button className={"play" + (playing ? " playing" : "")} onClick={toggle} aria-label="Play/stop">
              <svg viewBox="0 0 24 24">
                {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </button>
            <div className="play-hint">{playing ? "Synthesizing live" : "Click to start"}</div>
            <div className="readouts">
              <div className="ro">
                <span className="ro-l">Section / mood</span>
                <span className="ro-v big" ref={sectionRef}>
                  —
                </span>
              </div>
              <div className="ro">
                <span className="ro-l">Energy</span>
                <div className="meter">
                  <i ref={energyRef} />
                </div>
              </div>
              <div className="ro" style={{ flexDirection: "row", gap: 22 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span className="ro-l">Tempo</span>
                  <span className="ro-v">121 BPM</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span className="ro-l">Key</span>
                  <span className="ro-v" ref={keyRef}>
                    —
                  </span>
                </div>
              </div>
              <div className="ro">
                <span className="ro-l">Phrase</span>
                <span className="ro-v" ref={phraseRef}>
                  —
                </span>
              </div>
            </div>
          </div>
          <div className="viz-wrap">
            <span className="viz-label">Spectrum</span>
            <canvas ref={canvasRef} />
            <div className="beatstrip">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className={"beat" + (i % 4 === 0 ? " q" : "")}
                  ref={(el) => {
                    if (el) beatRefs.current[i] = el;
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="racks">
          <div className="panel">
            <div className="panel-h">
              Reactivity <span className="tag">weather → energy</span>
            </div>
            <div className="rack-body">
              <div className="field">
                <div className="field-l">
                  <span>Weather severity</span>
                  <b>{sev}%</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sev}
                  onChange={(e) => {
                    setPreset(-1);
                    applySeverity(+e.target.value, false);
                  }}
                  aria-label="Weather severity"
                />
              </div>
              <div className="presets">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    className={"chip" + (preset === i ? " active" : "")}
                    style={{ "--kc": p.kc } as CSSProperties}
                    onClick={() => {
                      setPreset(i);
                      applySeverity(p.sev, p.riser);
                    }}
                  >
                    <span className="kd">{p.label}</span>
                    <small>{p.sub}</small>
                  </button>
                ))}
              </div>
              <button className="evt" onClick={() => bedRef.current?.triggerEvent()}>
                ▲ Trigger event pulse
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              Conditions <span className="tag">weather → mood</span>
            </div>
            <div className="rack-body">
              {(
                [
                  { k: "wind", label: "Wind", unit: "m/s", min: 0, max: 25, step: 1 },
                  { k: "rain", label: "Rain", unit: "mm/h", min: 0, max: 10, step: 0.5 },
                  { k: "temp", label: "Temperature", unit: "°C", min: -15, max: 40, step: 1 },
                  { k: "kp", label: "Aurora Kp", unit: "", min: 0, max: 9, step: 1 },
                ] as const
              ).map((f) => (
                <div className="field" key={f.k}>
                  <div className="field-l">
                    <span>{f.label}</span>
                    <b>
                      {wx[f.k]}
                      {f.unit && ` ${f.unit}`}
                    </b>
                  </div>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={wx[f.k]}
                    onChange={(e) => applyWx({ [f.k]: +e.target.value })}
                    aria-label={f.label}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              Mixer <span className="tag">stems</span>
            </div>
            <div className="rack-body">
              <div className="stems">
                {STEMS.map((s) => (
                  <div key={s.id} className={"stem" + (stemOn[s.id] ? "" : " muted")}>
                    <span
                      className="led"
                      ref={(el) => {
                        ledRefs.current[s.id] = el;
                      }}
                    />
                    <span className="stem-n">
                      {s.name}
                      <small>{s.note}</small>
                    </span>
                    <button
                      className="sw"
                      role="switch"
                      aria-checked={stemOn[s.id]}
                      aria-label={s.name}
                      onClick={() => setStem(s.id)}
                    />
                  </div>
                ))}
              </div>
              <div className="master field">
                <div className="field-l">
                  <span>Master</span>
                  <b>{vol}%</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={vol}
                  onChange={(e) => {
                    setVol(+e.target.value);
                    bedRef.current?.setMasterVolume(+e.target.value / 100);
                  }}
                  aria-label="Master volume"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="note">
          <div className="panel card">
            <h3>Zero copyright risk</h3>
            <p>
              Every sound is <b>synthesized from oscillators and noise</b> in real time — FM Rhodes, supersaw pads,
              motif lead, synth drums. Nothing sampled or licensed, so no Content ID claims on a 24/7 stream.
            </p>
          </div>
          <div className="panel card">
            <h3>Never repeats</h3>
            <p>
              An <b>8-bar jazz progression</b>, a regenerating melodic motif and 16-bar breakdown/build cycles keep it
              moving for hours. Voices fade in and out with energy; nothing loops.
            </p>
          </div>
          <div className="panel card">
            <h3>Follows the weather</h3>
            <p>
              One energy value drives the whole arrangement. In the app it comes from the director&apos;s{" "}
              <b>on-air segment</b> — calm globe stays lounge, a severe storm or quake pushes it into breaks. The
              presets stand in for that.
            </p>
          </div>
        </div>

        <footer className="legal">
          Prototype · Web Audio API, no libraries · engine at <b>public/src/lib/audio/engine.ts</b>
          <br />
          Audio starts on click (browser autoplay policy) — in OBS the operator un-mutes once.
        </footer>
      </div>
    </div>
  );
}

const CSS = `
.aurora-lab {
  --bg:#080b11; --bg2:#0b111b; --panel:#111a28; --panel2:#0d1521; --edge:#1e2c40; --edge2:#294060;
  --ink:#d6dfec; --muted:#6a7d97; --dim:#3c4b60; --aurora:#54e6a6; --aurora-d:#2fae7d;
  --teal:#35d6d0; --violet:#a98bff; --severe:#ff5f6d; --amber:#ffb454;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif;
  min-height:100vh; color:var(--ink); font-family:var(--mono); font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased;
  background:
    radial-gradient(1100px 620px at 18% -8%, rgba(84,230,166,0.10), transparent 60%),
    radial-gradient(900px 560px at 96% 8%, rgba(169,139,255,0.10), transparent 62%),
    radial-gradient(700px 500px at 60% 120%, rgba(53,214,208,0.06), transparent 60%),
    linear-gradient(180deg, var(--bg2), var(--bg));
}
.aurora-lab * { box-sizing:border-box; }
.aurora-lab .wrap { max-width:1000px; margin:0 auto; padding:30px 22px 60px; display:flex; flex-direction:column; gap:18px; }
.aurora-lab header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; }
.aurora-lab .brand { display:flex; flex-direction:column; gap:8px; }
.aurora-lab .kicker { font-size:11px; letter-spacing:0.32em; text-transform:uppercase; color:var(--aurora); display:flex; align-items:center; gap:9px; }
.aurora-lab .kicker::before { content:""; width:20px; height:1px; background:var(--aurora); opacity:0.7; }
.aurora-lab h1 { font-family:var(--sans); font-weight:600; font-size:clamp(26px,4.6vw,42px); letter-spacing:-0.02em; margin:0; line-height:1.02; text-wrap:balance; }
.aurora-lab h1 b { color:var(--aurora); }
.aurora-lab .sub { color:var(--muted); font-size:13px; max-width:54ch; line-height:1.5; }
.aurora-lab .status { display:flex; align-items:center; gap:9px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); border:1px solid var(--edge); border-radius:999px; padding:7px 13px; background:rgba(13,21,33,0.6); white-space:nowrap; }
.aurora-lab .dot { width:8px; height:8px; border-radius:50%; background:var(--dim); transition:background .3s; }
.aurora-lab .status.live .dot { background:var(--severe); animation:auroraPulse 1.6s infinite; }
.aurora-lab .status.live { color:var(--ink); border-color:var(--edge2); }
@keyframes auroraPulse { 0%{box-shadow:0 0 0 0 rgba(255,95,109,.55)} 70%{box-shadow:0 0 0 7px rgba(255,95,109,0)} 100%{box-shadow:0 0 0 0 rgba(255,95,109,0)} }
.aurora-lab .panel { background:linear-gradient(180deg, var(--panel), var(--panel2)); border:1px solid var(--edge); border-radius:14px; }
.aurora-lab .panel-h { font-size:10.5px; letter-spacing:0.24em; text-transform:uppercase; color:var(--muted); padding:13px 16px; border-bottom:1px solid var(--edge); display:flex; align-items:center; justify-content:space-between; }
.aurora-lab .panel-h .tag { color:var(--dim); letter-spacing:0.1em; }
.aurora-lab .transport { display:grid; grid-template-columns:250px 1fr; overflow:hidden; }
.aurora-lab .deck { padding:22px; display:flex; flex-direction:column; gap:18px; border-right:1px solid var(--edge); }
.aurora-lab .play { position:relative; width:92px; height:92px; border-radius:50%; border:1px solid var(--edge2); cursor:pointer; align-self:center; background:radial-gradient(circle at 50% 35%, rgba(84,230,166,0.16), rgba(11,17,27,0.9)); color:var(--aurora); display:grid; place-items:center; transition:transform .15s, box-shadow .3s, border-color .3s; }
.aurora-lab .play:hover { transform:translateY(-1px); border-color:var(--aurora-d); box-shadow:0 0 34px -6px rgba(84,230,166,0.45); }
.aurora-lab .play:active { transform:scale(0.97); }
.aurora-lab .play:focus-visible { outline:2px solid var(--aurora); outline-offset:4px; }
.aurora-lab .play svg { width:34px; height:34px; fill:currentColor; }
.aurora-lab .play.playing { color:var(--severe); border-color:rgba(255,95,109,0.5); background:radial-gradient(circle at 50% 35%, rgba(255,95,109,0.14), rgba(11,17,27,0.9)); }
.aurora-lab .play-hint { text-align:center; font-size:10.5px; letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); }
.aurora-lab .readouts { display:flex; flex-direction:column; gap:12px; }
.aurora-lab .ro { display:flex; flex-direction:column; gap:5px; }
.aurora-lab .ro-l { font-size:9.5px; letter-spacing:0.22em; text-transform:uppercase; color:var(--dim); }
.aurora-lab .ro-v { font-size:15px; color:var(--ink); }
.aurora-lab .ro-v.big { font-family:var(--sans); font-size:22px; letter-spacing:-0.01em; font-weight:600; }
.aurora-lab #s.chill, .aurora-lab .chill { color:var(--teal); }
.aurora-lab .lounge, .aurora-lab .deep { color:var(--aurora); }
.aurora-lab .min { color:var(--violet); }
.aurora-lab .breaks { color:var(--severe); }
.aurora-lab .ro-v .fx { font-family:var(--mono); font-size:11px; color:var(--amber); letter-spacing:0.12em; margin-left:8px; vertical-align:middle; }
.aurora-lab .meter { height:7px; border-radius:4px; background:#0a0f18; overflow:hidden; border:1px solid var(--edge); }
.aurora-lab .meter > i { display:block; height:100%; width:20%; background:linear-gradient(90deg, var(--teal), var(--aurora) 55%, var(--amber) 82%, var(--severe)); border-radius:4px; transition:width .12s linear; }
.aurora-lab .viz-wrap { position:relative; min-height:220px; }
.aurora-lab canvas { display:block; width:100%; height:100%; }
.aurora-lab .beatstrip { position:absolute; left:16px; right:16px; bottom:14px; display:grid; grid-template-columns:repeat(16,1fr); gap:5px; }
.aurora-lab .beat { height:4px; border-radius:3px; background:transparent; border:1px solid var(--edge); transition:background .06s, box-shadow .06s; }
.aurora-lab .beat.q { border-color:var(--edge2); }
.aurora-lab .beat.on { background:var(--aurora); border-color:var(--aurora); box-shadow:0 0 8px rgba(84,230,166,0.7); }
.aurora-lab .beat.on.kick { background:var(--severe); border-color:var(--severe); box-shadow:0 0 10px rgba(255,95,109,0.8); }
.aurora-lab .viz-label { position:absolute; top:12px; left:16px; font-size:9.5px; letter-spacing:0.22em; text-transform:uppercase; color:var(--dim); }
.aurora-lab .racks { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
.aurora-lab .rack-body { padding:16px; display:flex; flex-direction:column; gap:16px; }
.aurora-lab .field { display:flex; flex-direction:column; gap:9px; }
.aurora-lab .field-l { display:flex; align-items:baseline; justify-content:space-between; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); }
.aurora-lab .field-l b { font-family:var(--mono); font-size:13px; color:var(--aurora); letter-spacing:0; }
.aurora-lab input[type=range] { -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:5px; background:linear-gradient(90deg, var(--aurora-d), var(--severe)); outline:none; opacity:0.9; cursor:pointer; }
.aurora-lab input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:16px; height:16px; border-radius:50%; background:var(--ink); border:2px solid var(--bg); box-shadow:0 0 0 1px var(--edge2); cursor:pointer; }
.aurora-lab input[type=range]::-moz-range-thumb { width:16px; height:16px; border:2px solid var(--bg); border-radius:50%; background:var(--ink); box-shadow:0 0 0 1px var(--edge2); cursor:pointer; }
.aurora-lab input[type=range]:focus-visible { box-shadow:0 0 0 2px var(--aurora); }
.aurora-lab .presets { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
.aurora-lab .chip { font-family:var(--mono); font-size:11px; letter-spacing:0.04em; padding:10px; border-radius:8px; cursor:pointer; text-align:left; background:#0c1420; border:1px solid var(--edge); color:var(--muted); transition:border-color .15s, color .15s, background .15s; display:flex; flex-direction:column; gap:3px; }
.aurora-lab .chip small { font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:var(--dim); }
.aurora-lab .chip:hover { border-color:var(--edge2); color:var(--ink); }
.aurora-lab .chip.active { border-color:var(--kc, var(--aurora)); color:var(--ink); background:#0e1826; box-shadow:inset 0 0 0 1px var(--kc, var(--aurora)); }
.aurora-lab .chip:focus-visible { outline:2px solid var(--aurora); outline-offset:2px; }
.aurora-lab .chip .kd { color:var(--kc, var(--aurora)); }
.aurora-lab .evt { width:100%; font-family:var(--mono); font-size:11px; letter-spacing:0.16em; text-transform:uppercase; padding:12px; border-radius:9px; cursor:pointer; color:var(--severe); background:rgba(255,95,109,0.06); border:1px solid rgba(255,95,109,0.3); transition:background .15s, box-shadow .2s; }
.aurora-lab .evt:hover { background:rgba(255,95,109,0.13); }
.aurora-lab .evt:active { box-shadow:0 0 26px -6px rgba(255,95,109,0.6); }
.aurora-lab .evt:focus-visible { outline:2px solid var(--severe); outline-offset:2px; }
.aurora-lab .stems { display:flex; flex-direction:column; gap:8px; }
.aurora-lab .stem { display:grid; grid-template-columns:34px 1fr auto; align-items:center; gap:11px; }
.aurora-lab .led { width:9px; height:9px; border-radius:50%; background:var(--dim); justify-self:center; transition:background .05s, box-shadow .05s; }
.aurora-lab .stem.muted .led { background:var(--dim) !important; box-shadow:none !important; }
.aurora-lab .stem-n { font-size:12px; letter-spacing:0.06em; color:var(--ink); }
.aurora-lab .stem-n small { color:var(--dim); font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; margin-left:7px; }
.aurora-lab .stem.muted .stem-n { color:var(--dim); }
.aurora-lab .sw { width:42px; height:22px; border-radius:999px; background:#0b1220; border:1px solid var(--edge2); position:relative; cursor:pointer; transition:background .15s; padding:0; }
.aurora-lab .sw::after { content:""; position:absolute; top:2px; left:22px; width:16px; height:16px; border-radius:50%; background:var(--aurora); transition:left .15s, background .15s; box-shadow:0 0 8px rgba(84,230,166,0.5); }
.aurora-lab .sw:focus-visible { outline:2px solid var(--aurora); outline-offset:2px; }
.aurora-lab .stem.muted .sw::after { left:2px; background:var(--dim); box-shadow:none; }
.aurora-lab .stem.muted .sw { background:#0a0f18; }
.aurora-lab .master { padding-top:4px; border-top:1px solid var(--edge); margin-top:2px; }
.aurora-lab .note { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
.aurora-lab .note .card { padding:15px; }
.aurora-lab .note h3 { margin:0 0 7px; font-family:var(--sans); font-size:13px; font-weight:600; color:var(--ink); }
.aurora-lab .note p { margin:0; font-size:12px; line-height:1.55; color:var(--muted); }
.aurora-lab .note .card b { color:var(--aurora); font-weight:400; }
.aurora-lab footer.legal { color:var(--dim); font-size:11px; text-align:center; line-height:1.6; }
.aurora-lab footer.legal b { color:var(--muted); font-weight:400; }
@media (max-width:720px) {
  .aurora-lab .transport { grid-template-columns:1fr; }
  .aurora-lab .deck { border-right:none; border-bottom:1px solid var(--edge); flex-direction:row; align-items:center; }
  .aurora-lab .deck .readouts { flex:1; }
  .aurora-lab .racks { grid-template-columns:1fr; }
  .aurora-lab .note { grid-template-columns:1fr; }
}
@media (prefers-reduced-motion: reduce) { .aurora-lab * { animation:none !important; transition-duration:.01ms !important; } }
`;
