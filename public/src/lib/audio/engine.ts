/**
 * AuroraBed — a self-contained generative music engine for the broadcast bed.
 *
 * Everything is synthesized live from oscillators + noise via the Web Audio API
 * (no samples, no libraries) so it is copyright-safe for a 24/7 stream and never
 * repeats. One `energy` value (0..1) drives the whole arrangement: it free-runs
 * a slow drift that starts chill and is nudged up by `severity` / event pulses —
 * in the app that severity comes from the director's on-air segment. See the
 * `/music` lab page; the plan is to hang this off `useDirector` in WatchSurface.
 *
 * Browser-only: no AudioContext is created until start().
 */

export interface StemDef {
  id: string;
  name: string;
  note: string;
  color: string;
  drum?: boolean;
  live: (energy: number) => boolean;
}

export const STEMS: StemDef[] = [
  { id: "keys", name: "Keys", note: "rhodes", color: "#54e6a6", live: () => true },
  { id: "pad", name: "Pad", note: "wash", color: "#35d6d0", live: () => true },
  { id: "lead", name: "Lead", note: "motif", color: "#8cf5cd", live: (e) => e > 0.4 },
  { id: "bass", name: "Bass", note: "sub", color: "#a98bff", live: (e) => e > 0.26 },
  { id: "kick", name: "Kick", note: "floor / breaks", color: "#ffb454", drum: true, live: (e) => e > 0.34 },
  { id: "hat", name: "Hats", note: "swing", color: "#ffb454", drum: true, live: (e) => e > 0.36 },
  { id: "perc", name: "Perc", note: "clap · shaker", color: "#ff5f6d", drum: true, live: (e) => e > 0.45 },
  { id: "atmos", name: "Atmos", note: "vinyl", color: "#6a7d97", live: () => true },
];

export interface Section {
  max: number;
  name: string;
  cls: string;
  hint: string;
}

const SECTIONS: Section[] = [
  { max: 0.3, name: "Chill Out", cls: "chill", hint: "ambient" },
  { max: 0.45, name: "Lounge House", cls: "lounge", hint: "offbeat keys" },
  { max: 0.6, name: "Deep House", cls: "deep", hint: "four-on-floor" },
  { max: 0.75, name: "Minimal Techno", cls: "min", hint: "driving" },
  { max: 2.0, name: "Breaks · Severe", cls: "breaks", hint: "syncopated" },
];

export interface BedState {
  playing: boolean;
  energy: number;
  section: Section;
  inBreak: boolean;
  beatStep: number;
}

interface Chord {
  v: number[];
  root: number;
}
interface PadVoice {
  g: GainNode;
  oscs: OscillatorNode[];
}

// A natural minor, jazz-voiced. 8-bar loop; repeated refs (AM,AM / FM7,FM7) mean
// the pad only re-triggers on a real chord change.
const AM: Chord = { v: [57, 60, 64, 67], root: 45 };
const FM7: Chord = { v: [57, 60, 64, 65], root: 41 };
const CM7: Chord = { v: [60, 64, 67, 71], root: 48 };
const G6: Chord = { v: [59, 62, 64, 67], root: 43 };
const DM7: Chord = { v: [57, 60, 62, 65], root: 50 };
const EM7: Chord = { v: [59, 62, 64, 67], root: 52 };
const PROG: Chord[] = [AM, AM, FM7, FM7, CM7, G6, DM7, EM7];
const PENT = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91]; // A-minor pentatonic, 2 oct

const BPM = 121;
const SWING = 0.16;
const sec16 = () => 60 / BPM / 4;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rand = Math.random;
const hum = () => (rand() - 0.5) * 0.004;

export class AuroraBed {
  playing = false;

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private energyFilter!: BiquadFilterNode;
  private padFilter!: BiquadFilterNode;
  private sidechain!: GainNode;
  private musicalSum!: GainNode;
  private drumBus!: GainNode;
  private convolver!: ConvolverNode;
  private delay!: DelayNode;
  private chorusIn!: GainNode;
  private groups: Record<string, GainNode> = {};
  private noiseBuf!: AudioBuffer;
  private freqData!: Uint8Array<ArrayBuffer>;

  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private startTime = 0;
  private lastTick = 0;

  private energy = 0.18;
  private severity = 0;
  private eventBoost = 0;
  private padVoices: PadVoice[] = [];
  private lastChord: Chord | null = null;
  private motif: { s: number; n: number }[] | null = null;

  private enabled: Record<string, boolean> = Object.fromEntries(STEMS.map((s) => [s.id, true]));

  // ------------------------------------------------------------ public API
  toggle(): boolean {
    this.playing ? this.stop() : this.start();
    return this.playing;
  }

  start(): void {
    if (!this.ctx) this.buildGraph();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume();
    this.playing = true;
    this.startTime = ctx.currentTime;
    this.lastTick = ctx.currentTime;
    this.step = 0;
    this.lastChord = null;
    this.motif = null;
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.schedTimer = setInterval(() => this.scheduler(), 25);
  }

  stop(): void {
    this.playing = false;
    if (this.schedTimer) clearInterval(this.schedTimer);
    this.schedTimer = null;
    void this.ctx?.suspend();
  }

  /** severity fraction 0..1 (director on-air intensity in the app). */
  setSeverity(x: number): void {
    this.severity = clamp(x, 0, 1) * 0.42;
  }

  /** one-shot: spike energy + riser (an event cut / eventPulse in the app). */
  triggerEvent(): void {
    if (!this.ctx || !this.playing) return;
    this.eventBoost = 0.42;
    this.riser(this.ctx.currentTime + 0.04, 2.6);
  }

  setMasterVolume(x: number): void {
    if (this.ctx) this.master.gain.setTargetAtTime(clamp(x, 0, 1), this.ctx.currentTime, 0.02);
  }

  setStem(id: string, on: boolean): void {
    this.enabled[id] = on;
    if (this.ctx && this.groups[id]) this.groups[id].gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  spectrum(): Uint8Array<ArrayBuffer> {
    if (this.ctx) this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  getState(): BedState {
    const t = this.ctx ? this.ctx.currentTime - this.startTime : 0;
    const bar = Math.floor(t / (sec16() * 16));
    const inBreak = this.playing && bar % 16 >= 14;
    const beatStep = Math.floor(t / sec16()) % 16;
    const section = SECTIONS.find((s) => this.energy < s.max) || SECTIONS[SECTIONS.length - 1];
    return { playing: this.playing, energy: this.energy, section, inBreak, beatStep };
  }

  // ------------------------------------------------------------ buffers
  private fillNoise(b: AudioBuffer): AudioBuffer {
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    return b;
  }
  private makeCrackle(): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      let s = (rand() * 2 - 1) * 0.012;
      if (rand() < 0.0009) s += (rand() * 2 - 1) * (0.4 + rand() * 0.5);
      d[i] = s;
    }
    return b;
  }
  private makeIR(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  private noiseSrc(loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  // ------------------------------------------------------------ graph
  private buildGraph(): void {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.noiseBuf = this.fillNoise(ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate));

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.82;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(limiter);
    limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.makeIR(3.0, 2.6);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    this.convolver.connect(reverbReturn);
    reverbReturn.connect(this.master);

    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = sec16() * 3;
    const delayFb = ctx.createGain();
    delayFb.gain.value = 0.37;
    const delayReturn = ctx.createGain();
    delayReturn.gain.value = 0.4;
    this.delay.connect(delayFb);
    delayFb.connect(this.delay);
    this.delay.connect(delayReturn);
    delayReturn.connect(this.master);
    this.delay.connect(this.convolver);

    this.musicalSum = ctx.createGain();
    this.musicalSum.gain.value = 0.9;
    this.sidechain = ctx.createGain();
    this.sidechain.gain.value = 1;
    this.energyFilter = ctx.createBiquadFilter();
    this.energyFilter.type = "lowpass";
    this.energyFilter.frequency.value = 700;
    this.energyFilter.Q.value = 0.6;
    this.musicalSum.connect(this.sidechain);
    this.sidechain.connect(this.energyFilter);
    this.energyFilter.connect(this.master);

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.92;
    this.drumBus.connect(this.master);

    for (const k of ["keys", "pad", "lead", "bass"]) this.groups[k] = ctx.createGain();
    for (const k of ["kick", "hat", "perc"]) {
      this.groups[k] = ctx.createGain();
      this.groups[k].connect(this.drumBus);
    }
    this.groups.atmos = ctx.createGain();
    this.groups.atmos.connect(this.master);
    this.groups.keys.connect(this.musicalSum);
    this.groups.lead.connect(this.musicalSum);
    this.groups.bass.connect(this.musicalSum);

    // pad chorus (dry + two modulated, panned delay lines) → LFO filter
    this.chorusIn = ctx.createGain();
    const chorusOut = ctx.createGain();
    const cDry = ctx.createGain();
    cDry.gain.value = 0.7;
    this.chorusIn.connect(cDry);
    cDry.connect(chorusOut);
    const mkVoice = (base: number, rate: number, depth: number, pan: number) => {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg);
      lg.connect(d.delayTime);
      lfo.start();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      this.chorusIn.connect(d);
      d.connect(p);
      p.connect(chorusOut);
    };
    mkVoice(0.021, 0.6, 0.003, -0.6);
    mkVoice(0.027, 0.47, 0.0035, 0.6);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.8;
    chorusOut.connect(this.padFilter);
    this.padFilter.connect(this.groups.pad);
    this.groups.pad.connect(this.musicalSum);
    const padLFO = ctx.createOscillator();
    padLFO.type = "sine";
    padLFO.frequency.value = 0.08;
    const plg = ctx.createGain();
    plg.gain.value = 650;
    padLFO.connect(plg);
    plg.connect(this.padFilter.frequency);
    padLFO.start();

    for (const k of Object.keys(this.groups)) this.groups[k].gain.value = this.enabled[k] ? 1 : 0;

    // vinyl atmosphere — always running
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.5;
    const chp = ctx.createBiquadFilter();
    chp.type = "highpass";
    chp.frequency.value = 1400;
    const crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = this.makeCrackle();
    crackleSrc.loop = true;
    crackleSrc.connect(chp);
    chp.connect(crackleGain);
    crackleGain.connect(this.groups.atmos);
    crackleSrc.start();
  }

  // ------------------------------------------------------------ voices
  private duck(t: number): void {
    const g = this.sidechain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.3, t);
    g.setTargetAtTime(1, t + 0.008, 0.12);
  }

  private epNote(midi: number, t: number, dur: number, level: number, pan: number): void {
    const ctx = this.ctx!;
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
    pn.connect(this.groups.keys);
    const rs = ctx.createGain();
    rs.gain.value = 0.26;
    amp.connect(rs);
    rs.connect(this.convolver);
    const end = t + Math.max(dur, 0.2) + 0.6;
    car.start(t);
    mod.start(t);
    mod2.start(t);
    car.stop(end);
    mod.stop(end);
    mod2.stop(end);
  }
  private epChord(chord: Chord, t: number, dur: number, level: number, spread: boolean): void {
    const n = chord.v.length;
    chord.v.forEach((m, i) =>
      this.epNote(m, t + i * 0.007 + hum(), dur, level / Math.sqrt(n), spread ? ((i / (n - 1)) * 2 - 1) * 0.35 : 0),
    );
  }

  private padChord(chord: Chord, t: number): void {
    const ctx = this.ctx!;
    this.padVoices.forEach((v) => {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.0001, t, 0.8);
      v.oscs.forEach((o) => {
        try {
          o.stop(t + 3.4);
        } catch {
          /* already stopped */
        }
      });
    });
    this.padVoices = [];
    const peak = 0.06 / chord.v.length;
    chord.v.forEach((midi, idx) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      const pan = ctx.createStereoPanner();
      pan.pan.value = ((idx / (chord.v.length - 1)) * 2 - 1) * 0.5;
      const oscs: OscillatorNode[] = [];
      [-9, 0, 8].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(midi);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        oscs.push(o);
      });
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
      pan.connect(this.chorusIn);
      const rs = ctx.createGain();
      rs.gain.value = 0.6;
      g.connect(rs);
      rs.connect(this.convolver);
      g.gain.exponentialRampToValueAtTime(peak, t + 1.8);
      g.gain.setTargetAtTime(peak * 0.8, t + 1.8, 1.2);
      this.padVoices.push({ g, oscs });
    });
  }

  private leadNote(midi: number, t: number, level: number): void {
    const ctx = this.ctx!;
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
    pn.connect(this.groups.lead);
    const ds = ctx.createGain();
    ds.gain.value = 0.5;
    amp.connect(ds);
    ds.connect(this.delay);
    const rs = ctx.createGain();
    rs.gain.value = 0.3;
    amp.connect(rs);
    rs.connect(this.convolver);
    car.start(t);
    mod.start(t);
    car.stop(t + 0.7);
    mod.stop(t + 0.7);
  }

  private bass(root: number, t: number, dur: number, vel: number, glide: boolean): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.012);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.55, 0.1);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    if (glide) {
      for (const o of [sub, saw]) {
        o.frequency.setValueAtTime(mtof(root) * 0.94, t);
        o.frequency.exponentialRampToValueAtTime(mtof(root), t + 0.05);
      }
    } else {
      sub.frequency.value = mtof(root);
      saw.frequency.value = mtof(root);
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
    g.connect(this.groups.bass);
    sub.start(t);
    saw.start(t);
    sub.stop(t + dur + 0.3);
    saw.stop(t + dur + 0.3);
  }

  private kick(t: number, vel: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    o.connect(g);
    g.connect(this.groups.kick);
    o.start(t);
    o.stop(t + 0.44);
    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.groups.kick);
    n.start(t);
    n.stop(t + 0.05);
  }

  private hat(t: number, vel: number, open: boolean, pan: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7800;
    const dec = open ? 0.17 : 0.045;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.34, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    n.connect(hp);
    hp.connect(g);
    g.connect(pn);
    pn.connect(this.groups.hat);
    n.start(t);
    n.stop(t + dec + 0.02);
  }

  private clap(t: number, vel: number): void {
    const ctx = this.ctx!;
    const burst = (tt: number, v: number) => {
      const n = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500;
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.12);
      n.connect(bp);
      bp.connect(g);
      g.connect(this.groups.perc);
      const rs = ctx.createGain();
      rs.gain.value = 0.25;
      g.connect(rs);
      rs.connect(this.convolver);
      n.start(tt);
      n.stop(tt + 0.14);
    };
    burst(t, vel * 0.3);
    burst(t + 0.011, vel * 0.42);
    burst(t + 0.022, vel * 0.5);
    burst(t + 0.036, vel * 0.6);
  }

  private snare(t: number, vel: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.groups.perc);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og);
    og.connect(this.groups.perc);
    o.start(t);
    o.stop(t + 0.1);
    const rs = ctx.createGain();
    rs.gain.value = 0.2;
    g.connect(rs);
    rs.connect(this.convolver);
    n.start(t);
    n.stop(t + 0.16);
  }

  private shaker(t: number, vel: number, pan: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
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
    pn.connect(this.groups.perc);
    n.start(t);
    n.stop(t + 0.08);
  }

  private riser(t: number, dur: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc(true);
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
    rs.connect(this.convolver);
    g.connect(this.master);
    n.start(t);
    n.stop(t + dur + 0.2);
  }

  private genMotif(): { s: number; n: number }[] {
    const rhythms = [
      [0, 3, 6, 10],
      [0, 4, 7, 10, 12],
      [2, 6, 9, 12],
      [0, 2, 6, 8, 12, 14],
      [3, 6, 10, 13],
    ];
    const r = rhythms[(rand() * rhythms.length) | 0];
    let i = 3 + ((rand() * 3) | 0);
    return r.map((s) => {
      i = clamp(i + (((rand() * 3) | 0) - 1), 0, PENT.length - 1);
      return { s, n: PENT[i] };
    });
  }

  // ------------------------------------------------------------ scheduler
  private scheduleStep(stp: number, t: number): void {
    const s16 = stp % 16;
    const bar = Math.floor(stp / 16);
    const barCyc = bar % 16;
    const breakdown = barCyc >= 14;
    const chord = PROG[bar % PROG.length];
    const e = this.energy;
    const on = (id: string) => this.enabled[id];
    const changed = chord !== this.lastChord;
    this.lastChord = chord;

    if (changed) this.padChord(chord, t);

    if (on("keys") && !breakdown) {
      if (e < 0.3) {
        if (changed) this.epChord(chord, t, sec16() * 6, 0.15, true);
      } else {
        const sw = SWING * sec16();
        if (s16 % 4 === 2) this.epChord(chord, t + sw + hum(), 0.17, 0.13 + e * 0.05, true);
        if (e > 0.62 && (s16 === 7 || s16 === 11)) this.epChord(chord, t + sw, 0.14, 0.09, true);
      }
    }

    if (on("lead") && e > 0.4 && e < 0.92 && !breakdown) {
      if (stp % (16 * 8) === 0 || !this.motif) this.motif = this.genMotif();
      const slot = bar % 4;
      const play = slot === 0 || slot === 1 || slot === 2;
      const oct = slot === 2 ? 12 : 0;
      if (play) {
        const hit = this.motif.find((m) => m.s === s16);
        if (hit) this.leadNote(hit.n + oct, t + (s16 % 2 ? SWING * sec16() : 0) + hum(), 0.55 + (e - 0.4));
      }
    }

    if (on("bass") && e > 0.26 && !breakdown) {
      if (s16 % 4 === 2) this.bass(chord.root, t, sec16() * 2 * 0.9, 0.85, false);
      if (e > 0.62 && s16 % 4 === 0 && s16 !== 0) this.bass(chord.root, t, sec16() * 1.4, 0.55, true);
    }

    if (!breakdown) {
      if (on("kick") && e > 0.34) {
        if (e <= 0.75) {
          if (s16 % 4 === 0) {
            this.kick(t, 0.92);
            this.duck(t);
          }
        } else if (s16 === 0 || s16 === 6 || s16 === 10) {
          this.kick(t, 0.92);
          this.duck(t);
        }
      }
      if (on("perc")) {
        if (e > 0.5 && e <= 0.75 && (s16 === 4 || s16 === 12)) this.clap(t, 0.7);
        if (e > 0.75 && (s16 === 4 || s16 === 12)) this.snare(t, 0.95);
        if (e > 0.75 && (s16 === 7 || s16 === 14)) this.snare(t, 0.32);
        if (e > 0.45 && s16 % 2 === 1) this.shaker(t + SWING * sec16() + hum(), 0.5 + rand() * 0.3, (rand() * 2 - 1) * 0.3);
      }
      if (on("hat") && e > 0.36) {
        const sw = s16 % 2 === 1 ? SWING * sec16() : 0;
        const pan = (rand() * 2 - 1) * 0.25;
        if (s16 % 4 === 2) this.hat(t + sw, 0.62, e < 0.5, pan);
        if (e > 0.5 && s16 % 2 === 0 && s16 % 4 !== 2) this.hat(t, 0.32, false, pan);
        if (e > 0.66 && s16 % 2 === 1) this.hat(t + sw, 0.2, false, pan);
      }
    } else {
      if (on("perc") && s16 % 4 === 2) this.shaker(t, 0.22, 0);
      if (barCyc === 15 && s16 === 0) this.riser(t, sec16() * 16);
    }
  }

  private updateEnergy(): void {
    const ctx = this.ctx!;
    const dt = Math.max(0, ctx.currentTime - this.lastTick);
    this.lastTick = ctx.currentTime;
    const t = ctx.currentTime - this.startTime;
    const drift = 0.34 + 0.13 * Math.sin((t / 150) * Math.PI * 2 - Math.PI / 2);
    this.eventBoost *= Math.exp(-dt / 6.5);
    const target = clamp(drift + this.severity + this.eventBoost, 0, 1);
    this.energy += (target - this.energy) * clamp(dt * 1.6, 0, 0.2);
    this.energyFilter.frequency.setTargetAtTime(650 + this.energy * 5200, ctx.currentTime, 0.08);
    this.padFilter.frequency.setTargetAtTime(520 + this.energy * 2400, ctx.currentTime, 0.1);
  }

  private scheduler(): void {
    const ctx = this.ctx!;
    this.updateEnergy();
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += sec16();
      this.step++;
    }
  }
}
