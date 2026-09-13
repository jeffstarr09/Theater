'use strict';
const crypto = require('crypto');

const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
const token = () => crypto.randomBytes(24).toString('base64url');

/* Pseudonyms. Everyone in the building is a stranger with a good name. */
const ADJ = ['Velvet', 'Midnight', 'Gilded', 'Crimson', 'Silent', 'Neon', 'Paper', 'Marble',
  'Smoke', 'Amber', 'Hollow', 'Lucky', 'Quiet', 'Second', 'Late', 'Broken', 'Golden', 'Salt',
  'Glass', 'Rust', 'Blue', 'Static', 'Ghost', 'Iron', 'Wandering', 'Patient', 'Sleepless'];
const NOUN = ['Usher', 'Projectionist', 'Balcony', 'Matinee', 'Reel', 'Marquee', 'Aisle',
  'Splice', 'Nitrate', 'Foley', 'Grip', 'Gaffer', 'Extra', 'Stagehand', 'Critic', 'Popcorn',
  'Curtain', 'Lantern', 'Vignette', 'Dissolve', 'Closeup', 'Kinescope', 'Patron', 'Understudy'];

function pseudonym(rng = Math.random) {
  const a = ADJ[Math.floor(rng() * ADJ.length)];
  const n = NOUN[Math.floor(rng() * NOUN.length)];
  const num = 2 + Math.floor(rng() * 97);
  return `${a} ${n} ${num}`;
}

/* Deterministic PRNG so a given theater always draws the same crowd. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { id, token, pseudonym, mulberry32 };
