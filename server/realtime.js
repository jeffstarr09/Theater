'use strict';
/* Websocket hub: server-authoritative clock, synced playback state, hype chat,
 * live reactions and the ballot. The server is the only clock that matters —
 * clients render whatever `serverNow - startedAt` says they should be seeing. */

const { WebSocketServer } = require('ws');
const { db } = require('./db');
const { id } = require('./ids');
const { userFromRequest } = require('./auth');
const HM = require('./houseManager');
const { publicState } = require('./state');

const clients = new Set();
const RATE = { chat: 900, react: 200, vote: 500 };
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj, theaterId) {
  for (const c of clients) {
    if (theaterId && c.theaterId !== theaterId) continue;
    send(c.ws, obj);
  }
}
function pushState(c, now = Date.now()) {
  const st = publicState(c.user ? c.user.id : null, now);
  c.theaterId = st.theater.id;
  send(c.ws, { t: 'state', ...st });
}
function pushAll() {
  const now = Date.now();
  for (const c of clients) pushState(c, now);
}

function markAttendance(c) {
  if (!c.user) return;
  const th = HM.currentTheater();
  if (!th || !['DOORS_CLOSED', 'SHOWING', 'VOTING', 'RESULTS'].includes(th.state)) return;
  const tkt = db.prepare('SELECT * FROM tickets WHERE theater_id = ? AND user_id = ?').get(th.id, c.user.id);
  if (tkt && !tkt.attended) {
    db.prepare('UPDATE tickets SET attended = 1 WHERE id = ?').run(tkt.id);
    HM.logEvent('attend', th.id, c.user.id, null);
  }
}

/* Which film is on screen right now, according to the server's clock alone. */
function currentFilmId(theater, now) {
  if (theater.state !== 'SHOWING' || !theater.reel_json) return null;
  const reel = JSON.parse(theater.reel_json);
  const t = now - theater.started_at;
  const e = reel.entries.find((x) => t >= x.startAt && t < x.endAt);
  return e ? e.filmId : null;
}

function handle(c, msg) {
  const now = Date.now();
  const th = HM.currentTheater();
  if (!th) return;

  switch (msg.t) {
    case 'ping':
      /* Clock sync: the client measures round-trip and keeps an offset. */
      send(c.ws, { t: 'pong', c: msg.c, now: Date.now() });
      break;

    case 'hello':
      c.page = String(msg.page || '').slice(0, 24);
      markAttendance(c);
      pushState(c, now);
      break;

    case 'chat': {
      if (!c.user) return;
      if (now - (c.last.chat || 0) < RATE.chat) return;
      c.last.chat = now;
      const body = String(msg.body || '').replace(CONTROL_CHARS, '').trim().slice(0, 240);
      if (!body) return;
      const row = {
        id: id('msg'), theater_id: th.id, user_id: c.user.id, handle: c.user.handle,
        body, phase: th.state, created_at: now,
      };
      db.prepare(`INSERT INTO chat (id, theater_id, user_id, handle, body, phase, created_at)
                  VALUES (@id,@theater_id,@user_id,@handle,@body,@phase,@created_at)`).run(row);
      broadcast({ t: 'chat', msg: { id: row.id, handle: row.handle, body: row.body, at: now, userId: c.user.id } }, th.id);
      break;
    }

    case 'react': {
      if (!c.user) return;
      if (now - (c.last.react || 0) < RATE.react) return;
      c.last.react = now;
      const kind = msg.kind === 'tomato' ? 'tomato' : 'rose';
      const filmId = currentFilmId(th, now);
      if (!filmId) return;
      db.prepare('INSERT INTO reactions (id, theater_id, film_id, user_id, kind, created_at) VALUES (?,?,?,?,?,?)')
        .run(id('rct'), th.id, filmId, c.user.id, kind, now);
      broadcast({ t: 'react', kind, filmId, x: Math.random(), spin: Math.random() * 2 - 1 }, th.id);
      break;
    }

    case 'vote': {
      if (!c.user || th.state !== 'VOTING') return;
      if (now - (c.last.vote || 0) < RATE.vote) return;
      c.last.vote = now;
      const reel = th.reel_json ? JSON.parse(th.reel_json) : { entries: [] };
      if (!reel.entries.some((e) => e.filmId === msg.filmId)) return;
      db.prepare(`INSERT INTO votes (theater_id, user_id, film_id, created_at) VALUES (?,?,?,?)
                  ON CONFLICT(theater_id, user_id) DO UPDATE SET film_id = excluded.film_id, created_at = excluded.created_at`)
        .run(th.id, c.user.id, msg.filmId, now);
      HM.logEvent('vote', th.id, c.user.id, { filmId: msg.filmId });
      pushState(c, now);
      break;
    }
  }
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const user = userFromRequest(req);
    const c = { ws, user, last: {}, theaterId: null, page: null };
    clients.add(c);
    markAttendance(c);
    pushState(c);

    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      try { handle(c, msg); } catch (err) { console.error('[ws]', err); }
    });
    ws.on('close', () => clients.delete(c));
    ws.on('error', () => clients.delete(c));
  });

  /* A cheap authoritative clock tick between full state pushes. */
  const beat = setInterval(() => broadcast({ t: 'clock', now: Date.now() }), 1000);
  const full = setInterval(pushAll, 2000);
  beat.unref?.(); full.unref?.();

  /* Anything the House Manager decides is pushed out immediately. */
  HM.hub.on('theater:transition', (info) => {
    broadcast({ t: 'transition', theaterId: info.theaterId, state: info.state, reason: info.reason, now: Date.now() });
    pushAll();
  });
  HM.hub.on('theater:changed', pushAll);
  HM.hub.on('theater:new', pushAll);
  HM.hub.on('broadcast', (obj) => broadcast(obj));

  return wss;
}

module.exports = { attach, broadcast, pushAll, clients };
