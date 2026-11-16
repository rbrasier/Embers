// Tiny synthesised sound set. Each call and each kind of warning has its own sound.

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* no audio available */ }
  }

  private tone(freq: number, dur: number, type: Wave = 'sine', vol = 0.12, at = 0, slideTo = 0) {
    const c = this.ctx;
    if (!c || this.muted) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name: string) {
    switch (name) {
      case 'interrupt': this.tone(880, 0.07, 'square', 0.1); this.tone(440, 0.1, 'square', 0.1, 0.06); break;
      case 'stack': this.tone(660, 0.12, 'triangle', 0.16); this.tone(440, 0.16, 'triangle', 0.16, 0.1); break;
      case 'spread': this.tone(440, 0.12, 'triangle', 0.16); this.tone(700, 0.16, 'triangle', 0.16, 0.1); break;
      case 'burst': this.tone(220, 0.35, 'sawtooth', 0.12, 0, 880); break;
      case 'focus': this.tone(990, 0.06, 'sine', 0.16); this.tone(990, 0.06, 'sine', 0.16, 0.1); break;
      case 'deny': this.tone(150, 0.12, 'square', 0.07); break;
      case 'cast': this.tone(520, 0.18, 'sawtooth', 0.07, 0, 640); break;
      case 'telegraph': this.tone(740, 0.14, 'square', 0.08); this.tone(740, 0.14, 'square', 0.08, 0.2); break;
      case 'interrupted': this.tone(1200, 0.05, 'square', 0.1); this.tone(300, 0.12, 'triangle', 0.14, 0.03); break;
      case 'fail': this.tone(200, 0.4, 'sawtooth', 0.12, 0, 90); break;
      case 'death': this.tone(300, 0.3, 'triangle', 0.12, 0, 110); break;
      case 'wipe': this.tone(260, 0.3, 'triangle', 0.14); this.tone(196, 0.3, 'triangle', 0.14, 0.25); this.tone(130, 0.6, 'triangle', 0.14, 0.5); break;
      case 'victory': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.15, i * 0.14)); break;
      case 'hit': this.tone(170, 0.04, 'square', 0.03); break;
    }
  }
}
