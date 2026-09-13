'use strict';
/* Demo data, so the first screen is never an empty building:
 *   - two past theaters in the Hall of Fame, with full stats
 *   - a current theater already filling, with films and a crowd
 *   - a small reserve of House Selection shorts, used only as the
 *     never-be-stuck fallback for a guaranteed showtime with no submissions
 *   - a little recent traffic, so the House Manager has demand to measure  */

const { db, VIDEO_DIR } = require('./db');
const fs = require('fs');
const path = require('path');
const { createUser } = require('./auth');
const { makeFilm, makePatron, installDemoVideo, CHAT_LINES, rand } = require('./fixtures');
const { id, pseudonym } = require('./ids');
const HM = require('./houseManager');
const POLICY = require('./policy');

const MIN = 60000, HOUR = 3600000;

function wipe() {
  db.exec(`
    DELETE FROM reactions; DELETE FROM votes; DELETE FROM chat; DELETE FROM tickets;
    DELETE FROM films; DELETE FROM events; DELETE FROM theaters; DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('theaters','events');
  `);
  db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES('theaters', ?)")
    .run(Number(process.env.THEATER_START_NUMBER || 100));
  for (const f of fs.readdirSync(VIDEO_DIR)) {
    try { fs.unlinkSync(path.join(VIDEO_DIR, f)); } catch {}
  }
}

function isSeeded() {
  return db.prepare('SELECT COUNT(*) n FROM theaters').get().n > 0;
}

function pastTheater({ at, filmCount, tier, crowd, guaranteed = false, headline = null }) {
  const plan = { ...HM.planFor({ ticketsPerHour: 20, submissionsPerHour: 5, attendanceRate: 0.8, tier }, at) };
  plan.seats = Math.max(plan.seats, crowd);
  const info = db.prepare(`
    INSERT INTO theaters (state, created_at, plan_json, tier, doors_closed_at, showtime_at,
      started_at, ended_at, voting_ends_at, results_end_at, archived_at, guaranteed, last_progress_at)
    VALUES ('ARCHIVED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(at - 90 * MIN, JSON.stringify(plan), tier, at - 30 * MIN, at, at,
      at + 3 * MIN, at + 4 * MIN, at + 5 * MIN, at + 6 * MIN, guaranteed ? 1 : 0, at);
  const theaterId = Number(info.lastInsertRowid);

  // Filmmakers and their films.
  const films = [];
  for (let i = 0; i < filmCount; i++) {
    const maker = makePatron();
    // Film 0 of each past house is a real clip, so the Hall of Fame has
    // something that genuinely plays.
    const video = i === 0 && headline ? installDemoVideo(headline.file) : null;
    const film = makeFilm({
      userId: maker.id, theaterId, status: 'screened',
      title: video ? headline.title : undefined,
      blurb: video ? headline.blurb : undefined,
      video,
      durationMs: video ? headline.durationMs : Math.round((18 + Math.random() * 40) * 1000),
      createdAt: at - 80 * MIN + i * MIN, slotIndex: i,
    });
    db.prepare(`INSERT INTO tickets (id, theater_id, user_id, kind, source, seat_index, paid_cents, attended, created_at)
                VALUES (?,?,?,'FILMMAKER','purchase',?,0,1,?)`)
      .run(id('tkt'), theaterId, maker.id, i, at - 80 * MIN + i * MIN);
    films.push(film);
  }

  // Freeze the running order exactly as the House Manager would have.
  let cursor = 0;
  const entries = films.map((f, i) => {
    const e = {
      filmId: f.id, title: f.title, blurb: f.blurb,
      by: db.prepare('SELECT handle FROM users WHERE id = ?').get(f.user_id).handle,
      kind: f.kind, slate: f.slate_json ? JSON.parse(f.slate_json) : null, slateMs: POLICY.timing.slateMs,
      durationMs: f.duration_ms, startAt: cursor, endAt: cursor + POLICY.timing.slateMs + f.duration_ms, order: i + 1,
    };
    cursor = e.endAt;
    return e;
  });

  // The audience, their reactions and their ballots.
  const audience = [];
  for (let i = 0; i < crowd; i++) {
    const p = makePatron();
    audience.push(p);
    db.prepare(`INSERT INTO tickets (id, theater_id, user_id, kind, source, seat_index, paid_cents, attended, created_at)
                VALUES (?,?,?,'AUDIENCE','purchase',?,?,?,?)`)
      .run(id('tkt'), theaterId, p.id, filmCount + i, POLICY.tickets.audiencePriceCents,
        Math.random() < 0.85 ? 1 : 0, at - 60 * MIN + i * 1000);
  }

  // Give one film a clear edge so the Hall of Fame entry feels earned.
  const favourite = headline ? 0 : Math.floor(Math.random() * films.length);
  const voteTally = new Map();
  for (const p of audience) {
    const pick = Math.random() < 0.55 ? favourite : Math.floor(Math.random() * films.length);
    const film = films[pick];
    db.prepare('INSERT OR IGNORE INTO votes (theater_id, user_id, film_id, created_at) VALUES (?,?,?,?)')
      .run(theaterId, p.id, film.id, at + 3.5 * MIN);
    voteTally.set(film.id, (voteTally.get(film.id) || 0) + 1);
    const throws = Math.floor(Math.random() * 6);
    for (let r = 0; r < throws; r++) {
      const target = films[Math.floor(Math.random() * films.length)];
      const kind = target.id === films[favourite].id
        ? (Math.random() < 0.85 ? 'rose' : 'tomato')
        : (Math.random() < 0.55 ? 'rose' : 'tomato');
      db.prepare('INSERT INTO reactions (id, theater_id, film_id, user_id, kind, created_at) VALUES (?,?,?,?,?,?)')
        .run(id('rct'), theaterId, target.id, p.id, kind, at + Math.random() * 3 * MIN);
    }
  }

  let winner = films[favourite];
  let best = -1;
  for (const f of films) {
    const n = voteTally.get(f.id) || 0;
    if (n > best) { best = n; winner = f; }
  }

  db.prepare('UPDATE theaters SET reel_json = ?, winner_film_id = ? WHERE id = ?')
    .run(JSON.stringify({ entries, totalMs: cursor, slateMs: POLICY.timing.slateMs }), winner.id, theaterId);

  // A little chatter, preserved in the record.
  for (let i = 0; i < 14; i++) {
    const p = rand(audience);
    db.prepare(`INSERT INTO chat (id, theater_id, user_id, handle, body, phase, created_at)
                VALUES (?,?,?,?,?,'SHOWING',?)`)
      .run(id('msg'), theaterId, p.id, p.handle, rand(CHAT_LINES), at + i * 8000);
  }

  db.prepare('INSERT INTO events (type, theater_id, user_id, meta, created_at) VALUES (?,?,?,?,?)')
    .run('show', theaterId, null, JSON.stringify({ films: films.length }), at);

  return theaterId;
}

function seed({ force = false } = {}) {
  if (isSeeded() && !force) return { skipped: true };
  wipe();
  const now = Date.now();

  // Two theaters that already happened. Their winners live in the Hall of Fame;
  // everything else survives only as a line in the Necrology.
  pastTheater({
    at: now - 26 * HOUR, filmCount: 4, tier: 'NORMAL', crowd: 18,
    headline: {
      file: 'nightshift.webm', durationMs: 17960, title: 'The Night Shift',
      blurb: 'Everything that passes the window between two and four in the morning.',
    },
  });
  pastTheater({
    at: now - 5 * HOUR, filmCount: 3, tier: 'LOW', crowd: 11, guaranteed: true,
    headline: {
      file: 'laundromat.webm', durationMs: 16960, title: 'Spin Cycle',
      blurb: 'Ninety minutes at the laundromat, cut down to seventeen seconds.',
    },
  });

  // A house reserve: only ever screened when a guaranteed showtime arrives with
  // nothing in the programme, so the promise is never broken.
  const house = createUser({ handle: 'The House', isHouse: true });
  makeFilm({
    userId: house.id, theaterId: null, status: 'approved',
    title: 'House Selection: Leader Tape',
    blurb: 'From the house reserve. Screened only when nobody else brought a film.',
    video: installDemoVideo('leader.webm'), durationMs: 15950, createdAt: now - 3 * HOUR,
  });
  for (let i = 0; i < 2; i++) {
    makeFilm({
      userId: house.id, theaterId: null, status: 'approved',
      title: ['House Selection: The Projectionist Sleeps', 'House Selection: Countdown'][i],
      blurb: 'From the house reserve. Screened only when nobody else brought a film.',
      durationMs: 20000 + i * 4000, createdAt: now - 3 * HOUR + 1000 + i,
    });
  }

  // Tonight's theater, already alive: a couple of films and a small crowd,
  // deliberately short of the fill condition so you can watch it fill.
  const theater = HM.openTheater(now - 11 * MIN);
  db.prepare('UPDATE theaters SET created_at = ? WHERE id = ?').run(now - 11 * MIN, theater.id);
  for (let i = 0; i < 2; i++) {
    const maker = makePatron();
    makeFilm({ userId: maker.id, theaterId: theater.id, status: 'approved', createdAt: now - (9 - i * 3) * MIN });
    HM.grantTicket(theater.id, maker.id, 'FILMMAKER', 'purchase', 0);
  }
  for (let i = 0; i < 5; i++) {
    HM.grantTicket(theater.id, makePatron().id, 'AUDIENCE', 'purchase', POLICY.tickets.audiencePriceCents);
  }

  // One film waiting at the moderation desk, so /admin has something to do.
  const hopeful = makePatron();
  makeFilm({ userId: hopeful.id, theaterId: null, status: 'pending', createdAt: now - 4 * MIN });

  // Recent traffic, so the House Manager has a demand signal on boot.
  const ins = db.prepare('INSERT INTO events (type, theater_id, user_id, meta, created_at) VALUES (?,?,?,?,?)');
  for (let i = 0; i < 5; i++) ins.run('ticket', null, null, '{"seed":true}', now - Math.round(Math.random() * 70 * MIN));
  for (let i = 0; i < 2; i++) ins.run('submission', null, null, '{"seed":true}', now - Math.round(Math.random() * 70 * MIN));

  // Backdate the events the seeding itself generated, so the House Manager
  // wakes up reading a believable trickle of demand instead of a stampede.
  db.prepare("UPDATE events SET created_at = ? - ABS(RANDOM() % ?) WHERE created_at >= ? AND type IN ('ticket','submission')")
    .run(now, 50 * MIN, now - 5000);

  db.prepare('UPDATE theaters SET last_progress_at = ? WHERE id = ?').run(now - 30000, theater.id);
  return { theater: theater.id, skipped: false };
}

if (require.main === module) {
  const force = process.argv.includes('--force') || process.argv.includes('--wipe');
  const out = seed({ force });
  console.log(out.skipped ? 'Already seeded (pass --force to wipe and reseed).' : `Seeded. Now showing: Theater #${out.theater}`);
}

module.exports = { seed, wipe, isSeeded };
