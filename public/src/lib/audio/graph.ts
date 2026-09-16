/**
 * The audio graph for the bed: master chain, sends, stem groups and buses.
 * Built once per AudioContext; voices only ever connect into `Rig` nodes.
 *
 * Master chain: bus (fixed trim) → limiter → soft-clip ceiling → master (the
 * operator volume) → analyser → out. The volume sits AFTER the limiter so
 * turning it up scales an already-bounded signal instead of driving the
 * compressor harder; the shaper is the brickwall a DynamicsCompressor (soft
 * knee + automatic makeup gain) is not, so the output can never hard-clip.
 * Levels are checked with scripts/measure-audio-bed.mjs.
 */
import type { StemId } from "./arranger";
import { fillRain, softClipCurve } from "./dsp";

/** Trim on the summing bus feeding the limiter: a full "breaks" mix lands a few dB over threshold on hits. */
const BUS_TRIM = 0.6;

export interface Rig {
  ctx: AudioContext;
  bus: GainNode;
  master: GainNode;
  analyser: AnalyserNode;
  groups: Record<StemId, GainNode>;
  drumBus: GainNode;
  sidechain: GainNode;
  energyFilter: BiquadFilterNode;
  padFilter: BiquadFilterNode;
  chorusIn: GainNode;
  /** Reverb send input. */
  convolver: ConvolverNode;
  /** Delay send input. */
  delay: DelayNode;
  /** Delay feedback / return, opened up by wet weather. */
  delayFb: GainNode;
  delayReturn: GainNode;
  /** Looped rain texture level (0 = silent). */
  rainBed: GainNode;
  /** Slow filtered-noise wind level (0 = silent). */
  windBed: GainNode;
  /** Aurora shimmer voices' master level (0 = silent). */
  shimmer: GainNode;
  /** Fresh white-noise source (2 s buffer). */
  noise(loop?: boolean): AudioBufferSourceNode;
}

const rand = Math.random;

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return b;
}

function impulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = ctx.sampleRate * seconds;
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

export function buildRig(ctx: AudioContext, stepSeconds: number, enabled: Record<string, boolean>): Rig {
  const noiseBuf = noiseBuffer(ctx, 2);
  const gain = (v: number) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };

  // ---- master chain
  const bus = gain(BUS_TRIM);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = softClipCurve();
  ceiling.oversample = "2x";
  const master = gain(0.7);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  bus.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(master);
  master.connect(analyser);
  analyser.connect(ctx.destination);

  // ---- sends
  const convolver = ctx.createConvolver();
  convolver.buffer = impulseResponse(ctx, 3.0, 2.6);
  const reverbReturn = gain(0.55);
  convolver.connect(reverbReturn);
  reverbReturn.connect(bus);

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = stepSeconds * 3;
  const delayFb = gain(0.37);
  const delayReturn = gain(0.4);
  delay.connect(delayFb);
  delayFb.connect(delay);
  delay.connect(delayReturn);
  delayReturn.connect(bus);
  delay.connect(convolver);

  // ---- musical bus: groups → sum → sidechain duck → energy-driven lowpass
  const musicalSum = gain(0.9);
  const sidechain = gain(1);
  const energyFilter = ctx.createBiquadFilter();
  energyFilter.type = "lowpass";
  energyFilter.frequency.value = 700;
  energyFilter.Q.value = 0.6;
  musicalSum.connect(sidechain);
  sidechain.connect(energyFilter);
  energyFilter.connect(bus);

  // ---- drum bus with a little glue compression
  const drumBus = gain(0.8);
  const drumGlue = ctx.createDynamicsCompressor();
  drumGlue.threshold.value = -12;
  drumGlue.knee.value = 6;
  drumGlue.ratio.value = 4;
  drumGlue.attack.value = 0.005;
  drumGlue.release.value = 0.08;
  drumBus.connect(drumGlue);
  drumGlue.connect(bus);

  const groups = {} as Record<StemId, GainNode>;
  for (const k of ["keys", "pad", "lead", "bass"] as const) {
    groups[k] = gain(1);
    groups[k].connect(musicalSum);
  }
  for (const k of ["kick", "hat", "perc"] as const) {
    groups[k] = gain(1);
    groups[k].connect(drumBus);
  }
  groups.atmos = gain(1);
  groups.atmos.connect(bus);

  // ---- pad chorus (dry + two modulated, panned delay lines) → LFO filter → pad group
  const chorusIn = gain(1);
  const chorusOut = gain(1);
  const cDry = gain(0.7);
  chorusIn.connect(cDry);
  cDry.connect(chorusOut);
  const chorusVoice = (base: number, rate: number, depth: number, pan: number) => {
    const d = ctx.createDelay(0.06);
    d.delayTime.value = base;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = rate;
    const lg = gain(depth);
    lfo.connect(lg);
    lg.connect(d.delayTime);
    lfo.start();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    chorusIn.connect(d);
    d.connect(p);
    p.connect(chorusOut);
  };
  chorusVoice(0.021, 0.6, 0.003, -0.6);
  chorusVoice(0.027, 0.47, 0.0035, 0.6);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 700;
  padFilter.Q.value = 0.8;
  chorusOut.connect(padFilter);
  padFilter.connect(groups.pad);
  const padLFO = ctx.createOscillator();
  padLFO.type = "sine";
  padLFO.frequency.value = 0.08;
  const plg = gain(650);
  padLFO.connect(plg);
  plg.connect(padFilter.frequency);
  padLFO.start();

  for (const k of Object.keys(groups) as StemId[]) groups[k].gain.value = enabled[k] ? 1 : 0;

  // ---- weather beds (all silent until the engine's mood opens them)
  const rain = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  fillRain(rain.getChannelData(0), ctx.sampleRate, rand);
  const rainSrc = ctx.createBufferSource();
  rainSrc.buffer = rain;
  rainSrc.loop = true;
  const rainBp = ctx.createBiquadFilter();
  rainBp.type = "bandpass";
  rainBp.frequency.value = 4800;
  rainBp.Q.value = 0.7;
  const rainBed = gain(0);
  rainSrc.connect(rainBp);
  rainBp.connect(rainBed);
  rainBed.connect(groups.atmos);
  const rainVerb = gain(0.3);
  rainBed.connect(rainVerb);
  rainVerb.connect(convolver);
  rainSrc.start();

  const windSrc = ctx.createBufferSource();
  windSrc.buffer = noiseBuf;
  windSrc.loop = true;
  const windLp = ctx.createBiquadFilter();
  windLp.type = "lowpass";
  windLp.frequency.value = 380;
  windLp.Q.value = -3;
  const windLfo = ctx.createOscillator();
  windLfo.type = "sine";
  windLfo.frequency.value = 0.11;
  const windLfoDepth = gain(240);
  windLfo.connect(windLfoDepth);
  windLfoDepth.connect(windLp.frequency);
  windLfo.start();
  const gustLfo = ctx.createOscillator();
  gustLfo.type = "triangle";
  gustLfo.frequency.value = 0.043;
  const gustDepth = gain(0.45);
  const windShape = gain(0.55);
  gustLfo.connect(gustDepth);
  gustDepth.connect(windShape.gain);
  gustLfo.start();
  const windBed = gain(0);
  windSrc.connect(windLp);
  windLp.connect(windShape);
  windShape.connect(windBed);
  windBed.connect(groups.atmos);
  windSrc.start();

  const shimmer = gain(0);
  shimmer.connect(groups.pad);
  const shimmerVerb = gain(0.8);
  shimmer.connect(shimmerVerb);
  shimmerVerb.connect(convolver);

  // ---- air floor, always running: a faint dark hiss so silence never reads as dead
  // (the old vinyl pops are gone — on a broadcast bed they read as crackle, not record)
  const airSrc = ctx.createBufferSource();
  airSrc.buffer = noiseBuf;
  airSrc.loop = true;
  const airLp = ctx.createBiquadFilter();
  airLp.type = "lowpass";
  airLp.frequency.value = 2400;
  airLp.Q.value = -3;
  const air = gain(0.006);
  airSrc.connect(airLp);
  airLp.connect(air);
  air.connect(groups.atmos);
  airSrc.start();

  return {
    ctx,
    bus,
    master,
    analyser,
    groups,
    drumBus,
    sidechain,
    energyFilter,
    padFilter,
    chorusIn,
    convolver,
    delay,
    delayFb,
    delayReturn,
    rainBed,
    windBed,
    shimmer,
    noise: (loop = false) => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = loop;
      return s;
    },
  };
}
