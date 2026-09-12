/** Tonal voices: one-shot note/chord graphs plus the persistent Pad. */
import type { BassFlavour, PadType } from "./arranger";
import type { Rig } from "./graph";
import type { Chord } from "./theory";

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = Math.random;
const hum = () => (rand() - 0.5) * 0.004;

/** Send `from` into the reverb and/or delay at the given levels. */
function sends(rig: Rig, from: AudioNode, reverb: number, delay = 0): void {
  if (reverb > 0) {
    const rs = rig.ctx.createGain();
    rs.gain.value = reverb;
    from.connect(rs);
    rs.connect(rig.convolver);
  }
  if (delay > 0) {
    const ds = rig.ctx.createGain();
    ds.gain.value = delay;
    from.connect(ds);
    ds.connect(rig.delay);
  }
}

/** FM electric piano note (the original "Rhodes"). */
export function rhodes(rig: Rig, midi: number, t: number, dur: number, level: number, pan: number): void {
  const { ctx } = rig;
  const f = mtof(midi);
  const car = ctx.createOscillator();
  car.type = "sine";
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = f;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * 3, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.35, t + 0.06);
  mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.5);
  mod.connect(mg);
  mg.connect(car.frequency);
  const mod2 = ctx.createOscillator();
  mod2.type = "sine";
  mod2.frequency.value = f * 14;
  const mg2 = ctx.createGain();
  mg2.gain.setValueAtTime(f * 1.1, t);
  mg2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  mod2.connect(mg2);
  mg2.connect(car.frequency);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(level, t + 0.006);
  amp.gain.setTargetAtTime(0.0001, t + Math.min(dur, 0.14), dur > 0.4 ? 0.45 : 0.1);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3400;
  lp.Q.value = 0.4;
  const pn = ctx.createStereoPanner();
  pn.pan.value = pan;
  car.connect(lp);
  lp.connect(amp);
  amp.connect(pn);
  pn.connect(rig.groups.keys);
  sends(rig, amp, 0.26);
  const end = t + Math.max(dur, 0.2) + 0.6;
  car.start(t);
  mod.start(t);
  mod2.start(t);
  car.stop(end);
  mod.stop(end);
  mod2.stop(end);
}

export function rhodesChord(rig: Rig, notes: number[], t: number, dur: number, level: number, spread: boolean): void {
  const n = notes.length;
  notes.forEach((m, i) => rhodes(rig, m, t + i * 0.007 + hum(), dur, level / Math.sqrt(n), spread ? ((i / (n - 1)) * 2 - 1) * 0.35 : 0));
}

/** Deep-house chord stab: detuned saws through a snapping lowpass. */
export function stabChord(rig: Rig, notes: number[], t: number, level: number): void {
  const { ctx } = rig;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 2.2;
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(520, t + 0.2);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(level / Math.sqrt(notes.length) / 2, t + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
  lp.connect(amp);
  amp.connect(rig.groups.keys);
  sends(rig, amp, 0.3, 0.25);
  notes.forEach((m, i) => {
    const pn = ctx.createStereoPanner();
    pn.pan.value = ((i / Math.max(1, notes.length - 1)) * 2 - 1) * 0.4;
    pn.connect(lp);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(m);
      o.detune.value = det;
      o.connect(pn);
      o.start(t);
      o.stop(t + 0.32);
    }
  });
}

/**
 * Karplus–Strong plucked string: a noise burst circulating in a tuned delay
 * with a lowpass in the loop. Played an octave below the keys register so the
 * period stays above Web Audio's one-quantum (128-sample) feedback minimum.
 */
export function pluckNote(rig: Rig, midi: number, t: number, level: number, pan: number): void {
  const { ctx } = rig;
  const f = mtof(midi);
  const period = 1 / f;
  const ring = 1.4;
  const burst = rig.noise();
  const d = ctx.createDelay(0.1);
  d.delayTime.value = Math.max(period - 25e-6, 128 / ctx.sampleRate);
  // NB: a lowpass's Q is in dB (linear Q = 10^(Q/20)); anything above -3 dB
  // peaks past unity near the cutoff and the loop runs away. -8 dB keeps the
  // filter gain ≤ 1 everywhere so the loop gain (fb × filter) stays below 1.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 7000;
  lp.Q.value = -8;
  const fb = ctx.createGain();
  fb.gain.value = Math.pow(0.001, period / ring);
  fb.gain.setValueAtTime(0, t + ring);
  const amp = ctx.createGain();
  amp.gain.value = level;
  const pn = ctx.createStereoPanner();
  pn.pan.value = pan;
  burst.connect(d);
  d.connect(lp);
  lp.connect(fb);
  fb.connect(d);
  d.connect(amp);
  amp.connect(pn);
  pn.connect(rig.groups.keys);
  sends(rig, amp, 0.35, 0.3);
  burst.start(t);
  burst.stop(t + period);
  window.setTimeout(
    () => {
      for (const n of [d, lp, fb, amp, pn]) n.disconnect();
    },
    Math.max(0, t - ctx.currentTime + ring + 0.5) * 1000,
  );
}

/** Strummed pluck chord, an octave down. */
export function pluckChord(rig: Rig, notes: number[], t: number, level: number): void {
  const n = notes.length;
  notes.forEach((m, i) => pluckNote(rig, m - 12, t + i * 0.014 + hum(), level / Math.sqrt(n), ((i / Math.max(1, n - 1)) * 2 - 1) * 0.5));
}

/** FM glass bell for the chill/lounge lead. */
export function bellNote(rig: Rig, midi: number, t: number, level: number, pan: number): void {
  const { ctx } = rig;
  const f = mtof(midi);
  const car = ctx.createOscillator();
  car.type = "sine";
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = f * 3.5;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * 2.5, t);
  mg.gain.exponentialRampToValueAtTime(1, t + 0.9);
  mod.connect(mg);
  mg.connect(car.frequency);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(level, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6000;
  const pn = ctx.createStereoPanner();
  pn.pan.value = pan;
  car.connect(lp);
  lp.connect(amp);
  amp.connect(pn);
  pn.connect(rig.groups.lead);
  sends(rig, amp, 0.5, 0.4);
  car.start(t);
  mod.start(t);
  car.stop(t + 1.7);
  mod.stop(t + 1.7);
}

/** The original FM motif lead. */
export function fmLead(rig: Rig, midi: number, t: number, level: number): void {
  const { ctx } = rig;
  const f = mtof(midi);
  const car = ctx.createOscillator();
  car.type = "sine";
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = f * 3.01;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * 2.2, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.2, t + 0.25);
  mod.connect(mg);
  mg.connect(car.frequency);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(level * 0.17, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5200;
  lp.Q.value = 1;
  const pn = ctx.createStereoPanner();
  pn.pan.value = (rand() * 2 - 1) * 0.4;
  car.connect(lp);
  lp.connect(amp);
  amp.connect(pn);
  pn.connect(rig.groups.lead);
  sends(rig, amp, 0.3, 0.5);
  car.start(t);
  mod.start(t);
  car.stop(t + 0.7);
  mod.stop(t + 0.7);
}

let acidCurve: Float32Array<ArrayBuffer> | null = null;
const acidShape = (): Float32Array<ArrayBuffer> => {
  if (!acidCurve) {
    acidCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) acidCurve[i] = Math.tanh(2.2 * ((i / 1023) * 2 - 1));
  }
  return acidCurve;
};

/** 303-style acid note: saw → resonant lowpass with a snapping envelope → soft drive. */
export function acidNote(rig: Rig, midi: number, t: number, len: number, accent: boolean, glideFrom: number | null): void {
  const { ctx } = rig;
  const f = mtof(midi);
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  if (glideFrom !== null) {
    o.frequency.setValueAtTime(mtof(glideFrom), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
  } else o.frequency.value = f;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = accent ? 12 : 8;
  lp.frequency.setValueAtTime(accent ? 2600 : 1500, t);
  lp.frequency.exponentialRampToValueAtTime(260, t + (accent ? 0.28 : 0.18));
  const pre = ctx.createGain();
  pre.gain.value = 0.5;
  const drive = ctx.createWaveShaper();
  drive.curve = acidShape();
  const amp = ctx.createGain();
  const level = 0.12 * (accent ? 1.25 : 1);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(level, t + 0.002);
  amp.gain.setValueAtTime(level, t + Math.max(0.01, len - 0.03));
  amp.gain.exponentialRampToValueAtTime(0.0005, t + len + 0.02);
  o.connect(lp);
  lp.connect(pre);
  pre.connect(drive);
  drive.connect(amp);
  amp.connect(rig.groups.lead);
  sends(rig, amp, 0.2, 0.35);
  o.start(t);
  o.stop(t + len + 0.05);
}

/**
 * Bass note in the track's flavour: `sub` = sine + a filtered saw for edge,
 * `reese` = two detuned saws through a lowpass (wide and growling), `pluck`
 * = sub with a snapping filter and a short decay. Optional glide in.
 */
export function bassNote(rig: Rig, midi: number, t: number, dur: number, vel: number, glide: boolean, flavour: BassFlavour = "sub"): void {
  const { ctx } = rig;
  const f = mtof(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  const oscs: OscillatorNode[] = [];
  const tune = (o: OscillatorNode) => {
    if (glide) {
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    } else o.frequency.value = f;
    oscs.push(o);
  };
  if (flavour === "reese") {
    g.gain.exponentialRampToValueAtTime(vel * 0.3, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 2;
    for (const det of [-12, 12]) {
      const saw = ctx.createOscillator();
      saw.type = "sawtooth";
      saw.detune.value = det;
      tune(saw);
      saw.connect(lp);
    }
    lp.connect(g);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    tune(sub);
    const sg = ctx.createGain();
    sg.gain.value = 0.35;
    sub.connect(sg);
    sg.connect(g);
  } else {
    const plucky = flavour === "pluck";
    g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.012);
    g.gain.setTargetAtTime(0.0001, t + dur * (plucky ? 0.3 : 0.55), plucky ? 0.06 : 0.1);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    tune(sub);
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    tune(saw);
    const sf = ctx.createBiquadFilter();
    sf.type = "lowpass";
    sf.frequency.setValueAtTime(plucky ? 900 : 180, t);
    sf.frequency.exponentialRampToValueAtTime(plucky ? 150 : 320, t + (plucky ? 0.15 : 0.03));
    sf.Q.value = 2;
    const sg = ctx.createGain();
    sg.gain.value = plucky ? 0.3 : 0.24;
    saw.connect(sf);
    sf.connect(sg);
    sg.connect(g);
    sub.connect(g);
  }
  g.connect(rig.groups.bass);
  for (const o of oscs) {
    o.start(t);
    o.stop(t + dur + 0.3);
  }
}

interface PadVoice {
  g: GainNode;
  oscs: OscillatorNode[];
}

/** The sustained pad: one voice per chord tone, cross-faded on chord changes. */
export class Pad {
  private voices: PadVoice[] = [];

  constructor(private rig: Rig) {}

  /** Fade the old chord out and a new one in at `t`, built in the track's pad type. */
  change(chord: Chord, t: number, type: PadType): void {
    const { ctx } = this.rig;
    for (const v of this.voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.0001, t, 0.8);
      for (const o of v.oscs) {
        try {
          o.stop(t + 3.4);
        } catch {
          /* already stopped */
        }
      }
    }
    this.voices = [];
    const notes = chord.notes;
    const PEAK: Record<PadType, number> = { saw: 0.06, soft: 0.075, organ: 0.09, strings: 0.05, glass: 0.08 };
    const swell = type === "strings" ? 3.2 : type === "organ" ? 0.6 : 1.8;
    const peak = PEAK[type] / notes.length;
    notes.forEach((midi, idx) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      const pan = ctx.createStereoPanner();
      pan.pan.value = ((idx / Math.max(1, notes.length - 1)) * 2 - 1) * 0.5;
      const oscs: OscillatorNode[] = [];
      const f = mtof(midi);
      // where the oscillators land: straight into the voice gain, or via a shaping filter
      let into: AudioNode = g;
      if (type === "strings") {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 220;
        hp.Q.value = -3;
        hp.connect(g);
        into = hp;
      }
      const osc = (kind: OscillatorType, freq: number, det = 0, level = 1): OscillatorNode => {
        const o = ctx.createOscillator();
        o.type = kind;
        o.frequency.value = freq;
        o.detune.value = det;
        if (level === 1) o.connect(into);
        else {
          const lg = ctx.createGain();
          lg.gain.value = level;
          o.connect(lg);
          lg.connect(into);
        }
        o.start(t);
        oscs.push(o);
        return o;
      };
      if (type === "saw" || type === "soft") {
        for (const det of [-9, 0, 8]) osc(type === "saw" ? "sawtooth" : "triangle", f, det);
        osc("sine", f / 2, 0, 0.5);
      } else if (type === "strings") {
        for (const det of [-14, 0, 12]) osc("sawtooth", f, det);
      } else if (type === "organ") {
        const vib = ctx.createOscillator();
        vib.type = "sine";
        vib.frequency.value = 5.5;
        const vd = ctx.createGain();
        vd.gain.value = 5;
        vib.connect(vd);
        vib.start(t);
        oscs.push(vib);
        for (const [h, lv] of [
          [1, 1],
          [2, 0.5],
          [3, 0.3],
          [4, 0.15],
        ] as const) {
          const o = osc("sine", f * h, 0, lv);
          vd.connect(o.detune);
        }
      } else {
        // glass: lightly FM'd sine with a slow tremolo
        const car = ctx.createOscillator();
        car.type = "sine";
        car.frequency.value = f;
        const mod = ctx.createOscillator();
        mod.type = "sine";
        mod.frequency.value = f * 2;
        const mg = ctx.createGain();
        mg.gain.value = f * 0.6;
        mod.connect(mg);
        mg.connect(car.frequency);
        const trem = ctx.createOscillator();
        trem.type = "sine";
        trem.frequency.value = 0.4 + idx * 0.13;
        const td = ctx.createGain();
        td.gain.value = 0.35;
        const tg = ctx.createGain();
        tg.gain.value = 0.65;
        trem.connect(td);
        td.connect(tg.gain);
        car.connect(tg);
        tg.connect(into);
        osc("sine", f / 2, 0, 0.4);
        for (const o of [car, mod, trem]) {
          o.start(t);
          oscs.push(o);
        }
      }
      g.connect(pan);
      pan.connect(this.rig.chorusIn);
      sends(this.rig, g, 0.6);
      g.gain.exponentialRampToValueAtTime(peak, t + swell);
      g.gain.setTargetAtTime(peak * 0.8, t + swell, 1.2);
      this.voices.push({ g, oscs });
    });
    // Aurora shimmer: the top two chord tones two octaves up, slow tremolo,
    // into rig.shimmer (its gain is the mood's aurora axis, 0 by default).
    notes.slice(-2).forEach((midi, i) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.02, t + 2.5);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = mtof(midi + 24);
      o.detune.value = i ? 6 : -5;
      const trem = ctx.createOscillator();
      trem.type = "sine";
      trem.frequency.value = i ? 0.5 : 0.33;
      const td = ctx.createGain();
      td.gain.value = 0.5;
      trem.connect(td);
      const tg = ctx.createGain();
      tg.gain.value = 0.5;
      td.connect(tg.gain);
      o.connect(tg);
      tg.connect(g);
      const pan = ctx.createStereoPanner();
      pan.pan.value = i ? 0.6 : -0.6;
      g.connect(pan);
      pan.connect(this.rig.shimmer);
      o.start(t);
      trem.start(t);
      this.voices.push({ g, oscs: [o, trem] });
    });
  }
}
