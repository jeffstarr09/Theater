/* =============================================================================
 * AVATARS
 * The experience is first person, so the only figures drawn are the backs of
 * heads on the seating chart. Real patrons and ambient extras are drawn
 * identically; only your own seat is gold, so nobody can count the real ones.
 * ========================================================================== */

const Avatar = (() => {
  const ROWS = 6;

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

  /** Head and shoulders for the seat map. */
  function seated(key, you = false) {
    const l = look(key);
    const node = document.createElement('i');
    node.className = 'sitter' + (you ? ' you' : '');
    node.style.setProperty('--coat', you ? 'var(--gold)' : l.coat);
    node.style.setProperty('--skin', you ? '#fff3d8' : l.skin);
    return node;
  }

  return { seated, look, hash };
})();
