'use strict';
/* Demo material: fake patrons, fake films and the procedurally-rendered
 * "slate" shorts that stand in for uploaded video. A slate film is a real
 * timed entry in the reel — it just renders on a canvas instead of decoding an
 * mp4, so the synced-screening loop can be demoed on any machine with no
 * sample media and no ffmpeg. */

const fsp = require('fs');
const path = require('path');
const { db, VIDEO_DIR } = require('./db');
const { id, pseudonym, mulberry32 } = require('./ids');
const { createUser } = require('./auth');

const TITLE_A = ['The Last', 'Notes on', 'Portrait of', 'Seventeen', 'A Study in', 'Concerning',
  'Elegy for', 'Instructions for', 'Four Minutes of', 'The Weight of', 'Dispatch from', 'How to Leave'];
const TITLE_B = ['Laundromat', 'Tuesday', 'My Father’s Hands', 'Orange Light', 'the Long Drive',
  'a Burning House', 'Small Animals', 'the Night Shift', 'Static', 'Somebody Else’s Wedding',
  'the Sea, Briefly', 'Every Door I Have Closed', 'the Bus Station', 'Rain on Concrete'];

const BLURBS = [
  'Shot on a phone in one take, at the hour when nobody is awake.',
  'A love letter with the address torn off.',
  'Sixty seconds, one room, no forgiveness.',
  'Found footage from a camera nobody claimed.',
  'It is about a dog. It is not about a dog.',
  'The sound was recorded in a stairwell, which is the point.',
  'Made in a week, on purpose.',
  'An argument, filmed from the wrong side of the door.',
];

const PALETTES = [
  ['#1a0f1f', '#ff2fa0', '#ffe02f'],
  ['#06171c', '#2fd6ff', '#e8f7ee'],
  ['#1c1209', '#ff7a2f', '#ffd166'],
  ['#0b0f2b', '#7b2fff', '#2fd6ff'],
  ['#180a0a', '#ff2f6d', '#fcbf49'],
  ['#10131a', '#c8b6ff', '#ff6fb7'],
  ['#0a1a12', '#2fff9a', '#f1faee'],
];
const MOTIFS = ['kaleido', 'bars', 'iris', 'scan', 'orbit', 'rain', 'kaleido'];

const CHAT_LINES = [
  'first', 'the house lights are down', 'oh this is going to be good', 'who brought roses',
  'i have tomatoes and no restraint', 'SOUND DESIGN', 'that cut. THAT CUT.', 'is this the one from #98?',
  'i love this stupid theater', 'my hands are shaking and i am not even in it',
  'somebody get this person a budget', 'ok the framing though', 'chills',
  'this is why i keep buying tickets', 'RIP anyone who missed this', 'one time only baby',
];

function rand(arr, rng = Math.random) { return arr[Math.floor(rng() * arr.length)]; }

function makeTitle(rng = Math.random) {
  return `${rand(TITLE_A, rng)} ${rand(TITLE_B, rng)}`;
}

function makeSlate(seed) {
  const rng = mulberry32(seed);
  return {
    palette: rand(PALETTES, rng),
    motif: rand(MOTIFS, rng),
    seed: Math.floor(rng() * 1e9),
  };
}

/* Real demo clips live in assets/demo and are copied into the video store on
 * seed, so the seeded house exercises the actual <video> playback path and not
 * only the procedural slates. */
const DEMO_DIR = path.join(__dirname, '..', 'assets', 'demo');

function installDemoVideo(name) {
  const src = path.join(DEMO_DIR, name);
  if (!fsp.existsSync(src)) return null;
  const filename = `${id('vid')}.webm`;
  fsp.copyFileSync(src, path.join(VIDEO_DIR, filename));
  return { filename, mime: 'video/webm', sizeBytes: fsp.statSync(src).size };
}

/** Create a pseudonymous demo patron. */
function makePatron(rng = Math.random) {
  return createUser({ handle: pseudonym(rng) });
}

/**
 * Create a procedurally-rendered demo film.
 * @param {object} opts { userId, theaterId, status, durationMs, title }
 */
function makeFilm(opts = {}) {
  const rng = opts.rng || Math.random;
  const seed = Math.floor(rng() * 1e9);
  const video = opts.video || null;
  const film = {
    id: id('flm'),
    theater_id: opts.theaterId ?? null,
    user_id: opts.userId,
    title: opts.title || makeTitle(rng),
    blurb: opts.blurb || rand(BLURBS, rng),
    filename: video ? video.filename : null,
    mime: video ? video.mime : null,
    kind: video ? 'upload' : 'slate',
    slate_json: video ? null : JSON.stringify(makeSlate(seed)),
    duration_ms: opts.durationMs || Math.round((15 + rng() * 45) * 1000),
    size_bytes: video ? video.sizeBytes : 0,
    status: opts.status || 'approved',
    reject_reason: null,
    slot_index: opts.slotIndex ?? null,
    created_at: opts.createdAt || Date.now(),
    reviewed_at: opts.status === 'pending' ? null : (opts.createdAt || Date.now()),
  };
  db.prepare(`INSERT INTO films (id, theater_id, user_id, title, blurb, filename, mime, kind, slate_json,
      duration_ms, size_bytes, status, reject_reason, slot_index, created_at, reviewed_at)
    VALUES (@id,@theater_id,@user_id,@title,@blurb,@filename,@mime,@kind,@slate_json,
      @duration_ms,@size_bytes,@status,@reject_reason,@slot_index,@created_at,@reviewed_at)`).run(film);
  return film;
}

module.exports = { makeTitle, makeSlate, makePatron, makeFilm, installDemoVideo, CHAT_LINES, BLURBS, rand };
