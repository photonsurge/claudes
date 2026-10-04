import time
import math
from dataclasses import dataclass
import numpy as np
import sounddevice as sd

# -----------------------------
# Pitch helpers
# -----------------------------
NOTE_TO_SEMI = {"C":0,"C#":1,"D":2,"D#":3,"E":4,"F":5,"F#":6,"G":7,"G#":8,"A":9,"A#":10,"B":11}

def midi_to_hz(m: float) -> float:
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))

def chord_midi(root_midi: int, quality: str) -> list[int]:
    if quality == "maj":
        return [root_midi, root_midi + 4, root_midi + 7]
    if quality == "min":
        return [root_midi, root_midi + 3, root_midi + 7]
    if quality == "sus2":
        return [root_midi, root_midi + 2, root_midi + 7]
    if quality == "sus4":
        return [root_midi, root_midi + 5, root_midi + 7]
    return [root_midi, root_midi + 4, root_midi + 7]

# -----------------------------
# DSP building blocks
# -----------------------------
class OnePoleLP:
    def __init__(self, sr: int, cutoff_hz: float):
        self.sr = sr
        self.set_cutoff(cutoff_hz)
        self.z = 0.0

    def set_cutoff(self, cutoff_hz: float):
        # simple one-pole coefficient
        x = math.exp(-2.0 * math.pi * cutoff_hz / self.sr)
        self.a = x
        self.b = 1.0 - x

    def process(self, x: np.ndarray) -> np.ndarray:
        y = np.empty_like(x)
        z = self.z
        a = self.a
        b = self.b
        for i in range(len(x)):
            z = a * z + b * x[i]
            y[i] = z
        self.z = z
        return y

class SimpleVerb:
    """Feedback delay with damping. Cheap but effective."""
    def __init__(self, sr: int, delay_ms: float = 170.0, feedback: float = 0.35, damp: float = 0.25):
        self.sr = sr
        self.delay = max(64, int(sr * delay_ms / 1000.0))
        self.fb = float(np.clip(feedback, 0.0, 0.85))
        self.damp = float(np.clip(damp, 0.0, 0.99))
        self.bufL = np.zeros(self.delay, dtype=np.float32)
        self.bufR = np.zeros(self.delay, dtype=np.float32)
        self.i = 0
        self.lpL = 0.0
        self.lpR = 0.0

    def process(self, xL: np.ndarray, xR: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        yL = np.empty_like(xL)
        yR = np.empty_like(xR)
        i = self.i
        for n in range(len(xL)):
            dl = self.bufL[i]
            dr = self.bufR[i]
            # damping in the loop
            self.lpL = (1 - self.damp) * dl + self.damp * self.lpL
            self.lpR = (1 - self.damp) * dr + self.damp * self.lpR

            outL = xL[n] + self.lpL
            outR = xR[n] + self.lpR

            self.bufL[i] = xL[n] + self.lpL * self.fb
            self.bufR[i] = xR[n] + self.lpR * self.fb

            yL[n] = outL
            yR[n] = outR

            i += 1
            if i >= self.delay:
                i = 0
        self.i = i
        return yL, yR

class Pluck:
    """Karplus–Strong string."""
    def __init__(self, sr: int, freq: float, decay: float, brightness: float, pan: float):
        self.sr = sr
        self.freq = max(30.0, float(freq))
        n = max(2, int(sr / self.freq))
        self.buf = (np.random.rand(n).astype(np.float32) * 2.0 - 1.0) * float(brightness)
        self.idx = 0
        self.prev = float(self.buf[-1])
        self.decay = float(decay)
        self.pan = float(np.clip(pan, -1.0, 1.0))

    def render(self, nframes: int) -> tuple[np.ndarray, np.ndarray]:
        mono = np.empty(nframes, dtype=np.float32)
        buf = self.buf
        idx = self.idx
        prev = self.prev
        decay = self.decay

        for i in range(nframes):
            cur = float(buf[idx])
            y = decay * 0.5 * (cur + prev)
            buf[idx] = y
            prev = y
            mono[i] = y
            idx += 1
            if idx >= buf.shape[0]:
                idx = 0

        self.idx = idx
        self.prev = prev

        # constant-power panning
        angle = (self.pan + 1.0) * 0.25 * math.pi
        l = math.cos(angle)
        r = math.sin(angle)
        return mono * l, mono * r

class Bell:
    """Sparse mallet/bell: sum of decaying sines (inharmonic-ish)."""
    def __init__(self, sr: int, freq: float, amp: float, pan: float):
        self.sr = sr
        self.freq = float(freq)
        self.amp = float(amp)
        self.pan = float(np.clip(pan, -1.0, 1.0))
        self.phase = 0.0
        self.t = 0.0

        # partials
        self.partials = np.array([1.0, 2.01, 3.12, 4.23], dtype=np.float32)
        self.gains = np.array([1.0, 0.35, 0.18, 0.09], dtype=np.float32)
        self.decays = np.array([2.2, 2.8, 3.4, 4.2], dtype=np.float32)

    def render(self, nframes: int) -> tuple[np.ndarray, np.ndarray]:
        t = (np.arange(nframes, dtype=np.float32) + self.t) / self.sr
        out = np.zeros(nframes, dtype=np.float32)

        # build bell
        for p, g, d in zip(self.partials, self.gains, self.decays):
            env = np.exp(-d * t)
            out += (np.sin(2 * np.pi * (self.freq * p) * t) * env * g).astype(np.float32)

        self.t += nframes
        out *= self.amp

        angle = (self.pan + 1.0) * 0.25 * math.pi
        l = math.cos(angle)
        r = math.sin(angle)
        return out * l, out * r

class Kick:
    """Soft kick drum: falling sine + exponential envelope."""
    def __init__(self, sr: int, amp: float):
        self.sr = sr
        self.amp = float(amp)
        self.t = 0

    def render(self, nframes: int) -> np.ndarray:
        t = (np.arange(nframes, dtype=np.float32) + self.t) / self.sr
        # pitch drops quickly
        f0, f1 = 90.0, 40.0
        f = f1 + (f0 - f1) * np.exp(-35.0 * t)
        phase = 2 * np.pi * np.cumsum(f) / self.sr
        env = np.exp(-10.0 * t)
        out = np.sin(phase).astype(np.float32) * env * self.amp
        self.t += nframes
        return out

class Hat:
    """Brushy hat: filtered noise + fast decay."""
    def __init__(self, sr: int, amp: float):
        self.sr = sr
        self.amp = float(amp)
        self.lp = OnePoleLP(sr, 9000.0)
        self.t = 0

    def render(self, nframes: int) -> np.ndarray:
        t = (np.arange(nframes, dtype=np.float32) + self.t) / self.sr
        env = np.exp(-40.0 * t)
        noise = (np.random.rand(nframes).astype(np.float32) * 2.0 - 1.0)
        # high-ish noise: remove lows by subtracting lowpass (poor-man HP)
        low = self.lp.process(noise)
        hp = noise - low
        out = hp * env * self.amp
        self.t += nframes
        return out

# -----------------------------
# Engine
# -----------------------------
@dataclass
class EngineConfig:
    sr: int = 48000
    block: int = 512
    bpm: float = 64.0
    key: str = "G"
    mode: str = "maj"          # "maj" or "min"
    master: float = 0.22
    widen: float = 0.22
    chord_seconds: float = 12.0
    # instrument mix
    pluck_level: float = 1.00
    pad_level: float = 0.35
    bell_level: float = 0.25
    drum_level: float = 0.35

class AcousticBackground:
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.rng = np.random.default_rng()

        root_semi = NOTE_TO_SEMI.get(cfg.key.upper(), 7)
        self.key_root = 60 + root_semi  # around middle C

        # Safe pop-ish progression; minor gets its own nice loop
        self.progression = [("I", 0, "maj"), ("V", 7, "maj"), ("vi", 9, "min"), ("IV", 5, "maj")]
        if cfg.mode == "min":
            self.progression = [("i", 9, "min"), ("VI", 5, "maj"), ("III", 0, "maj"), ("VII", 7, "maj")]

        self.chord_idx = 0
        self.next_chord_wall = time.time()

        # Sequencing
        self.seconds_per_beat = 60.0 / cfg.bpm
        self.arp_interval = self.seconds_per_beat * 0.75
        self.next_arp_s = 0.0
        self.arp_step = 0
        self.arp_pattern = [0, 1, 2, 1, 2, 1, 0, 1]

        self.next_bell_s = 4.0
        self.next_kick_s = 0.0
        self.next_hat_s = 0.0

        self.frame_cursor = 0

        self.plucks: list[tuple[Pluck, float, float]] = []  # (obj, start_s, life_s)
        self.bells: list[tuple[Bell, float, float]] = []
        self.kicks: list[tuple[Kick, float, float]] = []
        self.hats: list[tuple[Hat, float, float]] = []

        self.verb = SimpleVerb(cfg.sr, delay_ms=185.0, feedback=0.33, damp=0.30)

        # pad (noise->LP + sine), state for LP
        self.pad_lp = OnePoleLP(cfg.sr, 900.0)
        self.pad_phase = 0.0

    def now_s(self) -> float:
        return self.frame_cursor / self.cfg.sr

    def current_chord(self) -> tuple[str, list[int]]:
        roman, semi_off, qual = self.progression[self.chord_idx]
        root = self.key_root + semi_off
        root = max(45, root - 12)  # comfortable register
        return roman, chord_midi(root, qual)

    def maybe_advance_chord(self):
        if time.time() >= self.next_chord_wall:
            self.chord_idx = (self.chord_idx + 1) % len(self.progression)
            self.next_chord_wall = time.time() + self.cfg.chord_seconds + float(self.rng.uniform(-2.0, 2.0))

            # bass + gentle kick on chord change
            _, ch = self.current_chord()
            bass = ch[0] - 24
            self.spawn_pluck(bass, amp=0.16, life=5.0, pan=float(self.rng.uniform(-0.15, 0.15)), bright=0.35, decay=0.997)
            self.kicks.append((Kick(self.cfg.sr, amp=0.9 * self.cfg.drum_level), self.now_s(), 0.22))

    def spawn_pluck(self, midi_note: int, amp: float, life: float, pan: float, bright: float, decay: float):
        freq = midi_to_hz(midi_note) * (1.0 + float(self.rng.uniform(-0.002, 0.002)))
        self.plucks.append((Pluck(self.cfg.sr, freq=freq, decay=decay, brightness=bright, pan=pan), self.now_s(), life))

    def spawn_bell(self, midi_note: int, amp: float, life: float, pan: float):
        freq = midi_to_hz(midi_note)
        self.bells.append((Bell(self.cfg.sr, freq=freq, amp=amp, pan=pan), self.now_s(), life))

    def sequence(self):
        t = self.now_s()

        # arpeggio
        if t >= self.next_arp_s:
            _, chord = self.current_chord()
            idx = self.arp_pattern[self.arp_step % len(self.arp_pattern)]
            note = chord[idx]

            # occasional octave / add 9th-ish
            if self.rng.random() < 0.18:
                note += 12
            if self.rng.random() < 0.08:
                note += 2

            amp = float(self.rng.uniform(0.10, 0.20)) * self.cfg.pluck_level
            pan = float(self.rng.uniform(-0.55, 0.55))
            bright = float(self.rng.uniform(0.45, 0.75))
            decay = float(self.rng.uniform(0.993, 0.998))
            self.spawn_pluck(note, amp=amp, life=6.0, pan=pan, bright=bright, decay=decay)

            self.arp_step += 1
            jitter = float(self.rng.uniform(-0.02, 0.02))
            self.next_arp_s = t + self.arp_interval + jitter

        # sparse bell accents
        if t >= self.next_bell_s and self.rng.random() < 0.45:
            _, chord = self.current_chord()
            note = int(self.rng.choice(chord)) + 12
            amp = float(self.rng.uniform(0.03, 0.07)) * self.cfg.bell_level
            pan = float(self.rng.uniform(-0.75, 0.75))
            self.spawn_bell(note, amp=amp, life=5.0, pan=pan)
            self.next_bell_s = t + float(self.rng.uniform(3.0, 7.0))
        elif t >= self.next_bell_s:
            self.next_bell_s = t + float(self.rng.uniform(2.5, 5.5))

        # gentle hats (not constant)
        if t >= self.next_hat_s and self.rng.random() < 0.55:
            self.hats.append((Hat(self.cfg.sr, amp=0.15 * self.cfg.drum_level), t, 0.08))
            self.next_hat_s = t + self.seconds_per_beat * float(self.rng.choice([0.5, 1.0, 1.5]))
        elif t >= self.next_hat_s:
            self.next_hat_s = t + self.seconds_per_beat * 0.5

        # occasional extra kick
        if t >= self.next_kick_s and self.rng.random() < 0.15:
            self.kicks.append((Kick(self.cfg.sr, amp=0.75 * self.cfg.drum_level), t, 0.22))
            self.next_kick_s = t + self.seconds_per_beat * float(self.rng.uniform(3.0, 6.0))

    def render_block(self, nframes: int) -> np.ndarray:
        self.maybe_advance_chord()
        self.sequence()

        t = self.now_s()

        # mix instruments
        L = np.zeros(nframes, dtype=np.float32)
        R = np.zeros(nframes, dtype=np.float32)

        # plucks
        alive = []
        for obj, start, life in self.plucks:
            if (t - start) < life:
                l, r = obj.render(nframes)
                L += l
                R += r
                alive.append((obj, start, life))
        self.plucks = alive

        # bells
        alive = []
        for obj, start, life in self.bells:
            if (t - start) < life:
                l, r = obj.render(nframes)
                L += l
                R += r
                alive.append((obj, start, life))
        self.bells = alive

        # drums
        alive = []
        for obj, start, life in self.kicks:
            if (t - start) < life:
                x = obj.render(nframes)
                L += x
                R += x
                alive.append((obj, start, life))
        self.kicks = alive

        alive = []
        for obj, start, life in self.hats:
            if (t - start) < life:
                x = obj.render(nframes)
                # slight stereo bias
                L += x * 0.85
                R += x * 0.95
                alive.append((obj, start, life))
        self.hats = alive

        # PAD: chord-root sine + filtered noise (very subtle)
        _, chord = self.current_chord()
        root = chord[0] - 12
        freq = midi_to_hz(root)

        # sine pad
        phase_inc = 2 * np.pi * freq / self.cfg.sr
        phases = self.pad_phase + phase_inc * np.arange(nframes, dtype=np.float32)
        sine = np.sin(phases).astype(np.float32)
        self.pad_phase = float(phases[-1] + phase_inc)
        self.pad_phase = float(self.pad_phase % (2 * np.pi))

        # noise bed (filtered)
        noise = (np.random.rand(nframes).astype(np.float32) * 2.0 - 1.0) * 0.25
        bed = self.pad_lp.process(noise)

        pad = (sine * 0.35 + bed) * self.cfg.pad_level

        # slow pad movement (tiny L/R difference)
        drift = float(0.02 + 0.02 * math.sin(2 * math.pi * (t / 18.0)))
        L += pad * (1.0 - drift)
        R += pad * (1.0 + drift)

        # gentle saturation (glue)
        L = np.tanh(L * 1.15)
        R = np.tanh(R * 1.15)

        # widen
        widen = self.cfg.widen
        if widen > 0:
            R = R + np.roll(L, 2) * widen

        # space
        L, R = self.verb.process(L, R)

        out = np.stack([L, R], axis=1) * self.cfg.master
        np.clip(out, -0.98, 0.98, out=out)
        return out

    def advance(self, nframes: int):
        self.frame_cursor += nframes

# -----------------------------
# Run
# -----------------------------
def main():
    cfg = EngineConfig(
        sr=48000,
        block=512,
        bpm=62.0,
        key="G",
        mode="maj",
        master=0.23,
        widen=0.20,
        chord_seconds=12.0,
        pluck_level=1.0,
        pad_level=0.35,
        bell_level=0.25,
        drum_level=0.32,
    )

    engine = AcousticBackground(cfg)

    def callback(outdata, frames, time_info, status):
        outdata[:] = engine.render_block(frames)
        engine.advance(frames)

    print("🎵 Playing nicer ambient background (Ctrl+C to stop)")
    with sd.OutputStream(
        samplerate=cfg.sr,
        blocksize=cfg.block,
        channels=2,
        dtype="float32",
        latency="low",
        callback=callback,
    ):
        try:
            while True:
                time.sleep(0.25)
        except KeyboardInterrupt:
            print("\nStopped.")

if __name__ == "__main__":
    main()
