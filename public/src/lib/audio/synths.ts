/** Tonal voices: one-shot note/chord graphs plus the persistent Pad. */
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

/** Sub bass: sine + a filtered saw for edge, optional glide in. */
export function bassNote(rig: Rig, midi: number, t: number, dur: number, vel: number, glide: boolean): void {
  const { ctx } = rig;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.012);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.55, 0.1);
  const sub = ctx.createOscillator();
  sub.type = "sine";
  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  const f = mtof(midi);
  if (glide) {
    for (const o of [sub, saw]) {
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    }
  } else {
    sub.frequency.value = f;
    saw.frequency.value = f;
  }
  const sf = ctx.createBiquadFilter();
  sf.type = "lowpass";
  sf.frequency.setValueAtTime(180, t);
  sf.frequency.exponentialRampToValueAtTime(320, t + 0.03);
  sf.Q.value = 2;
  const sg = ctx.createGain();
  sg.gain.value = 0.24;
  saw.connect(sf);
  sf.connect(sg);
  sg.connect(g);
  sub.connect(g);
  g.connect(rig.groups.bass);
  sub.start(t);
  saw.start(t);
  sub.stop(t + dur + 0.3);
  saw.stop(t + dur + 0.3);
}

interface PadVoice {
  g: GainNode;
  oscs: OscillatorNode[];
}

/** The sustained pad: one voice per chord tone, cross-faded on chord changes. */
export class Pad {
  private voices: PadVoice[] = [];

  constructor(private rig: Rig) {}

  /** Fade the old chord out and a new one in at `t`; `soft` = triangle wash instead of supersaw. */
  change(chord: Chord, t: number, soft: boolean): void {
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
    const peak = (soft ? 0.075 : 0.06) / notes.length;
    notes.forEach((midi, idx) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      const pan = ctx.createStereoPanner();
      pan.pan.value = ((idx / (notes.length - 1)) * 2 - 1) * 0.5;
      const oscs: OscillatorNode[] = [];
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator();
        o.type = soft ? "triangle" : "sawtooth";
        o.frequency.value = mtof(midi);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        oscs.push(o);
      }
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = mtof(midi - 12);
      const sg = ctx.createGain();
      sg.gain.value = 0.5;
      sub.connect(sg);
      sg.connect(g);
      sub.start(t);
      oscs.push(sub);
      g.connect(pan);
      pan.connect(this.rig.chorusIn);
      sends(this.rig, g, 0.6);
      g.gain.exponentialRampToValueAtTime(peak, t + 1.8);
      g.gain.setTargetAtTime(peak * 0.8, t + 1.8, 1.2);
      this.voices.push({ g, oscs });
    });
  }
}
