/**
 * AuroraBed — a self-contained generative music engine for the broadcast bed.
 *
 * Everything is synthesized live from oscillators + noise via the Web Audio API
 * (no samples, no libraries) so it is copyright-safe for a 24/7 stream and never
 * repeats. One `energy` value (0..1) picks the SECTION (chill → breaks): it
 * free-runs a slow drift nudged up by `severity` / event pulses, or is pinned
 * by a fixed AudioMode. Above the step sequencer sits the ARRANGER: every 8–32
 * bars it plans a phrase (intro / main / build / break) with its own chord
 * progression, key, drum + bass + comping patterns, instrument patches and
 * ending (fill, riser, drop-out), so the bed has real structure and variety.
 *
 * Modules: theory (keys/chords), patterns (banks), arranger (phrases), graph
 * (the rig), drums + synths (voices), clock (stall-proof scheduling), dsp.
 * Browser-only: no AudioContext is created until start().
 */
import type { AudioMode } from "@photonsurge/shared/control";
import { type Phrase, type StemId, phraseLabel, planPhrase } from "./arranger";
import { LOOKAHEAD_S, resyncGrid, startTicker } from "./clock";
import { clap, duck, hat, kick, ride, rim, riser, shaker, snare, swell } from "./drums";
import { type Rig, buildRig } from "./graph";
import { type DrumVoice, type Fill, fillFor } from "./patterns";
import { type Rng, chance, mulberry32, pick } from "./rng";
import { Pad, acidNote, bassNote, bellNote, fmLead, pluckChord, rhodesChord, stabChord } from "./synths";
import { type Chord, type Key, type SectionCls, chordOn, keyName, pentatonic } from "./theory";

/**
 * Pinned energy target per fixed AudioMode — centred inside each SECTION band
 * below, so a pinned mode lands squarely in its named section. "auto" has no
 * entry: energy free-runs off drift + severity.
 */
export const MODE_ENERGY: Record<Exclude<AudioMode, "auto">, number> = {
  chill: 0.18,
  lounge: 0.38,
  deep: 0.53,
  minimal: 0.68,
  breaks: 0.85,
};

export interface StemDef {
  id: StemId;
  name: string;
  note: string;
  color: string;
  drum?: boolean;
  live: (energy: number) => boolean;
}

export const STEMS: StemDef[] = [
  { id: "keys", name: "Keys", note: "rhodes · stab · pluck", color: "#54e6a6", live: () => true },
  { id: "pad", name: "Pad", note: "wash", color: "#35d6d0", live: () => true },
  { id: "lead", name: "Lead", note: "motif · bell · acid", color: "#8cf5cd", live: (e) => e > 0.4 },
  { id: "bass", name: "Bass", note: "sub", color: "#a98bff", live: (e) => e > 0.26 },
  { id: "kick", name: "Kick", note: "floor / breaks", color: "#ffb454", drum: true, live: (e) => e > 0.34 },
  { id: "hat", name: "Hats", note: "swing · ride", color: "#ffb454", drum: true, live: (e) => e > 0.36 },
  { id: "perc", name: "Perc", note: "clap · rim · shaker", color: "#ff5f6d", drum: true, live: (e) => e > 0.45 },
  { id: "atmos", name: "Atmos", note: "vinyl", color: "#6a7d97", live: () => true },
];
const STEM_BY_ID = Object.fromEntries(STEMS.map((s) => [s.id, s])) as Record<StemId, StemDef>;

export interface Section {
  max: number;
  name: string;
  cls: SectionCls;
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
  /** True while the arranger is in a break phrase (rhythm section out). */
  inBreak: boolean;
  beatStep: number;
  /** Steps dropped after main-thread stalls since start(). */
  dropped: number;
  /** Current phrase, e.g. "main · 16 bars · vamp · D minor". */
  phrase: string;
  key: string;
}

const BPM = 121;
const sec16 = () => 60 / BPM / 4;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rand = Math.random;
const hum = () => (rand() - 0.5) * 0.004;

interface MotifNote {
  s: number;
  i: number;
}
interface AcidStep {
  s: number;
  iv: number;
  accent: boolean;
  glide: boolean;
}

const RHYTHMS = [
  [0, 3, 6, 10],
  [0, 4, 7, 10, 12],
  [2, 6, 9, 12],
  [0, 2, 6, 8, 12, 14],
  [3, 6, 10, 13],
  [0, 6, 12],
  [1, 4, 8, 11, 14],
];

function genMotif(rng: Rng): MotifNote[] {
  const r = pick(rng, RHYTHMS);
  let i = 3 + Math.floor(rng() * 3);
  return r.map((s) => {
    const leap = chance(rng, 0.15) ? (chance(rng, 0.5) ? 2 : -2) : 0;
    i = clamp(i + (Math.floor(rng() * 3) - 1) + leap, 0, 9);
    return { s, i };
  });
}

function genAcidBar(rng: Rng): AcidStep[] {
  const out: AcidStep[] = [];
  for (let s = 0; s < 16; s++) {
    if (!chance(rng, s % 2 === 0 ? 0.55 : 0.28)) continue;
    out.push({ s, iv: pick(rng, [0, 0, 0, 3, 5, 7, 10, 12]), accent: chance(rng, 0.3), glide: chance(rng, 0.35) });
  }
  return out;
}

const sameKey = (a: Key, b: Key) => a.tonic === b.tonic && a.mode === b.mode;

export class AuroraBed {
  playing = false;

  private rig: Rig | null = null;
  private pad: Pad | null = null;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(512);

  private stopTicker: (() => void) | null = null;
  private dropped = 0;
  private nextNoteTime = 0;
  private step = 0;
  private startTime = 0;
  private lastTick = 0;

  private energy = 0.18;
  private severity = 0;
  private eventBoost = 0;
  /** Pinned energy target (a fixed AudioMode), or null to free-run ("auto"). */
  private forcedEnergy: number | null = null;

  private enabled: Record<string, boolean> = Object.fromEntries(STEMS.map((s) => [s.id, true]));
  private rng: Rng = mulberry32((Date.now() ^ Math.floor(rand() * 0xffffffff)) >>> 0);

  // ---- arrangement state
  private phrase: Phrase | null = null;
  private phraseStart = 0;
  private phraseEnd = 0;
  private fill: Fill = { hits: {}, kickMuteFrom: 16 };
  private chord: Chord | null = null;
  private chordKey: Key | null = null;
  private chordChanged = false;
  private motif: MotifNote[] | null = null;
  private acidBar: AcidStep[] = [];
  private acidPrev: number | null = null;

  // ------------------------------------------------------------ public API
  toggle(): boolean {
    this.playing ? this.stop() : this.start();
    return this.playing;
  }

  start(): void {
    if (!this.rig) {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.rig = buildRig(new Ctor(), sec16(), this.enabled);
      this.pad = new Pad(this.rig);
      this.freqData = new Uint8Array(this.rig.analyser.frequencyBinCount);
    }
    const ctx = this.rig.ctx;
    if (ctx.state === "suspended") void ctx.resume();
    this.playing = true;
    this.startTime = ctx.currentTime;
    this.lastTick = ctx.currentTime;
    this.step = 0;
    this.phrase = null;
    this.chord = null;
    this.chordKey = null;
    this.motif = null;
    this.acidPrev = null;
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.stopTicker?.();
    this.stopTicker = startTicker(() => this.scheduler());
  }

  stop(): void {
    this.playing = false;
    this.stopTicker?.();
    this.stopTicker = null;
    void this.rig?.ctx.suspend();
  }

  /** severity fraction 0..1 (director on-air intensity in the app). */
  setSeverity(x: number): void {
    this.severity = clamp(x, 0, 1) * 0.42;
  }

  /** Pin the arrangement to a fixed section, or "auto" to free-run again. */
  setMode(mode: AudioMode): void {
    this.forcedEnergy = mode === "auto" ? null : (MODE_ENERGY[mode] ?? null);
  }

  /**
   * Underlying AudioContext state, for autoplay-block detection: "suspended"
   * while `playing` means the browser refused resume() without a user gesture.
   */
  contextState(): AudioContextState | null {
    return this.rig?.ctx.state ?? null;
  }

  /** one-shot: spike energy + riser (an event cut / eventPulse in the app). */
  triggerEvent(): void {
    if (!this.rig || !this.playing) return;
    this.eventBoost = 0.42;
    riser(this.rig, this.rig.ctx.currentTime + 0.04, 2.6);
  }

  setMasterVolume(x: number): void {
    if (this.rig) this.rig.master.gain.setTargetAtTime(clamp(x, 0, 1), this.rig.ctx.currentTime, 0.02);
  }

  setStem(id: string, on: boolean): void {
    this.enabled[id] = on;
    const g = this.rig?.groups[id as StemId];
    if (this.rig && g) g.gain.setTargetAtTime(on ? 1 : 0, this.rig.ctx.currentTime, 0.02);
  }

  spectrum(): Uint8Array<ArrayBuffer> {
    if (this.rig) this.rig.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  getState(): BedState {
    const t = this.rig ? this.rig.ctx.currentTime - this.startTime : 0;
    const beatStep = Math.floor(t / sec16()) % 16;
    return {
      playing: this.playing,
      energy: this.energy,
      section: this.section(),
      inBreak: this.playing && this.phrase?.role === "break",
      beatStep,
      dropped: this.dropped,
      phrase: this.phrase ? phraseLabel(this.phrase) : "—",
      key: this.phrase ? keyName(this.phrase.key) : "—",
    };
  }

  // ------------------------------------------------------------ arrangement
  private section(): Section {
    return SECTIONS.find((s) => this.energy < s.max) || SECTIONS[SECTIONS.length - 1];
  }

  /** At a bar boundary: start the next phrase when this one ends, or cut it at a 4-bar mark if the section drifted. */
  private maybeNewPhrase(bar: number, cls: SectionCls): void {
    const ph = this.phrase;
    const barIn = ph ? bar - this.phraseStart : 0;
    const ended = !ph || bar >= this.phraseEnd;
    const drifted = !!ph && ph.cls !== cls && barIn >= 4 && barIn % 4 === 0;
    if (!ended && !drifted) return;
    const next = planPhrase(this.rng, cls, ph);
    this.phrase = next;
    this.phraseStart = bar;
    this.phraseEnd = bar + next.bars;
    this.fill = fillFor(next.fill, this.rng);
    this.motif = null;
  }

  private playKeys(ph: Phrase, chord: Chord, t: number, dur: number, level: number): void {
    const rig = this.rig!;
    if (ph.keysPatch === "stab") stabChord(rig, chord.notes, t, level * 1.1);
    else if (ph.keysPatch === "pluck") pluckChord(rig, chord.notes, t, level * 1.2);
    else rhodesChord(rig, chord.notes, t, dur, level, true);
  }

  private motifStep(ph: Phrase, chord: Chord, barIn: number, s16: number, t: number): void {
    if (s16 === 0 && (barIn % 8 === 0 || !this.motif)) this.motif = genMotif(this.rng);
    const slot = barIn % 4;
    if (slot === 3 || !this.motif) return; // call, answer, answer up an octave, rest
    const hit = this.motif.find((m) => m.s === s16);
    if (!hit) return;
    const scale = pentatonic(ph.key);
    let idx = clamp(hit.i + (slot === 1 ? 1 : slot === 2 ? 5 : 0), 0, scale.length - 1);
    if (slot === 2 && hit === this.motif[this.motif.length - 1]) {
      // resolve the answer onto a chord tone
      for (let d = 0; d < scale.length; d++) {
        const c = [idx - d, idx + d].find((k) => k >= 0 && k < scale.length && chord.pcs.includes(scale[k] % 12));
        if (c !== undefined) {
          idx = c;
          break;
        }
      }
    }
    const e = this.energy;
    const tt = t + (s16 % 2 ? ph.swing * sec16() : 0) + hum();
    const level = 0.55 + (e - 0.4);
    if (ph.leadPatch === "bell") bellNote(this.rig!, scale[idx], tt, level * 0.1, (rand() * 2 - 1) * 0.5);
    else fmLead(this.rig!, scale[idx], tt, level);
  }

  private acidStep(ph: Phrase, barIn: number, s16: number, ts: number): void {
    if (s16 === 0 && barIn % 2 === 0) this.acidBar = genAcidBar(this.rng);
    const n = this.acidBar.find((x) => x.s === s16);
    if (!n) return;
    const midi = ph.key.tonic + 24 + n.iv;
    acidNote(this.rig!, midi, ts, sec16() * 0.9, n.accent, n.glide ? this.acidPrev : null);
    this.acidPrev = midi;
  }

  // ------------------------------------------------------------ sequencer
  private scheduleStep(stp: number, t: number): void {
    const rig = this.rig!;
    const s16 = stp % 16;
    const bar = Math.floor(stp / 16);
    const cls = this.section().cls;
    if (s16 === 0) this.maybeNewPhrase(bar, cls);
    const ph = this.phrase!;
    const barIn = bar - this.phraseStart;
    const lastBar = barIn === ph.bars - 1;
    const e = this.energy;
    const rng = this.rng;
    const on = (id: StemId) => this.enabled[id] && ph.layers.has(id) && STEM_BY_ID[id].live(e);
    const ts = t + (s16 % 2 ? ph.swing * sec16() : 0);

    // harmony: one chord per bar, voice-led from the last one
    if (s16 === 0) {
      const deg = ph.progression.degrees[barIn % ph.progression.degrees.length];
      this.chordChanged = !this.chord || this.chord.degree !== deg || !this.chordKey || !sameKey(this.chordKey, ph.key);
      if (this.chordChanged) {
        this.chord = chordOn(ph.key, deg, this.chord);
        this.chordKey = ph.key;
      }
    }
    const chord = this.chord!;
    const changed = s16 === 0 && this.chordChanged;
    const fill = lastBar ? this.fill : null;
    const kickMuted = (!!fill && s16 >= fill.kickMuteFrom) || (ph.transition === "dropout" && lastBar && s16 >= 12);

    if (changed) this.pad!.change(chord, t, cls === "chill" || cls === "lounge");

    if (on("keys")) {
      if (ph.comp.sustain || e < 0.3) {
        if (changed) this.playKeys(ph, chord, t, sec16() * 6, 0.15);
      } else {
        for (const h of ph.comp.hits)
          if (h.s === s16 && (h.p === undefined || chance(rng, h.p))) this.playKeys(ph, chord, ts + hum(), 0.17, h.v * (0.2 + e * 0.08));
      }
    }

    if (on("lead") && e < 0.92 && ph.role !== "intro") {
      if (ph.leadPatch === "acid") this.acidStep(ph, barIn, s16, ts);
      else this.motifStep(ph, chord, barIn, s16, t);
    }

    if (on("bass") && !kickMuted) {
      for (const n of ph.bass.notes)
        if (n.s === s16 && (n.p === undefined || chance(rng, n.p))) bassNote(rig, chord.root + n.iv, ts, n.len * sec16(), n.v, !!n.glide);
    }

    const hits = ph.drums.hits;
    const fillHits = fill?.hits ?? {};
    const play = (voice: DrumVoice, fn: (v: number) => void) => {
      for (const src of [hits[voice], fillHits[voice]])
        if (src) for (const h of src) if (h.s === s16 && (h.p === undefined || chance(rng, h.p))) fn(h.v);
    };
    if (on("kick") && !kickMuted)
      play("kick", (v) => {
        kick(rig, t, v);
        duck(rig, t);
      });
    if (on("hat")) {
      const pan = (rng() * 2 - 1) * 0.25;
      play("hatC", (v) => hat(rig, ts, v, false, pan));
      play("hatO", (v) => hat(rig, ts, v, true, pan));
      play("ride", (v) => ride(rig, ts, v));
    }
    if (on("perc")) {
      play("clap", (v) => clap(rig, t, v));
      play("snare", (v) => snare(rig, t, v));
      play("rim", (v) => rim(rig, ts, v));
      play("shaker", (v) => shaker(rig, ts + hum(), v, (rng() * 2 - 1) * 0.3));
    }

    // transitions into the next phrase
    if (s16 === 0 && ph.transition === "riser" && barIn === ph.bars - 2) riser(rig, t, sec16() * 32);
    if (s16 === 0 && lastBar && (ph.fill === "big" || ph.transition === "riser")) swell(rig, t + sec16() * 8, sec16() * 8);
  }

  private updateEnergy(): void {
    const rig = this.rig!;
    const ctx = rig.ctx;
    const dt = Math.max(0, ctx.currentTime - this.lastTick);
    this.lastTick = ctx.currentTime;
    const t = ctx.currentTime - this.startTime;
    const drift = 0.34 + 0.13 * Math.sin((t / 150) * Math.PI * 2 - Math.PI / 2);
    this.eventBoost *= Math.exp(-dt / 6.5);
    const target = clamp((this.forcedEnergy ?? drift + this.severity) + this.eventBoost, 0, 1);
    this.energy += (target - this.energy) * clamp(dt * 1.6, 0, 0.2);
    rig.energyFilter.frequency.setTargetAtTime(650 + this.energy * 5200, ctx.currentTime, 0.08);
    rig.padFilter.frequency.setTargetAtTime(520 + this.energy * 2400, ctx.currentTime, 0.1);
  }

  private scheduler(): void {
    const ctx = this.rig!.ctx;
    this.updateEnergy();
    const grid = resyncGrid({ step: this.step, time: this.nextNoteTime }, ctx.currentTime, sec16());
    if (grid.dropped) {
      this.step = grid.step;
      this.nextNoteTime = grid.time;
      this.dropped += grid.dropped;
    }
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD_S) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += sec16();
      this.step++;
    }
  }
}
