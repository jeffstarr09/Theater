/* =============================================================================
 * AVATARS — sprite edition
 * Every person in the building is a small walking figure cut from a licensed
 * Adobe Stock walk cycle (7 frames), recoloured into six coats at build time
 * (see public/art/walk_sheet.png). The sheet faces left; a figure moving
 * right is mirrored.
 *
 * Real patrons and ambient extras are drawn identically; only you get a glow
 * and a label, so nobody can count the real ones.
 * ========================================================================== */

const Avatar = (() => {
  const ROWS = 6;   // coats in the sheet: blue, red, gold, green, violet, cream

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function look(key) {
    const h = hash(key);
    return { row: h % ROWS, coat: ['#3b8fd9', '#c1121f', '#e8c07d', '#3f9c62', '#7b4fb8', '#e6e1d8'][h % ROWS],
      skin: ['#e8c9a8', '#c98f5f', '#8d5a3b', '#f0d6bb', '#6f4227', '#dba97e'][(h >> 5) % 6] };
  }

  /** A standing figure. `scale` is relative to the 49×100 sprite frame. */
  function make(key, { you = false, scale = 0.7, label = null, row = null } = {}) {
    const l = look(key);
    const node = document.createElement('div');
    node.className = 'avatar' + (you ? ' you' : '');
    node.style.setProperty('--row', row ?? (you ? 2 : l.row));   // you wear the gold coat
    node.style.setProperty('--scale', scale);
    node.innerHTML = (you ? '<i class="halo"></i>' : '') + '<i class="sprite"></i>';
    if (label) {
      const tag = document.createElement('b');
      tag.className = 'avatar-label';
      tag.textContent = label;
      node.appendChild(tag);
    }
    return node;
  }

  /** Head and shoulders for the seat map. */
  function seated(key, you = false) {
    const l = look(key);
    const node = document.createElement('i');
    node.className = 'sitter' + (you ? ' you' : '');
    node.style.setProperty('--coat', you ? 'var(--gold)' : l.coat);
    node.style.setProperty('--skin', you ? '#fff3d8' : l.skin);
    return node;
  }

  /** Walk from one point to another (px, in the offset parent). Resolves on arrival. */
  function walk(node, from, to, { duration = 1400 } = {}) {
    return new Promise((resolve) => {
      const dx = to.x - from.x, dy = (to.y ?? from.y) - from.y;
      node.style.left = `${from.x}px`;
      if (from.y != null && to.y != null) node.style.top = `${from.y}px`;
      node.classList.add('walking');
      node.classList.toggle('facing-right', dx > 0);
      const anim = node.animate(
        [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px, ${dy}px)` }],
        { duration, easing: 'linear', fill: 'forwards' },
      );
      anim.onfinish = () => { node.classList.remove('walking'); resolve(); };
    });
  }

  /** People loitering on the pavement, in two loose clusters either side of you. */
  function loiterers(seed, count, bounds) {
    const out = [];
    const span = bounds.x1 - bounds.x0;
    for (let i = 0; i < count; i++) {
      const key = `${seed}:${i}`;
      const h = hash(key);
      const node = make(key, { scale: 0.62 + ((h >> 3) % 20) / 100 });
      node.classList.add('loiterer');
      if (h & 1) node.classList.add('facing-right');
      const t = (h % 1000) / 1000;
      const x = i % 2 === 0 ? bounds.x0 + t * span * 0.3 : bounds.x0 + span * 0.64 + t * span * 0.3;
      node.style.left = `${x}px`;
      node.style.bottom = `${18 + ((h >> 7) % 10)}px`;
      node.style.setProperty('--drift', `${8 + (h % 22)}px`);
      node.style.setProperty('--dur', `${7 + (h % 9)}s`);
      node.style.setProperty('--delay', `${-((h >> 11) % 9)}s`);
      out.push(node);
    }
    return out;
  }

  return { make, seated, walk, loiterers, look, hash };
})();
