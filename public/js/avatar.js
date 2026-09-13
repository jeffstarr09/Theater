/* =============================================================================
 * AVATARS
 * A little figure for every person in the building. You get one the moment you
 * buy a ticket or drop a film in a poster frame; it walks you through the doors
 * and down the aisle to your seat.
 *
 * Everyone else in the house is a figure too — real patrons and ambient extras
 * alike, drawn identically so nobody can tell which is which (see seats.js).
 * ========================================================================== */

const Avatar = (() => {
  /* Deterministic look per person, so the same handle is always the same coat. */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  const COATS = ['#7d1f2e', '#2f4858', '#4a3f6b', '#1f4d3f', '#6b4423', '#5c2a4a',
    '#2b3a55', '#734b2a', '#3d5a4c', '#5a2f3d', '#40405c', '#663d2e'];
  const SKINS = ['#e8c9a8', '#c98f5f', '#8d5a3b', '#f0d6bb', '#6f4227', '#dba97e'];
  const HATS = ['#1a1216', '#2a1a20', null, null, '#3a2a1f', null];

  function look(key) {
    const h = hash(key);
    return {
      coat: COATS[h % COATS.length],
      skin: SKINS[(h >> 5) % SKINS.length],
      hat: HATS[(h >> 9) % HATS.length],
      lean: ((h >> 13) % 7) - 3,
    };
  }

  /** Build a standing figure. `key` decides its appearance. */
  function make(key, { you = false, scale = 1, label = null } = {}) {
    const l = look(key);
    const node = document.createElement('div');
    node.className = 'avatar' + (you ? ' you' : '');
    node.style.setProperty('--coat', l.coat);
    node.style.setProperty('--skin', l.skin);
    node.style.setProperty('--scale', scale);
    node.innerHTML =
      (l.hat ? `<i class="hat" style="background:${l.hat}"></i>` : '') +
      (you ? '<i class="halo"></i>' : '') +
      '<i class="head"></i><i class="body"></i>' +
      '<i class="leg l"></i><i class="leg r"></i>';
    if (label) {
      const tag = document.createElement('b');
      tag.className = 'avatar-label';
      tag.textContent = label;
      node.appendChild(tag);
    }
    node.title = you ? 'You' : '';
    return node;
  }

  /** Just the head and shoulders, for someone sitting in a seat. */
  function seated(key, you = false) {
    const l = look(key);
    const node = document.createElement('i');
    node.className = 'sitter' + (you ? ' you' : '');
    node.style.setProperty('--coat', you ? 'var(--gold)' : l.coat);
    node.style.setProperty('--skin', you ? '#fff3d8' : l.skin);
    return node;
  }

  /**
   * Walk a figure from one point to another, in px, inside its offset parent.
   * Resolves when it arrives. Purely cosmetic — nothing waits on it but the eye.
   */
  function walk(node, from, to, { duration = 1400, faceOnly = false } = {}) {
    return new Promise((resolve) => {
      const dx = to.x - from.x, dy = (to.y ?? from.y) - from.y;
      node.style.left = `${from.x}px`;
      node.style.top = `${from.y}px`;
      node.classList.add('walking');
      node.classList.toggle('mirrored', dx < 0);
      const anim = node.animate(
        [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px, ${dy}px)` }],
        { duration, easing: faceOnly ? 'linear' : 'cubic-bezier(.4,0,.5,1)', fill: 'forwards' },
      );
      anim.onfinish = () => {
        node.classList.remove('walking');
        resolve();
      };
    });
  }

  /** A handful of people loitering on the sidewalk, drifting back and forth. */
  function loiterers(seed, count, bounds) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const key = `${seed}:${i}`;
      const h = hash(key);
      const node = make(key, { scale: 0.82 + ((h >> 3) % 30) / 100 });
      node.classList.add('loiterer');
      // Two loose clusters, so nobody is standing on top of you in the middle.
      const span = bounds.x1 - bounds.x0;
      const t = (h % 1000) / 1000;
      const x = i % 2 === 0
        ? bounds.x0 + t * span * 0.34
        : bounds.x0 + span * 0.62 + t * span * 0.3;
      node.style.left = `${x}px`;
      node.style.bottom = `${30 + ((h >> 7) % 10)}px`;
      node.style.setProperty('--drift', `${8 + (h % 22)}px`);
      node.style.setProperty('--dur', `${7 + (h % 9)}s`);
      node.style.setProperty('--delay', `${-((h >> 11) % 9)}s`);
      out.push(node);
    }
    return out;
  }

  return { make, seated, walk, loiterers, look, hash };
})();
