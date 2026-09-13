/* =============================================================================
 * SLATE RENDERER
 * Demo films are "slates": procedurally drawn on a canvas from a seed, with
 * every frame a pure function of elapsed time. That means they stay in sync
 * across every browser in the theater for exactly the same reason a real video
 * does — the server says what `t` is, and `t` decides the picture.
 *
 * It also renders the title card that runs before every film, uploaded or not.
 * ========================================================================== */

const Slate = (() => {
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const fit = (c) => {
    const w = c.clientWidth || 960, h = c.clientHeight || 540;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    return { w: c.width, h: c.height };
  };

  function grain(ctx, w, h, t, alpha = 0.05) {
    const r = rng(Math.floor(t / 66) * 7919);
    ctx.globalAlpha = alpha;
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = r() > .5 ? '#fff' : '#000';
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* --- the title card before each film ---------------------------------- */
  function title(canvas, entry, tMs, theaterNumber) {
    const ctx = canvas.getContext('2d');
    const { w, h } = fit(canvas);
    const p = Math.min(1, tMs / (entry.slateMs || 3500));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);

    // Sweeping leader arc
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.strokeStyle = 'rgba(232,192,125,.28)';
    ctx.lineWidth = Math.max(1, h * 0.004);
    ctx.beginPath(); ctx.arc(0, 0, h * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.moveTo(0, -h); ctx.lineTo(0, h);
    ctx.strokeStyle = 'rgba(232,192,125,.08)'; ctx.stroke();
    ctx.restore();

    const fade = Math.min(1, p * 4) * (p > .93 ? (1 - p) / .07 : 1);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9c7f52';
    ctx.font = `${Math.round(h * 0.033)}px ui-monospace, monospace`;
    ctx.fillText(`THEATER #${theaterNumber}   ·   FILM ${entry.order}`, w / 2, h * 0.34);

    ctx.fillStyle = '#f4ece2';
    const size = Math.round(h * 0.085);
    ctx.font = `${size}px Georgia, serif`;
    wrap(ctx, entry.title, w / 2, h * 0.5, w * 0.84, size * 1.15);

    ctx.fillStyle = '#e8c07d';
    ctx.font = `${Math.round(h * 0.036)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(`a film by ${entry.by || 'anonymous'}`, w / 2, h * 0.68);
    ctx.globalAlpha = 1;
    grain(ctx, w, h, tMs, 0.045);
  }

  function wrap(ctx, text, cx, cy, maxW, lineH) {
    const words = String(text || '').split(/\s+/);
    const lines = []; let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    const start = cy - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, start + i * lineH));
  }

  /* --- the "film" itself ------------------------------------------------- */
  function film(canvas, entry, tMs) {
    const ctx = canvas.getContext('2d');
    const { w, h } = fit(canvas);
    const s = entry.slate || { palette: ['#140b10', '#c1121f', '#e8c07d'], motif: 'grain', seed: 1 };
    const [bg, mid, hi] = s.palette;
    const t = tMs / 1000;
    const dur = (entry.durationMs || 30000) / 1000;
    const prog = Math.min(1, tMs / (entry.durationMs || 30000));

    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const r = rng(s.seed);
    const seeds = Array.from({ length: 40 }, () => r());

    switch (s.motif) {
      case 'bars': {
        const n = 9;
        for (let i = 0; i < n; i++) {
          const ph = seeds[i] * 6.28;
          const y = (i / n) * h;
          const x = (Math.sin(t * (0.3 + seeds[i] * 0.5) + ph) * 0.5 + 0.5) * w;
          ctx.fillStyle = i % 2 ? mid : hi;
          ctx.globalAlpha = 0.28 + 0.4 * (i / n);
          ctx.fillRect(x - w * 0.3, y, w * 0.6, h / n * 0.72);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'iris': {
        const rad = (0.12 + 0.36 * (Math.sin(t * 0.5) * 0.5 + 0.5)) * h;
        const g = ctx.createRadialGradient(w / 2, h / 2, rad * 0.2, w / 2, h / 2, rad * 2.1);
        g.addColorStop(0, hi); g.addColorStop(0.45, mid); g.addColorStop(1, bg);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = h * 0.012;
        for (let i = 1; i < 7; i++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, rad * i * 0.45, 0, 6.29); ctx.stroke(); }
        break;
      }
      case 'scan': {
        for (let y = 0; y < h; y += Math.max(3, h / 90)) {
          const v = Math.sin(y * 0.03 + t * 2.2) * 0.5 + 0.5;
          ctx.fillStyle = v > 0.72 ? hi : mid;
          ctx.globalAlpha = 0.1 + v * 0.35;
          ctx.fillRect(0, y, w, Math.max(2, h / 160));
        }
        ctx.globalAlpha = 1;
        const bandY = ((t * 0.22) % 1) * h;
        ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(0, bandY, w, h * 0.1);
        break;
      }
      case 'orbit': {
        ctx.save(); ctx.translate(w / 2, h / 2);
        for (let i = 0; i < 26; i++) {
          const a = t * (0.25 + seeds[i] * 0.7) + seeds[i] * 6.28;
          const rad = (0.08 + seeds[i] * 0.42) * h;
          ctx.fillStyle = i % 3 ? mid : hi;
          ctx.globalAlpha = 0.35 + seeds[i] * 0.5;
          const size = (3 + seeds[i] * 16) * (h / 540);
          ctx.beginPath(); ctx.arc(Math.cos(a) * rad * 1.6, Math.sin(a) * rad, size, 0, 6.29); ctx.fill();
        }
        ctx.restore(); ctx.globalAlpha = 1;
        break;
      }
      case 'rain': {
        for (let i = 0; i < 70; i++) {
          const x = seeds[i % 40] * w + Math.sin(t * 0.3 + i) * 12;
          const speed = 120 + seeds[(i + 7) % 40] * 420;
          const y = ((t * speed + seeds[(i + 3) % 40] * h * 3) % (h * 1.2)) - h * 0.1;
          ctx.strokeStyle = i % 5 ? mid : hi;
          ctx.globalAlpha = 0.25 + seeds[i % 40] * 0.5;
          ctx.lineWidth = Math.max(1, h * 0.0035);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y + h * 0.06); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      default: {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, bg); g.addColorStop(0.5 + Math.sin(t * 0.4) * 0.2, mid); g.addColorStop(1, hi);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    }

    // Vignette + gate weave, so it reads as projected film.
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.72)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, tMs, 0.06);

    // Burned-in slug, so a demo film is never mistaken for a real upload.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(244,236,226,.5)';
    ctx.font = `${Math.round(h * 0.028)}px ui-monospace, monospace`;
    ctx.fillText(`${entry.title}`.toUpperCase().slice(0, 42), w * 0.045, h * 0.93);
    ctx.textAlign = 'right';
    ctx.fillText(`${(dur * prog).toFixed(1)}s / ${dur.toFixed(0)}s`, w * 0.955, h * 0.93);
    if (tMs < 900) { ctx.fillStyle = `rgba(0,0,0,${1 - tMs / 900})`; ctx.fillRect(0, 0, w, h); }
  }

  return { title, film, fit };
})();
