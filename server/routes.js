'use strict';
/* All HTTP endpoints: tickets (stub checkout), submissions, media serving with
 * one-time-only access rules, the Hall of Fame / Necrology records, profiles,
 * the moderation desk and the DEV panel. */

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const POLICY = require('./policy');
const { db, VIDEO_DIR } = require('./db');
const { id } = require('./ids');
const HM = require('./houseManager');
const { publicState } = require('./state');
const { makeFilm, makePatron, CHAT_LINES, rand } = require('./fixtures');

const ADMIN_KEY = process.env.ADMIN_KEY || 'popcorn';
const DEV_ENABLED = process.env.THEATER_DEV !== 'off';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEO_DIR),
    filename: (req, file, cb) => {
      const ext = (file.mimetype === 'video/webm') ? '.webm' : '.mp4';
      cb(null, `${id('vid')}${ext}`);
    },
  }),
  limits: { fileSize: POLICY.submissions.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!POLICY.submissions.acceptMime.includes(file.mimetype)) {
      return cb(new Error('Only mp4 and webm are accepted at this box office.'));
    }
    cb(null, true);
  },
});

const router = express.Router();
const bad = (res, code, msg) => res.status(code).json({ error: msg });

/* ===========================================================================
 * STATE
 * ========================================================================= */
router.get('/api/state', (req, res) => {
  res.json(publicState(req.user.id));
});

router.get('/api/chat', (req, res) => {
  const th = HM.currentTheater();
  if (!th) return res.json({ messages: [] });
  const rows = db.prepare(
    'SELECT id, handle, body, created_at, user_id FROM chat WHERE theater_id = ? ORDER BY created_at DESC LIMIT 80'
  ).all(th.id).reverse();
  res.json({ messages: rows.map((r) => ({ id: r.id, handle: r.handle, body: r.body, at: r.created_at, userId: r.user_id })) });
});

/* ===========================================================================
 * TICKETS — payments are stubbed. Nothing is charged, nothing is stored.
 * ========================================================================= */
router.post('/api/tickets/audience', (req, res) => {
  const th = HM.ensureTheater();
  if (!['FILLING', 'OPEN_CALL'].includes(th.state)) {
    return bad(res, 409, 'The doors on this one are already closed. Hold for the next house.');
  }
  const existing = db.prepare('SELECT * FROM tickets WHERE theater_id = ? AND user_id = ?').get(th.id, req.user.id);
  if (existing) return res.json({ ok: true, already: true, ticket: existing });

  // ---- STUB CHECKOUT --------------------------------------------------
  // A real integration would create a payment intent here and only issue the
  // ticket on webhook confirmation. We accept any card-shaped input.
  const card = String(req.body?.card || '').replace(/\s+/g, '');
  if (card && card.length < 12) return bad(res, 402, 'That card was declined by our imaginary bank.');
  // ---------------------------------------------------------------------

  const ticket = HM.grantTicket(th.id, req.user.id, 'AUDIENCE', 'purchase', POLICY.tickets.audiencePriceCents);
  res.json({
    ok: true, ticket,
    receipt: { cents: POLICY.tickets.audiencePriceCents, stub: true, ref: id('rcpt') },
  });
});

/* ===========================================================================
 * SUBMISSIONS
 * ========================================================================= */
router.post('/api/films', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) return bad(res, 400, err.message);
    try {
      const th = HM.ensureTheater();
      const file = req.file;
      if (!file) return bad(res, 400, 'No video attached.');

      const durationMs = Math.round(Number(req.body.durationMs || 0));
      const secs = durationMs / 1000;
      const { minDurationSec, maxDurationSec } = POLICY.submissions;
      const cleanup = () => { try { fs.unlinkSync(file.path); } catch {} };

      if (!durationMs || secs < minDurationSec - 0.5 || secs > maxDurationSec + 0.5) {
        cleanup();
        return bad(res, 400, `Films must run ${minDurationSec}–${maxDurationSec} seconds. Yours ran ${secs ? secs.toFixed(1) : '?'}s.`);
      }
      const title = String(req.body.title || '').trim().slice(0, 80);
      if (!title) { cleanup(); return bad(res, 400, 'Give it a title.'); }

      const openSlot = HM.approvedFilms(th.id).length < JSON.parse(th.plan_json).filmSlots;
      const film = {
        id: id('flm'),
        theater_id: openSlot && ['FILLING', 'OPEN_CALL'].includes(th.state) ? th.id : null,
        user_id: req.user.id,
        title,
        blurb: String(req.body.blurb || '').trim().slice(0, 200) || null,
        filename: path.basename(file.path),
        mime: file.mimetype,
        kind: 'upload',
        slate_json: null,
        duration_ms: durationMs,
        size_bytes: file.size,
        status: 'pending',
        reject_reason: null,
        slot_index: null,
        created_at: Date.now(),
        reviewed_at: null,
      };
      db.prepare(`INSERT INTO films (id, theater_id, user_id, title, blurb, filename, mime, kind, slate_json,
          duration_ms, size_bytes, status, reject_reason, slot_index, created_at, reviewed_at)
        VALUES (@id,@theater_id,@user_id,@title,@blurb,@filename,@mime,@kind,@slate_json,
          @duration_ms,@size_bytes,@status,@reject_reason,@slot_index,@created_at,@reviewed_at)`).run(film);

      HM.logEvent('submission', film.theater_id, req.user.id, { filmId: film.id });
      // A filmmaker holds a seat from the moment they submit.
      if (['FILLING', 'OPEN_CALL'].includes(th.state)) {
        HM.grantTicket(th.id, req.user.id, 'FILMMAKER', 'purchase', 0);
      }
      HM.hub.emit('theater:changed', th.id);
      res.json({ ok: true, film: { id: film.id, title: film.title, status: film.status } });
    } catch (e) {
      console.error(e);
      bad(res, 500, 'The projectionist dropped it. Try again.');
    }
  });
});

router.get('/api/films/mine', (req, res) => {
  const rows = db.prepare(
    `SELECT id, title, status, reject_reason, theater_id, created_at, duration_ms FROM films
     WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ films: rows });
});

/* ===========================================================================
 * MEDIA — one time only.
 * A film is viewable while it is on screen tonight, or forever if it won.
 * Everything else is gone; only its record survives.
 * ========================================================================= */
function canView(film, req) {
  if (!film) return false;
  if (req.headers['x-admin-key'] === ADMIN_KEY || req.query.key === ADMIN_KEY) return true;

  const winner = db.prepare('SELECT id FROM theaters WHERE winner_film_id = ?').get(film.id);
  if (winner) return true;                                  // Hall of Fame, forever

  if (film.theater_id) {
    const th = db.prepare('SELECT state FROM theaters WHERE id = ?').get(film.theater_id);
    if (th && ['SHOWING', 'VOTING'].includes(th.state)) return true;   // on screen now
  }
  // Filmmakers may check their own print before it screens, never after.
  if (film.user_id === req.user.id && ['pending', 'approved', 'rejected'].includes(film.status)) return true;
  return false;
}

router.get('/media/film/:id', (req, res) => {
  const film = db.prepare('SELECT * FROM films WHERE id = ?').get(req.params.id);
  if (!canView(film, req)) {
    return res.status(403).json({ error: 'That print has been struck. One time only.' });
  }
  if (film.kind !== 'upload' || !film.filename) {
    return res.status(404).json({ error: 'This entry screens from a slate, not a file.' });
  }
  const file = path.join(VIDEO_DIR, film.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Reel missing.' });

  const size = fs.statSync(file).size;
  const range = req.headers.range;
  const type = film.mime || 'video/mp4';
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    res.status(206).set({
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': type,
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.set({ 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
});

/* ===========================================================================
 * THE RECORD — Hall of Fame + Necrology
 * ========================================================================= */
function theaterRecord(th) {
  const reel = th.reel_json ? JSON.parse(th.reel_json) : { entries: [] };
  const films = reel.entries.map((e) => {
    const roses = db.prepare("SELECT COUNT(*) n FROM reactions WHERE film_id = ? AND kind='rose'").get(e.filmId).n;
    const tomatoes = db.prepare("SELECT COUNT(*) n FROM reactions WHERE film_id = ? AND kind='tomato'").get(e.filmId).n;
    const votes = db.prepare('SELECT COUNT(*) n FROM votes WHERE film_id = ?').get(e.filmId).n;
    return {
      filmId: e.filmId, title: e.title, by: e.by, order: e.order,
      durationMs: e.durationMs, roses, tomatoes, votes,
      kind: e.kind, slate: e.slate, slateMs: e.slateMs,
      winner: e.filmId === th.winner_film_id,
    };
  });
  const winner = films.find((f) => f.winner) || null;
  return {
    number: th.id,
    state: th.state,
    guaranteed: !!th.guaranteed,
    screenedAt: th.started_at,
    archivedAt: th.archived_at,
    tier: th.tier,
    films,
    winner,
    totals: {
      roses: films.reduce((a, f) => a + f.roses, 0),
      tomatoes: films.reduce((a, f) => a + f.tomatoes, 0),
      votes: films.reduce((a, f) => a + f.votes, 0),
      films: films.length,
    },
  };
}

router.get('/api/hall', (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM theaters WHERE state = 'ARCHIVED' ORDER BY id DESC LIMIT 100").all();
  const records = rows.map(theaterRecord);
  res.json({
    hallOfFame: records.filter((r) => r.winner).map((r) => ({
      ...r.winner, number: r.number, screenedAt: r.screenedAt,
      src: `/media/film/${r.winner.filmId}`,
      totals: r.totals,
    })),
    necrology: records,
  });
});

router.get('/api/theaters/:id', (req, res) => {
  const th = db.prepare('SELECT * FROM theaters WHERE id = ?').get(req.params.id);
  if (!th) return bad(res, 404, 'No such house.');
  res.json(theaterRecord(th));
});

/* Encore — placeholder only. Deliberately does nothing. */
router.post('/api/encore/:id', (req, res) => {
  res.status(501).json({
    ok: false, stub: true,
    priceCents: POLICY.tickets.encorePriceCents,
    message: 'Encores are not yet on sale. The projectionist is thinking about it.',
  });
});

/* ===========================================================================
 * PROFILES — pseudonymous
 * ========================================================================= */
function profileFor(userId) {
  const user = db.prepare('SELECT id, handle, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const stubs = db.prepare(`
    SELECT t.theater_id AS number, t.kind, t.created_at, t.attended, th.state, th.started_at, th.winner_film_id
    FROM tickets t JOIN theaters th ON th.id = t.theater_id
    WHERE t.user_id = ? ORDER BY t.theater_id DESC LIMIT 60`).all(userId);
  const films = db.prepare(`
    SELECT id, title, status, theater_id, created_at, duration_ms FROM films
    WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  const wins = db.prepare(`
    SELECT th.id AS number, f.id AS filmId, f.title, th.started_at
    FROM theaters th JOIN films f ON f.id = th.winner_film_id
    WHERE f.user_id = ? ORDER BY th.id DESC`).all(userId);
  const votes = db.prepare('SELECT COUNT(*) n FROM votes WHERE user_id = ?').get(userId).n;
  const roses = db.prepare("SELECT COUNT(*) n FROM reactions WHERE user_id = ? AND kind='rose'").get(userId).n;
  const tomatoes = db.prepare("SELECT COUNT(*) n FROM reactions WHERE user_id = ? AND kind='tomato'").get(userId).n;
  return { user, stubs, films, wins, votesCast: votes, thrown: { roses, tomatoes } };
}

router.get('/api/me', (req, res) => res.json(profileFor(req.user.id)));

router.post('/api/me', (req, res) => {
  const handle = String(req.body?.handle || '').trim().slice(0, 32);
  if (handle) db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, req.user.id);
  res.json(profileFor(req.user.id));
});

router.get('/api/profile/:id', (req, res) => {
  const p = profileFor(req.params.id);
  if (!p) return bad(res, 404, 'Nobody by that name.');
  res.json(p);
});

/* ===========================================================================
 * MODERATION DESK
 * ========================================================================= */
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return bad(res, 401, 'Staff only.');
  next();
}

router.get('/api/admin/queue', requireAdmin, (req, res) => {
  const pending = db.prepare(`
    SELECT f.*, u.handle FROM films f JOIN users u ON u.id = f.user_id
    WHERE f.status = 'pending' ORDER BY f.created_at ASC`).all();
  const recent = db.prepare(`
    SELECT f.*, u.handle FROM films f JOIN users u ON u.id = f.user_id
    WHERE f.status IN ('approved','rejected') ORDER BY f.reviewed_at DESC LIMIT 25`).all();
  res.json({
    pending: pending.map((f) => ({
      id: f.id, title: f.title, blurb: f.blurb, by: f.handle, userId: f.user_id,
      durationMs: f.duration_ms, sizeBytes: f.size_bytes, kind: f.kind,
      src: f.kind === 'upload' ? `/media/film/${f.id}?key=${encodeURIComponent(ADMIN_KEY)}` : null,
      slate: f.slate_json ? JSON.parse(f.slate_json) : null,
      createdAt: f.created_at, theaterId: f.theater_id,
    })),
    recent: recent.map((f) => ({
      id: f.id, title: f.title, by: f.handle, status: f.status,
      reason: f.reject_reason, reviewedAt: f.reviewed_at,
    })),
    house: HM.status(),
  });
});

router.post('/api/admin/films/:id/approve', requireAdmin, (req, res) => {
  const film = db.prepare('SELECT * FROM films WHERE id = ?').get(req.params.id);
  if (!film) return bad(res, 404, 'No such film.');
  const th = HM.ensureTheater();
  const canJoin = ['FILLING', 'OPEN_CALL'].includes(th.state)
    && HM.approvedFilms(th.id).length < JSON.parse(th.plan_json).filmSlots;
  db.prepare("UPDATE films SET status='approved', reviewed_at=?, theater_id=? WHERE id=?")
    .run(Date.now(), canJoin ? th.id : null, film.id);
  if (canJoin) {
    HM.grantTicket(th.id, film.user_id, 'FILMMAKER', 'purchase', 0);
    HM.markProgress(th.id);
  }
  HM.hub.emit('theater:changed', th.id);
  res.json({ ok: true, placed: canJoin ? th.id : null });
});

router.post('/api/admin/films/:id/reject', requireAdmin, (req, res) => {
  const film = db.prepare('SELECT * FROM films WHERE id = ?').get(req.params.id);
  if (!film) return bad(res, 404, 'No such film.');
  const reason = String(req.body?.reason || '').trim().slice(0, 200) || 'Not for this house.';
  db.prepare("UPDATE films SET status='rejected', reject_reason=?, reviewed_at=?, theater_id=NULL WHERE id=?")
    .run(reason, Date.now(), film.id);
  // The promise: a rejected filmmaker walks straight into the next house.
  if (POLICY.tickets.compRejectedFilmmakers) {
    const th = HM.ensureTheater();
    HM.grantTicket(th.id, film.user_id, 'AUDIENCE', 'comp_rejected', 0);
  }
  HM.hub.emit('theater:changed', null);
  res.json({ ok: true, comped: POLICY.tickets.compRejectedFilmmakers });
});

router.get('/api/admin/house', requireAdmin, (req, res) => res.json(HM.status()));

/* ===========================================================================
 * DEV PANEL — force state transitions so the whole loop demos in two minutes.
 * ========================================================================= */
function requireDev(req, res, next) {
  if (!DEV_ENABLED) return bad(res, 404, 'Dev tools are off.');
  next();
}

router.get('/api/dev/status', requireDev, (req, res) => {
  res.json({ ...HM.status(), devEnabled: true, adminKey: ADMIN_KEY });
});

/** Fill the current theater: enough fake films and fake patrons to trip the
 *  House Manager's own fill condition on the next tick. */
router.post('/api/dev/fill', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (!['FILLING', 'OPEN_CALL'].includes(th.state)) return bad(res, 409, `Theater is ${th.state}.`);
  const req_ = HM.requirements(th);
  const films = HM.approvedFilms(th.id);
  let addedFilms = 0;
  for (let i = films.length; i < Math.max(req_.minFilms, Math.min(3, req_.plan.filmSlots)); i++) {
    const patron = makePatron();
    makeFilm({ userId: patron.id, theaterId: th.id, status: 'approved', durationMs: 15000 + Math.round(Math.random() * 20000) });
    HM.grantTicket(th.id, patron.id, 'FILMMAKER', 'house', 0);
    addedFilms++;
  }
  const have = db.prepare('SELECT COUNT(*) n FROM tickets WHERE theater_id = ?').get(th.id).n;
  let addedSeats = 0;
  for (let i = have; i < req_.seatsNeeded; i++) {
    HM.grantTicket(th.id, makePatron().id, 'AUDIENCE', 'house', POLICY.tickets.audiencePriceCents);
    addedSeats++;
  }
  HM.markProgress(th.id);
  res.json({ ok: true, addedFilms, addedSeats, note: 'House Manager will close the doors on its next tick.' });
});

/** Close the doors right now, with a countdown you choose. */
router.post('/api/dev/close-doors', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (!['FILLING', 'OPEN_CALL'].includes(th.state)) return bad(res, 409, `Theater is ${th.state}.`);
  if (HM.approvedFilms(th.id).length === 0) HM.drawFromReserve(th, { includeHouse: true });
  if (HM.approvedFilms(th.id).length === 0) return bad(res, 409, 'Nothing to screen — use "Fill theater" first.');
  const seconds = Math.max(5, Number(req.body?.seconds ?? 30));
  const ok = HM.closeDoors(th, { showtimeAt: Date.now() + seconds * 1000, reason: 'DEV' });
  res.json({ ok, showtimeInSeconds: seconds });
});

/** Start the show immediately (or in N seconds) from any pre-show state. */
router.post('/api/dev/start-show', requireDev, (req, res) => {
  let th = HM.ensureTheater();
  const seconds = Math.max(0, Number(req.body?.seconds ?? 0));
  if (['FILLING', 'OPEN_CALL'].includes(th.state)) {
    if (HM.approvedFilms(th.id).length === 0) HM.drawFromReserve(th, { includeHouse: true });
    if (HM.approvedFilms(th.id).length === 0) return bad(res, 409, 'Nothing to screen — use "Fill theater" first.');
    HM.closeDoors(th, { showtimeAt: Date.now() + seconds * 1000, reason: 'DEV' });
    th = HM.currentTheater();
  }
  if (th.state === 'DOORS_CLOSED') {
    db.prepare('UPDATE theaters SET showtime_at = ? WHERE id = ?').run(Date.now() + seconds * 1000, th.id);
    HM.hub.emit('theater:changed', th.id);
  }
  res.json({ ok: true, startsInSeconds: seconds });
});

/** Skip to the last 8 seconds of the reel. */
router.post('/api/dev/skip-to-end', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (th.state !== 'SHOWING') return bad(res, 409, `Theater is ${th.state}.`);
  const reel = HM.reelOf(th);
  db.prepare('UPDATE theaters SET started_at = ? WHERE id = ?')
    .run(Date.now() - Math.max(0, reel.totalMs - 8000), th.id);
  HM.hub.emit('theater:changed', th.id);
  res.json({ ok: true });
});

/** Jump straight to the ballot. */
router.post('/api/dev/open-ballot', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (th.state !== 'SHOWING') return bad(res, 409, `Theater is ${th.state}.`);
  HM.openBallot(th);
  res.json({ ok: true });
});

/** End the ballot now and crown a winner. */
router.post('/api/dev/close-ballot', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (th.state !== 'VOTING') return bad(res, 409, `Theater is ${th.state}.`);
  res.json({ ok: true, stats: HM.tally(th) });
});

/** Archive and open the next house. */
router.post('/api/dev/next-theater', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (th.state === 'RESULTS') return res.json({ ok: true, next: HM.archive(th).id });
  db.prepare("UPDATE theaters SET state='ARCHIVED', archived_at=? WHERE id=?").run(Date.now(), th.id);
  const next = HM.openTheater();
  HM.drawFromReserve(next);
  res.json({ ok: true, next: next.id });
});

/** Schedule a guaranteed showtime N seconds out, to demo the 8pm promise. */
router.post('/api/dev/guaranteed', requireDev, (req, res) => {
  const seconds = Math.max(10, Number(req.body?.seconds ?? 90));
  const at = Date.now() + seconds * 1000;
  HM.setDevGuaranteed(at);
  HM.hub.emit('theater:changed', null);
  res.json({ ok: true, at });
});

/** Inject synthetic demand so you can watch the House Manager resize the room. */
router.post('/api/dev/traffic', requireDev, (req, res) => {
  const level = String(req.body?.level || 'normal').toLowerCase();
  const perHour = { dark: 0, low: 8, normal: 25, high: 70, peak: 160 }[level] ?? 25;
  // A demo tool, so it clears the whole measurement window rather than layering
  // synthetic demand on top of whatever the real history happens to be.
  const now = Date.now();
  db.prepare("DELETE FROM events WHERE type IN ('ticket','submission') AND created_at >= ?")
    .run(now - POLICY.demand.windowMinutes * 60000);
  const span = 45 * 60 * 1000;
  const count = Math.round(perHour * (span / 3600000) * 2.2);   // weighted toward "now"
  const insert = db.prepare('INSERT INTO events (type, theater_id, user_id, meta, created_at) VALUES (?,?,?,?,?)');
  for (let i = 0; i < count; i++) {
    insert.run('ticket', null, null, '{"synthetic":true}', now - Math.round(Math.random() ** 2 * span));
  }
  for (let i = 0; i < Math.ceil(count / 4); i++) {
    insert.run('submission', null, null, '{"synthetic":true}', now - Math.round(Math.random() ** 2 * span));
  }
  HM.hub.emit('theater:changed', null);
  res.json({ ok: true, level, injected: count, demand: HM.measureDemand() });
});

/** A few fake patrons wander in (moves the seat map, not the fill bar much). */
router.post('/api/dev/crowd', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  const n = Math.max(1, Math.min(40, Number(req.body?.n ?? 5)));
  for (let i = 0; i < n; i++) {
    HM.grantTicket(th.id, makePatron().id, 'AUDIENCE', 'house', POLICY.tickets.audiencePriceCents);
  }
  res.json({ ok: true, added: n });
});

/** Ambient hype in the chat, so the room is never silent in a demo. */
router.post('/api/dev/hype', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  const n = Math.max(1, Math.min(12, Number(req.body?.n ?? 4)));
  const patrons = db.prepare('SELECT u.id, u.handle FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.theater_id = ? LIMIT 40').all(th.id);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = patrons.length ? rand(patrons) : { id: req.user.id, handle: req.user.handle };
    const row = {
      id: id('msg'), theater_id: th.id, user_id: p.id, handle: p.handle,
      body: rand(CHAT_LINES), phase: th.state, created_at: Date.now() + i,
    };
    db.prepare(`INSERT INTO chat (id, theater_id, user_id, handle, body, phase, created_at)
                VALUES (@id,@theater_id,@user_id,@handle,@body,@phase,@created_at)`).run(row);
    out.push(row);
    HM.hub.emit('broadcast', { t: 'chat', msg: { id: row.id, handle: row.handle, body: row.body, at: row.created_at, userId: row.user_id } });
  }
  res.json({ ok: true, added: out.length });
});

/** Throw a handful of reactions from the crowd. */
router.post('/api/dev/reactions', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (th.state !== 'SHOWING') return bad(res, 409, 'Nothing on screen.');
  const reel = HM.reelOf(th);
  const t = Date.now() - th.started_at;
  const entry = reel.entries.find((e) => t >= e.startAt && t < e.endAt);
  if (!entry) return bad(res, 409, 'Between films.');
  const n = Math.max(1, Math.min(30, Number(req.body?.n ?? 10)));
  for (let i = 0; i < n; i++) {
    const kind = Math.random() < 0.7 ? 'rose' : 'tomato';
    db.prepare('INSERT INTO reactions (id, theater_id, film_id, user_id, kind, created_at) VALUES (?,?,?,?,?,?)')
      .run(id('rct'), th.id, entry.filmId, req.user.id, kind, Date.now());
    setTimeout(() => HM.hub.emit('broadcast', {
      t: 'react', kind, filmId: entry.filmId, x: Math.random(), spin: Math.random() * 2 - 1,
    }), i * 90);
  }
  res.json({ ok: true, thrown: n });
});

/** Fake ballots from the seeded crowd, so results look like results. */
router.post('/api/dev/votes', requireDev, (req, res) => {
  const th = HM.ensureTheater();
  if (!['VOTING', 'SHOWING'].includes(th.state)) return bad(res, 409, `Theater is ${th.state}.`);
  const reel = HM.reelOf(th);
  if (!reel.entries.length) return bad(res, 409, 'No reel.');
  const patrons = db.prepare('SELECT user_id FROM tickets WHERE theater_id = ?').all(th.id);
  let n = 0;
  for (const p of patrons) {
    const pick = reel.entries[Math.floor(Math.random() * reel.entries.length)];
    db.prepare(`INSERT INTO votes (theater_id, user_id, film_id, created_at) VALUES (?,?,?,?)
                ON CONFLICT(theater_id, user_id) DO NOTHING`).run(th.id, p.user_id, pick.filmId, Date.now());
    n++;
  }
  HM.hub.emit('theater:changed', th.id);
  res.json({ ok: true, ballots: n });
});

module.exports = { router, ADMIN_KEY, DEV_ENABLED, theaterRecord };
