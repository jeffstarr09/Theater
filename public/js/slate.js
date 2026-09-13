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

  function wrap(ctx, text, cx, cy, maxW, lineH, maxLines = 4) {
    const words = String(text || '').split(/\s+/);
    const lines = []; let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
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


  /* --- a poster for the frames out front ------------------------------- */
  const POSTER_PALETTES = [
    ['#1a0f1f', '#ff5d73', '#ffd166'], ['#06171c', '#2ec4b6', '#e8f7ee'],
    ['#1c1209', '#f4a261', '#e76f51'], ['#0b0f2b', '#8ecae6', '#ffb703'],
    ['#180a0a', '#d62828', '#fcbf49'], ['#10131a', '#c8b6ff', '#ffd6ff'],
    ['#0a1a12', '#95d5b2', '#f1faee'],
  ];
  const MOTIF_NAMES = ['grain', 'bars', 'iris', 'scan', 'orbit', 'rain'];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Uploaded films have no slate, so their poster art is derived from the id —
   * stable, and different for every film. */
  function artFor(film) {
    if (film.slate) return film.slate;
    const h = hash(film.filmId || film.id || film.title || 'x');
    return {
      palette: POSTER_PALETTES[h % POSTER_PALETTES.length],
      motif: MOTIF_NAMES[(h >> 5) % MOTIF_NAMES.length],
      seed: h,
    };
  }

  function poster(canvas, film, opts = {}) {
    const ctx = canvas.getContext('2d');
    const { w, h } = fit(canvas);
    const art = artFor(film);
    const [bg, mid, hi] = art.palette;
    const r = rng(art.seed);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    /* One bold composition, seeded — no motion, this is a printed sheet. */
    switch (art.motif) {
      case 'bars':
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = i % 2 ? mid : hi;
          ctx.globalAlpha = 0.25 + r() * 0.6;
          const y = h * (0.06 + i * 0.09);
          ctx.fillRect(w * (r() * 0.4 - 0.1), y, w * (0.5 + r() * 0.7), h * 0.045);
        }
        break;
      case 'iris': {
        const g = ctx.createRadialGradient(w / 2, h * 0.36, w * 0.04, w / 2, h * 0.36, w * 0.75);
        g.addColorStop(0, hi); g.addColorStop(0.4, mid); g.addColorStop(1, bg);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.72);
        ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = w * 0.02;
        for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.arc(w / 2, h * 0.36, w * i * 0.13, 0, 6.29); ctx.stroke(); }
        break;
      }
      case 'scan':
        for (let y = 0; y < h * 0.72; y += Math.max(2, h / 70)) {
          ctx.fillStyle = (y / h) % 0.18 < 0.09 ? mid : hi;
          ctx.globalAlpha = 0.12 + (y / h) * 0.7;
          ctx.fillRect(0, y, w, Math.max(1.5, h / 150));
        }
        break;
      case 'orbit':
        for (let i = 0; i < 18; i++) {
          ctx.fillStyle = i % 3 ? mid : hi;
          ctx.globalAlpha = 0.3 + r() * 0.6;
          ctx.beginPath();
          ctx.arc(w * r(), h * r() * 0.72, w * (0.02 + r() * 0.12), 0, 6.29);
          ctx.fill();
        }
        break;
      case 'rain':
        for (let i = 0; i < 46; i++) {
          ctx.strokeStyle = i % 4 ? mid : hi;
          ctx.globalAlpha = 0.25 + r() * 0.6;
          ctx.lineWidth = Math.max(1, w * 0.012);
          const x = w * r(), y = h * r() * 0.7;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.04, y + h * 0.09); ctx.stroke();
        }
        break;
      default: {
        const g = ctx.createLinearGradient(0, 0, w, h * 0.8);
        g.addColorStop(0, mid); g.addColorStop(1, bg);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.72);
        ctx.fillStyle = hi; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(w * 0.62, h * 0.26, w * 0.22, 0, 6.29); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    /* Type block. */
    const scrim = ctx.createLinearGradient(0, h * 0.48, 0, h);
    scrim.addColorStop(0, 'rgba(0,0,0,0)'); scrim.addColorStop(0.45, 'rgba(0,0,0,.88)'); scrim.addColorStop(1, '#000');
    ctx.fillStyle = scrim; ctx.fillRect(0, h * 0.48, w, h * 0.52);

    ctx.textAlign = 'center';
    const size = Math.max(9, Math.round(w * 0.115));
    ctx.font = `${size}px Georgia, serif`;
    ctx.fillStyle = '#f4ece2';
    wrap(ctx, film.title || 'Untitled', w / 2, h * 0.775, w * 0.86, size * 1.16, 3);
    ctx.font = `${Math.round(w * 0.058)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#e8c07d';
    ctx.fillText(`A FILM BY ${String(film.by || 'ANON').toUpperCase()}`.slice(0, 34), w / 2, h * 0.935);

    if (opts.order) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(244,236,226,.75)';
      ctx.font = `${Math.round(w * 0.055)}px ui-monospace, monospace`;
      ctx.fillText(`NO. ${String(opts.order).padStart(2, '0')}`, w * 0.06, h * 0.075);
    }
    if (opts.badge) {
      ctx.save();
      ctx.translate(w * 0.5, h * 0.3); ctx.rotate(-0.34);
      ctx.fillStyle = 'rgba(193,18,31,.92)';
      ctx.fillRect(-w * 0.62, -h * 0.035, w * 1.24, h * 0.07);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.font = `${Math.round(w * 0.06)}px ui-monospace, monospace`;
      ctx.fillText(opts.badge.toUpperCase(), 0, h * 0.018);
      ctx.restore();
    }
    grain(ctx, w, h, art.seed % 1000, 0.05);
  }

  return { title, film, poster, fit, artFor };
})();
