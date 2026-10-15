// A few small sounds, made on the spot with Web Audio — no files to load. OFF until the person turns
// them on (the button in the corner), and the audio context is made only then, inside their tap, as
// browsers require.

type Cue = "join" | "turn" | "tick" | "got" | "miss" | "win";

const NOTES: Record<Cue, Array<[freq: number, at: number, len: number]>> = {
  join: [[660, 0, 0.09], [880, 0.08, 0.12]],
  turn: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.16]],
  tick: [[1200, 0, 0.04]],
  got: [[784, 0, 0.1], [988, 0.09, 0.1], [1319, 0.18, 0.22]],
  miss: [[330, 0, 0.12], [262, 0.1, 0.18]],
  win: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.4]],
};

export class Sounds {
  on = false;
  private ac: AudioContext | null = null;

  /** Turn on or off. Turning on must happen inside a tap. */
  set(on: boolean): void {
    this.on = on;
    if (on && !this.ac) {
      const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ac = new AC();
    }
    if (on) void this.ac?.resume().catch(() => undefined);
  }

  play(cue: Cue): void {
    const ac = this.ac;
    if (!this.on || !ac || ac.state !== "running") return;
    const t0 = ac.currentTime + 0.01;
    for (const [freq, at, len] of NOTES[cue]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = cue === "tick" ? "square" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(cue === "tick" ? 0.05 : 0.16, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + len + 0.02);
    }
  }

  close(): void {
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
  }
}
