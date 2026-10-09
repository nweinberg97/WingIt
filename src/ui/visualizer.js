// Voice-reactive ring of bars drawn around the mic button. Reads analyser data only; keeps no audio.

export class VoiceRing {
  constructor(canvas, { bins = 48 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bins = bins;
    this.smooth = new Float32Array(bins);
    this.raf = null;
    this.source = null; // () => Float32Array | null
    this.mode = 'idle'; // idle | live | busy
    this.reduced = false;
    this.t0 = performance.now();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = this.canvas.clientWidth || 300;
    if (this.canvas.width !== Math.round(size * dpr)) {
      this.canvas.width = Math.round(size * dpr);
      this.canvas.height = Math.round(size * dpr);
    }
    this.dpr = dpr;
    this.size = size;
  }

  start(mode, source, { reduced = false } = {}) {
    this.mode = mode;
    this.source = source;
    this.reduced = reduced;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.smooth.fill(0);
    this.draw(new Float32Array(this.bins));
  }

  frame() {
    this.raf = null;
    const n = this.bins;
    let target = new Float32Array(n);
    const t = (performance.now() - this.t0) / 1000;
    if (this.mode === 'live') {
      const f = this.source?.();
      if (f && f.length === n) target = f;
      else {
        const lvl = typeof f === 'number' ? f : 0;
        for (let i = 0; i < n; i++) target[i] = lvl * (0.55 + 0.45 * Math.sin(i * 0.9 + t * 9));
      }
    } else if (this.mode === 'busy') {
      for (let i = 0; i < n; i++) target[i] = 0.25 + 0.25 * Math.max(0, Math.sin(i / 3 - t * 6));
    } else if (!this.reduced) {
      for (let i = 0; i < n; i++) target[i] = 0.08 + 0.06 * Math.sin(i / 2.5 + t * 1.6);
    } else {
      target.fill(0.08);
    }
    for (let i = 0; i < n; i++) {
      const k = target[i] > this.smooth[i] ? 0.5 : 0.15; // fast attack, slow release
      this.smooth[i] += (target[i] - this.smooth[i]) * k;
    }
    this.draw(this.smooth);
    if (!(this.reduced && this.mode === 'idle')) this.raf = requestAnimationFrame(() => this.frame());
  }

  draw(values) {
    this.resize();
    const { ctx, dpr, size } = this;
    const css = getComputedStyle(this.canvas);
    const color = css.getPropertyValue('--ring').trim() || '#ff5b35';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const inner = size * 0.3;
    const maxLen = size * 0.19;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, size * 0.016);
    const n = values.length;
    for (let i = 0; i < n; i++) {
      // mirror so the ring looks symmetric left/right
      const v = values[i < n / 2 ? i : n - 1 - i];
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const len = 4 + v * maxLen;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
      ctx.stroke();
    }
  }
}
