/** Drum and FX voices: one-shot node graphs scheduled at an audio-clock time. */
import type { HatColour, KickFlavour } from "./arranger";
import type { Rig } from "./graph";

/** Per-track kick character: pitch sweep, body length, click amount. */
const KICKS: Record<KickFlavour, { f0: number; f1: number; sweep: number; decay: number; click: number; gain: number }> = {
  punch: { f0: 150, f1: 48, sweep: 0.11, decay: 0.42, click: 0.4, gain: 1 },
  deep: { f0: 120, f1: 38, sweep: 0.16, decay: 0.65, click: 0.25, gain: 1 },
  tight: { f0: 190, f1: 55, sweep: 0.07, decay: 0.24, click: 0.55, gain: 1 },
  soft: { f0: 110, f1: 45, sweep: 0.12, decay: 0.35, click: 0.15, gain: 0.8 },
};

/** Per-track hat colour: filter, relative decay and a level trim. */
const HATS: Record<HatColour, { type: BiquadFilterType; f: number; q: number; decay: number; gain: number }> = {
  bright: { type: "highpass", f: 7800, q: 1, decay: 1, gain: 1 },
  dark: { type: "bandpass", f: 6000, q: 1.2, decay: 1.1, gain: 1.3 },
  crisp: { type: "highpass", f: 9500, q: 1, decay: 0.8, gain: 1.1 },
};

const rand = Math.random;

/** Sidechain "pump": drop the musical bus on the kick, recover over ~120 ms. */
export function duck(rig: Rig, t: number): void {
  const g = rig.sidechain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.3, t);
  g.setTargetAtTime(1, t + 0.008, 0.12);
}

export function kick(rig: Rig, t: number, vel: number, flavour: KickFlavour = "punch"): void {
  const { ctx } = rig;
  const k = KICKS[flavour];
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * k.gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + k.decay);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(k.f0, t);
  o.frequency.exponentialRampToValueAtTime(k.f1, t + k.sweep);
  o.connect(g);
  g.connect(rig.groups.kick);
  o.start(t);
  o.stop(t + k.decay + 0.02);
  const n = rig.noise();
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2200;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * k.click, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
  n.connect(hp);
  hp.connect(ng);
  ng.connect(rig.groups.kick);
  n.start(t);
  n.stop(t + 0.05);
}

export function hat(rig: Rig, t: number, vel: number, open: boolean, pan: number, colour: HatColour = "bright"): void {
  const { ctx } = rig;
  const c = HATS[colour];
  const n = rig.noise();
  const hp = ctx.createBiquadFilter();
  hp.type = c.type;
  hp.frequency.value = c.f;
  hp.Q.value = c.q;
  const dec = (open ? 0.17 : 0.045) * c.decay;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.34 * c.gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dec);
  const pn = ctx.createStereoPanner();
  pn.pan.value = pan;
  n.connect(hp);
  hp.connect(g);
  g.connect(pn);
  pn.connect(rig.groups.hat);
  n.start(t);
  n.stop(t + dec + 0.02);
}

/** Ride: a longer, darker hat with a metallic bandpass. */
export function ride(rig: Rig, t: number, vel: number): void {
  const { ctx } = rig;
  const n = rig.noise();
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 9000;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  const pn = ctx.createStereoPanner();
  pn.pan.value = 0.35;
  n.connect(bp);
  bp.connect(g);
  g.connect(pn);
  pn.connect(rig.groups.hat);
  n.start(t);
  n.stop(t + 0.4);
}

export function clap(rig: Rig, t: number, vel: number): void {
  const { ctx } = rig;
  const burst = (tt: number, v: number) => {
    const n = rig.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, tt);
    g.gain.exponentialRampToValueAtTime(0.001, tt + 0.11);
    n.connect(bp);
    bp.connect(g);
    g.connect(rig.groups.perc);
    const rs = ctx.createGain();
    rs.gain.value = 0.25;
    g.connect(rs);
    rs.connect(rig.convolver);
    n.start(tt);
    n.stop(tt + 0.13);
  };
  burst(t, vel * 0.22);
  burst(t + 0.011, vel * 0.3);
  burst(t + 0.024, vel * 0.42);
}

export function snare(rig: Rig, t: number, vel: number): void {
  const { ctx } = rig;
  const n = rig.noise();
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1900;
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  n.connect(bp);
  bp.connect(g);
  g.connect(rig.groups.perc);
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(190, t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
  const og = ctx.createGain();
  og.gain.setValueAtTime(vel * 0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  o.connect(og);
  og.connect(rig.groups.perc);
  o.start(t);
  o.stop(t + 0.1);
  const rs = ctx.createGain();
  rs.gain.value = 0.2;
  g.connect(rs);
  rs.connect(rig.convolver);
  n.start(t);
  n.stop(t + 0.16);
}

/** Rimshot: a short woody tick. */
export function rim(rig: Rig, t: number, vel: number): void {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(820, t);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.02);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  o.connect(g);
  g.connect(rig.groups.perc);
  o.start(t);
  o.stop(t + 0.04);
  const n = rig.noise();
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 2;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  n.connect(bp);
  bp.connect(ng);
  ng.connect(rig.groups.perc);
  n.start(t);
  n.stop(t + 0.03);
}

export function shaker(rig: Rig, t: number, vel: number, pan: number): void {
  const { ctx } = rig;
  const n = rig.noise();
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 9000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  const pn = ctx.createStereoPanner();
  pn.pan.value = pan;
  n.connect(hp);
  hp.connect(g);
  g.connect(pn);
  pn.connect(rig.groups.perc);
  n.start(t);
  n.stop(t + 0.08);
}

/** Filtered-noise riser sweeping up over `dur`, straight to the bus + reverb. */
export function riser(rig: Rig, t: number, dur: number): void {
  const { ctx } = rig;
  const n = rig.noise(true);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(300, t);
  hp.frequency.exponentialRampToValueAtTime(6500, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.92);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.18);
  n.connect(hp);
  hp.connect(g);
  const rs = ctx.createGain();
  rs.gain.value = 0.6;
  g.connect(rs);
  rs.connect(rig.convolver);
  g.connect(rig.bus);
  n.start(t);
  n.stop(t + dur + 0.2);
}

/** Reverse-cymbal swell that peaks exactly at `t + dur` (the next downbeat). */
export function swell(rig: Rig, t: number, dur: number): void {
  const { ctx } = rig;
  const n = rig.noise(true);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + dur);
  g.gain.setValueAtTime(0.0001, t + dur + 0.01);
  n.connect(hp);
  hp.connect(g);
  g.connect(rig.groups.hat);
  const rs = ctx.createGain();
  rs.gain.value = 0.5;
  g.connect(rs);
  rs.connect(rig.convolver);
  n.start(t);
  n.stop(t + dur + 0.05);
}
