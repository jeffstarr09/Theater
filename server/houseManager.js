'use strict';
/* =============================================================================
 * THE HOUSE MANAGER
 * =============================================================================
 * An autonomous, server-side module that owns every pacing decision in the
 * building. It measures real demand, sizes each theater to it, decides when the
 * doors close, when the show starts, and how long the ballot stays open — and
 * it guarantees the building never looks stuck.
 *
 * It reads ALL of its numbers from policy.js. Nothing in here is a magic
 * constant; if you want to change how the theater behaves, tune the curves.
 * ===========================================================================*/

const { EventEmitter } = require('events');
const POLICY = require('./policy');
const { db } = require('./db');
const { id } = require('./ids');
const { assignSeat } = require('./seats');

const hub = new EventEmitter();
hub.setMaxListeners(50);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MIN = 60 * 1000;

/* ---------------------------------------------------------------------------
 * Curve sampling: piecewise-linear interpolation over policy breakpoints.
 * ------------------------------------------------------------------------ */
function sample(curve, x) {
  if (!Array.isArray(curve)) return curve;
  if (curve.length === 0) return 0;
  if (x <= curve[0].at) return curve[0].value;
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i].at) {
      const a = curve[i - 1], b = curve[i];
      const f = (x - a.at) / Math.max(1e-9, b.at - a.at);
      return a.value + (b.value - a.value) * f;
    }
  }
  return curve[curve.length - 1].value;
}

/* ---------------------------------------------------------------------------
 * DEMAND MEASUREMENT
 * Exponentially-weighted event rates, expressed per hour.
 * ------------------------------------------------------------------------ */
function weightedRate(type, now) {
  const { windowMinutes, halfLifeMinutes } = POLICY.demand;
  const since = now - windowMinutes * MIN;
  const rows = db.prepare(
    'SELECT created_at FROM events WHERE type = ? AND created_at >= ?'
  ).all(type, since);
  if (rows.length === 0) return 0;
  const lambda = Math.LN2 / (halfLifeMinutes * MIN);
  let weighted = 0, norm = 0;
  for (const r of rows) weighted += Math.exp(-lambda * (now - r.created_at));
  // Normalising constant: the integral of the decay over the window, in hours.
  norm = (1 - Math.exp(-lambda * windowMinutes * MIN)) / lambda / (60 * MIN);
  return norm > 0 ? weighted / norm : 0;
}

function attendanceRate() {
  const { attendanceLookbackTheaters, attendanceFloor, attendanceDefault } = POLICY.demand;
  const rows = db.prepare(`
    SELECT t.id,
           (SELECT COUNT(*) FROM tickets WHERE theater_id = t.id) AS sold,
           (SELECT COUNT(*) FROM tickets WHERE theater_id = t.id AND attended = 1) AS came
    FROM theaters t WHERE t.state = 'ARCHIVED'
    ORDER BY t.id DESC LIMIT ?`).all(attendanceLookbackTheaters);
  const usable = rows.filter((r) => r.sold > 0);
  if (usable.length === 0) return attendanceDefault;
  const sold = usable.reduce((a, r) => a + r.sold, 0);
  const came = usable.reduce((a, r) => a + r.came, 0);
  return clamp(came / sold, attendanceFloor, 1);
}

function tierFor(tph) {
  let tier = POLICY.tiers[0];
  for (const t of POLICY.tiers) if (tph >= t.minTicketsPerHour) tier = t;
  return tier;
}

function measureDemand(now = Date.now()) {
  const ticketsPerHour = weightedRate('ticket', now);
  const submissionsPerHour = weightedRate('submission', now);
  const attend = attendanceRate();
  const tier = tierFor(ticketsPerHour);
  return { ticketsPerHour, submissionsPerHour, attendanceRate: attend, tier: tier.name, tierBlurb: tier.blurb };
}

/* ---------------------------------------------------------------------------
 * PLANNING — turn demand into the shape of a room.
 * ------------------------------------------------------------------------ */
function planFor(demand, now = Date.now()) {
  const tph = demand.ticketsPerHour;
  const S = POLICY.shape, T = POLICY.timing;

  // Seats are scaled up when people historically don't turn up, so the room
  // still feels full at showtime. Attendance 1.0 => no oversell.
  const oversell = 1 / Math.max(POLICY.demand.attendanceFloor, demand.attendanceRate);
  const seats = Math.max(S.minSeatsEver, Math.round(sample(S.seats, tph) * clamp(oversell, 1, 2)));
  const filmSlots = Math.max(S.minFilmSlotsEver, Math.round(sample(S.filmSlots, tph)));

  return {
    seats,
    filmSlots,
    minFilms: clamp(Math.round(sample(S.minFilms, tph)), POLICY.antiStall.minFilmsFloor, filmSlots),
    seatQuorum: sample(S.seatQuorum, tph),
    countdownMinutes: sample(T.countdownMinutes, tph),
    votingSeconds: T.votingSeconds,
    resultsSeconds: T.resultsSeconds,
    slateMs: T.slateMs,
    convertAfterMinutes: sample(POLICY.antiStall.convertToScheduledAfterMinutes, tph),
    doorsCloseBeforeMinutes: sample(POLICY.guaranteed.doorsCloseBeforeMinutes, tph),
    tier: demand.tier,
    ticketsPerHour: Math.round(tph * 10) / 10,
    submissionsPerHour: Math.round(demand.submissionsPerHour * 10) / 10,
    attendanceRate: Math.round(demand.attendanceRate * 100) / 100,
    plannedAt: now,
  };
}

/* Effective (post anti-stall-decay) requirements for a given theater. */
function requirements(theater) {
  const plan = JSON.parse(theater.plan_json);
  const A = POLICY.antiStall;
  const steps = theater.decay_steps || 0;
  const minFilms = Math.max(A.minFilmsFloor, Math.round(plan.minFilms - steps * A.filmsDecayStep));
  const seatQuorum = Math.max(A.seatQuorumFloor, plan.seatQuorum - steps * A.seatQuorumDecayStep);
  // A growing room must never move the finish line away from the people
  // already inside it: the seat requirement is capped at the lowest value it
  // has ever had for this theater (plan.seatsNeededCap, maintained by replan).
  const seatsNeeded = Math.max(1, Math.min(Math.ceil(plan.seats * seatQuorum), plan.seatsNeededCap ?? Infinity));
  return {
    plan, steps, minFilms, seatQuorum, seatsNeeded,
    atFloor: minFilms <= A.minFilmsFloor && seatQuorum <= A.seatQuorumFloor
      && plan.seats <= POLICY.shape.minSeatsEver,
  };
}

/* ---------------------------------------------------------------------------
 * GUARANTEED SHOWTIMES
 * ------------------------------------------------------------------------ */
function parseHHMM(s) { const [h, m] = s.split(':').map(Number); return { h, m }; }

function slotsActiveNow(demand) {
  const slots = POLICY.guaranteed.daily.map((at) => ({ at, always: true }));
  for (const e of POLICY.guaranteed.extra) {
    if (demand.ticketsPerHour >= e.minTicketsPerHour) slots.push({ at: e.at, always: false });
  }
  return slots;
}

/* The DEV panel can drop an extra guaranteed showtime onto the schedule so the
 * whole "the 8pm show fires whether or not we filled" path is demoable in
 * seconds instead of hours. Cleared once it has been used. */
let devGuaranteedAt = null;
function setDevGuaranteed(ts) { devGuaranteedAt = ts; }

/** The next guaranteed showtime from `now`, as { at: epochMs, label, always }. */
function nextGuaranteed(demand, now = Date.now()) {
  const grace = POLICY.guaranteed.graceMinutes * MIN;
  const candidates = [];
  if (devGuaranteedAt && devGuaranteedAt > now - 10 * MIN) {
    candidates.push({ at: devGuaranteedAt, label: 'DEV', always: true });
  }
  for (const slot of slotsActiveNow(demand)) {
    const { h, m } = parseHHMM(slot.at);
    for (const dayOffset of [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m, 0, 0);
      const ts = d.getTime();
      if (ts > now + grace) candidates.push({ at: ts, label: slot.at, always: slot.always });
    }
  }
  candidates.sort((a, b) => a.at - b.at);
  return candidates[0] || null;
}

/* ---------------------------------------------------------------------------
 * THEATER LIFECYCLE
 * ------------------------------------------------------------------------ */
const ACTIVE_STATES = ['FILLING', 'OPEN_CALL', 'DOORS_CLOSED', 'SHOWING', 'VOTING', 'RESULTS'];

function currentTheater() {
  return db.prepare(
    `SELECT * FROM theaters WHERE state IN (${ACTIVE_STATES.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`
  ).get(...ACTIVE_STATES);
}

function openTheater(now = Date.now()) {
  const demand = measureDemand(now);
  const plan = planFor(demand, now);
  const info = db.prepare(`
    INSERT INTO theaters (state, created_at, plan_json, tier, last_progress_at)
    VALUES ('OPEN_CALL', ?, ?, ?, ?)`).run(now, JSON.stringify(plan), plan.tier, now);
  const theater = db.prepare('SELECT * FROM theaters WHERE id = ?').get(info.lastInsertRowid);
  logEvent('theater_open', theater.id, null, { plan });
  hub.emit('theater:new', theater);
  return theater;
}

function ensureTheater(now = Date.now()) {
  return currentTheater() || openTheater(now);
}

function logEvent(type, theaterId, userId, meta) {
  db.prepare('INSERT INTO events (type, theater_id, user_id, meta, created_at) VALUES (?,?,?,?,?)')
    .run(type, theaterId ?? null, userId ?? null, meta ? JSON.stringify(meta) : null, Date.now());
}

function markProgress(theaterId, now = Date.now()) {
  db.prepare('UPDATE theaters SET last_progress_at = ?, decay_steps = 0 WHERE id = ?').run(now, theaterId);
}

function approvedFilms(theaterId) {
  return db.prepare(
    `SELECT f.*, u.handle FROM films f JOIN users u ON u.id = f.user_id
     WHERE f.theater_id = ? AND f.status IN ('approved','screened')
     ORDER BY COALESCE(f.slot_index, 999), f.created_at`).all(theaterId);
}

function ticketRows(theaterId) {
  return db.prepare(
    `SELECT t.*, u.handle FROM tickets t JOIN users u ON u.id = t.user_id
     WHERE t.theater_id = ? ORDER BY t.created_at`).all(theaterId);
}

/* Pull approved films waiting in the reserve into a theater with free slots. */
function drawFromReserve(theater, { includeHouse = false } = {}) {
  const req = requirements(theater);
  const have = approvedFilms(theater.id).length;
  const free = req.plan.filmSlots - have;
  if (free <= 0) return 0;
  const rows = db.prepare(`
    SELECT f.* FROM films f JOIN users u ON u.id = f.user_id
    WHERE f.theater_id IS NULL AND f.status = 'approved' ${includeHouse ? '' : 'AND u.is_house = 0'}
    ORDER BY u.is_house ASC, f.created_at ASC LIMIT ?`).all(free);
  for (const f of rows) {
    db.prepare('UPDATE films SET theater_id = ? WHERE id = ?').run(theater.id, f.id);
    // Every filmmaker in the reel holds a seat.
    grantTicket(theater.id, f.user_id, 'FILMMAKER', 'carryover');
  }
  if (rows.length) markProgress(theater.id);
  return rows.length;
}

/** Give someone a seat. Idempotent per (theater, user). */
function grantTicket(theaterId, userId, kind, source = 'purchase', paidCents = 0) {
  const existing = db.prepare('SELECT * FROM tickets WHERE theater_id = ? AND user_id = ?').get(theaterId, userId);
  if (existing) {
    if (kind === 'FILMMAKER' && existing.kind !== 'FILMMAKER') {
      db.prepare("UPDATE tickets SET kind = 'FILMMAKER' WHERE id = ?").run(existing.id);
    }
    return existing;
  }
  const theater = db.prepare('SELECT * FROM theaters WHERE id = ?').get(theaterId);
  const plan = JSON.parse(theater.plan_json);
  const used = db.prepare('SELECT seat_index FROM tickets WHERE theater_id = ?').all(theaterId).map((r) => r.seat_index);
  const seat = assignSeat(plan.seats, used);
  const ticket = {
    id: id('tkt'), theater_id: theaterId, user_id: userId, kind, source,
    seat_index: seat, paid_cents: paidCents, created_at: Date.now(),
  };
  db.prepare(`INSERT INTO tickets (id, theater_id, user_id, kind, source, seat_index, paid_cents, attended, created_at)
              VALUES (@id,@theater_id,@user_id,@kind,@source,@seat_index,@paid_cents,0,@created_at)`).run(ticket);
  logEvent('ticket', theaterId, userId, { kind, source });
  markProgress(theaterId);
  hub.emit('theater:changed', theaterId);
  return ticket;
}

/* ---------------------------------------------------------------------------
 * THE REEL — frozen at doors-close, the running order for the night.
 * ------------------------------------------------------------------------ */
function buildReel(theater) {
  const plan = JSON.parse(theater.plan_json);
  const films = approvedFilms(theater.id).slice(0, plan.filmSlots);
  const slateMs = plan.slateMs ?? POLICY.timing.slateMs;
  let cursor = 0;
  const entries = films.map((f, i) => {
    const entry = {
      filmId: f.id, title: f.title, blurb: f.blurb, by: f.handle,
      kind: f.kind, slate: f.slate_json ? JSON.parse(f.slate_json) : null,
      slateMs, durationMs: f.duration_ms,
      startAt: cursor, endAt: cursor + slateMs + f.duration_ms, order: i + 1,
    };
    cursor = entry.endAt;
    return entry;
  });
  return { entries, totalMs: cursor, slateMs };
}

function reelOf(theater) {
  return theater.reel_json ? JSON.parse(theater.reel_json) : buildReel(theater);
}

/* ---------------------------------------------------------------------------
 * TRANSITIONS
 * ------------------------------------------------------------------------ */
function closeDoors(theater, { showtimeAt, guaranteed = false, reason = 'filled' }, now = Date.now()) {
  const reel = buildReel(theater);
  if (reel.entries.length === 0) return false;
  db.prepare(`UPDATE theaters SET state='DOORS_CLOSED', doors_closed_at=?, showtime_at=?, guaranteed=?, reel_json=?
              WHERE id = ?`).run(now, showtimeAt, guaranteed ? 1 : 0, JSON.stringify(reel), theater.id);
  // Films that didn't make the cut roll over to the reserve for the next room.
  if (POLICY.tickets.carryOverUnscreenedFilms) {
    const keep = new Set(reel.entries.map((e) => e.filmId));
    for (const f of approvedFilms(theater.id)) {
      if (!keep.has(f.id)) db.prepare('UPDATE films SET theater_id = NULL WHERE id = ?').run(f.id);
    }
  }
  logEvent('doors_closed', theater.id, null, { reason, guaranteed, showtimeAt, films: reel.entries.length });
  hub.emit('theater:transition', { theaterId: theater.id, state: 'DOORS_CLOSED', reason });
  return true;
}

function startShow(theater, now = Date.now()) {
  const reel = reelOf(theater);
  if (!reel.entries.length) return false;
  db.prepare("UPDATE theaters SET state='SHOWING', started_at=?, reel_json=? WHERE id = ?")
    .run(now, JSON.stringify(reel), theater.id);
  // Anyone holding a ticket at showtime counts as attending for demand metrics;
  // live presence upgrades this in realtime.js.
  logEvent('show', theater.id, null, { films: reel.entries.length, totalMs: reel.totalMs });
  hub.emit('theater:transition', { theaterId: theater.id, state: 'SHOWING' });
  return true;
}

function openBallot(theater, now = Date.now()) {
  const plan = JSON.parse(theater.plan_json);
  const ends = now + (plan.votingSeconds ?? POLICY.timing.votingSeconds) * 1000;
  db.prepare("UPDATE theaters SET state='VOTING', ended_at=?, voting_ends_at=? WHERE id = ?")
    .run(now, ends, theater.id);
  hub.emit('theater:transition', { theaterId: theater.id, state: 'VOTING' });
}

function tally(theater, now = Date.now()) {
  const reel = reelOf(theater);
  const plan = JSON.parse(theater.plan_json);
  const stats = reel.entries.map((e) => {
    const votes = db.prepare('SELECT COUNT(*) n FROM votes WHERE theater_id = ? AND film_id = ?').get(theater.id, e.filmId).n;
    const roses = db.prepare("SELECT COUNT(*) n FROM reactions WHERE film_id = ? AND kind='rose'").get(e.filmId).n;
    const tomatoes = db.prepare("SELECT COUNT(*) n FROM reactions WHERE film_id = ? AND kind='tomato'").get(e.filmId).n;
    return { ...e, votes, roses, tomatoes };
  });
  stats.sort((a, b) => b.votes - a.votes || b.roses - a.roses || a.tomatoes - b.tomatoes || a.order - b.order);
  const winner = stats[0] || null;
  db.prepare("UPDATE theaters SET state='RESULTS', winner_film_id=?, results_end_at=? WHERE id = ?")
    .run(winner ? winner.filmId : null, now + (plan.resultsSeconds ?? POLICY.timing.resultsSeconds) * 1000, theater.id);
  for (const s of stats) db.prepare("UPDATE films SET status='screened' WHERE id = ?").run(s.filmId);
  logEvent('results', theater.id, null, { winner: winner && winner.filmId });
  hub.emit('theater:transition', { theaterId: theater.id, state: 'RESULTS', stats });
  return stats;
}

function archive(theater, now = Date.now()) {
  db.prepare("UPDATE theaters SET state='ARCHIVED', archived_at=? WHERE id = ?").run(now, theater.id);
  hub.emit('theater:transition', { theaterId: theater.id, state: 'ARCHIVED' });
  const next = openTheater(now);
  // Rejected filmmakers get comped into the next house, as promised.
  if (POLICY.tickets.compRejectedFilmmakers) {
    const rejected = db.prepare(`
      SELECT DISTINCT user_id FROM films
      WHERE status = 'rejected' AND reviewed_at >= ?`).all(theater.created_at);
    for (const r of rejected) grantTicket(next.id, r.user_id, 'AUDIENCE', 'comp_rejected');
  }
  drawFromReserve(next);
  return next;
}

/* ---------------------------------------------------------------------------
 * THE TICK — the autonomous loop.
 * ------------------------------------------------------------------------ */
let lastReplan = 0;

function tick(now = Date.now()) {
  let theater = ensureTheater(now);
  const demand = measureDemand(now);

  switch (theater.state) {
    case 'OPEN_CALL':
    case 'FILLING': {
      // Keep the room the right size for the crowd outside it.
      if (now - lastReplan >= POLICY.clock.replanEveryMs) {
        lastReplan = now;
        replan(theater, demand, now);
        theater = db.prepare('SELECT * FROM theaters WHERE id = ?').get(theater.id);
      }
      drawFromReserve(theater);

      const films = approvedFilms(theater.id);
      const tickets = db.prepare('SELECT COUNT(*) n FROM tickets WHERE theater_id = ?').get(theater.id).n;
      const req = requirements(theater);

      // A theater with no programme is an OPEN CALL, not a stalled theater.
      const wantState = films.length === 0 ? 'OPEN_CALL' : 'FILLING';
      if (wantState !== theater.state) {
        db.prepare('UPDATE theaters SET state = ? WHERE id = ?').run(wantState, theater.id);
        theater.state = wantState;
        hub.emit('theater:transition', { theaterId: theater.id, state: wantState });
      }

      // (1) GUARANTEED SHOWTIME — fires whether or not the room filled.
      const g = nextGuaranteed(demand, now);
      if (g && now >= g.at - req.plan.doorsCloseBeforeMinutes * MIN) {
        if (films.length === 0 && POLICY.antiStall.houseReelFallback) {
          drawFromReserve(theater, { includeHouse: true });
        }
        if (approvedFilms(theater.id).length >= POLICY.antiStall.minFilmsFloor) {
          if (closeDoors(theater, { showtimeAt: g.at, guaranteed: true, reason: `guaranteed ${g.label}` }, now)) {
            if (g.label === 'DEV') devGuaranteedAt = null;
            break;
          }
        }
      }

      // (2) NORMAL FILL CONDITION
      const programmeFull = films.length >= req.plan.filmSlots;
      const filmsOk = films.length >= req.minFilms;
      const seatsOk = tickets >= req.seatsNeeded;
      if ((filmsOk && seatsOk) || (programmeFull && tickets >= Math.ceil(req.seatsNeeded * 0.5))) {
        const showtimeAt = now + req.plan.countdownMinutes * MIN;
        if (closeDoors(theater, { showtimeAt, reason: programmeFull ? 'programme full' : 'filled' }, now)) break;
      }

      // (3) ANTI-STALL DECAY — quiet rooms get easier to fill, on a timer.
      const A = POLICY.antiStall;
      const quietFor = now - theater.last_progress_at;
      const nextDecayAt = A.quietMinutesBeforeDecay * MIN + (theater.decay_steps * A.decayEveryMinutes * MIN);
      if (quietFor > nextDecayAt && !req.atFloor && theater.decay_steps < A.maxDecaySteps) {
        db.prepare('UPDATE theaters SET decay_steps = decay_steps + 1 WHERE id = ?').run(theater.id);
        logEvent('stall_decay', theater.id, null, { steps: theater.decay_steps + 1 });
        hub.emit('theater:changed', theater.id);
      }

      // (4) CONVERSION — stop waiting to fill, just schedule the thing.
      const ageMin = (now - theater.created_at) / MIN;
      if (films.length >= A.minFilmsFloor && ageMin >= req.plan.convertAfterMinutes) {
        const showtimeAt = now + Math.max(2, req.plan.countdownMinutes * 0.5) * MIN;
        closeDoors(theater, { showtimeAt, reason: 'converted to scheduled showtime' }, now);
      }
      break;
    }

    case 'DOORS_CLOSED':
      if (now >= theater.showtime_at) {
        if (!startShow(theater, now)) {
          // Nothing to screen (shouldn't happen) — reopen rather than hang.
          db.prepare("UPDATE theaters SET state='OPEN_CALL', reel_json=NULL, showtime_at=NULL, doors_closed_at=NULL WHERE id=?")
            .run(theater.id);
        }
      }
      break;

    case 'SHOWING': {
      const reel = reelOf(theater);
      if (now >= theater.started_at + reel.totalMs) openBallot(theater, now);
      break;
    }

    case 'VOTING':
      if (now >= theater.voting_ends_at) tally(theater, now);
      break;

    case 'RESULTS':
      if (now >= theater.results_end_at) archive(theater, now);
      break;
  }
}

/** Resize a filling theater to match live demand. Never shrinks below the
 *  crowd already inside it, and never undoes anti-stall progress. */
function replan(theater, demand, now) {
  const fresh = planFor(demand, now);
  const old = JSON.parse(theater.plan_json);
  const tickets = db.prepare('SELECT COUNT(*) n FROM tickets WHERE theater_id = ?').get(theater.id).n;
  const films = approvedFilms(theater.id).length;
  // Each anti-stall step moves the show into a smaller house.
  const shrink = Math.pow(1 - POLICY.antiStall.roomShrinkPerStep, theater.decay_steps || 0);
  const merged = {
    ...fresh,
    seats: Math.max(Math.round(fresh.seats * shrink), tickets, POLICY.shape.minSeatsEver),
    filmSlots: Math.max(Math.round(fresh.filmSlots * shrink), films, POLICY.shape.minFilmSlotsEver),
    // Requirements may fall freely but may not rise once a room is open —
    // a patron should never watch the finish line move away from them.
    minFilms: Math.min(old.minFilms, fresh.minFilms),
    seatQuorum: Math.min(old.seatQuorum, fresh.seatQuorum),
  };
  merged.seatsNeededCap = Math.min(
    old.seatsNeededCap ?? Math.ceil(old.seats * old.seatQuorum),
    Math.ceil(merged.seats * merged.seatQuorum),
  );
  if (JSON.stringify(merged) !== JSON.stringify(old)) {
    db.prepare('UPDATE theaters SET plan_json = ?, tier = ? WHERE id = ?')
      .run(JSON.stringify(merged), merged.tier, theater.id);
    hub.emit('theater:changed', theater.id);
  }
}

let timer = null;
function start() {
  if (timer) return;
  ensureTheater();
  timer = setInterval(() => {
    try { tick(); } catch (err) { console.error('[house manager] tick failed:', err); }
  }, POLICY.clock.tickMs);
  timer.unref?.();
  console.log(`[house manager] on duty (tick ${POLICY.clock.tickMs}ms)`);
}
function stop() { if (timer) clearInterval(timer); timer = null; }

/** Everything the DEV panel / admin page wants to know about the building. */
function status(now = Date.now()) {
  const demand = measureDemand(now);
  const theater = ensureTheater(now);
  const req = requirements(theater);
  const films = approvedFilms(theater.id);
  const tickets = db.prepare('SELECT COUNT(*) n FROM tickets WHERE theater_id = ?').get(theater.id).n;
  const g = nextGuaranteed(demand, now);
  return {
    now, demand, theaterId: theater.id, state: theater.state,
    plan: req.plan, decaySteps: req.steps,
    effective: { minFilms: req.minFilms, seatQuorum: Math.round(req.seatQuorum * 100) / 100, seatsNeeded: req.seatsNeeded },
    have: { films: films.length, tickets },
    quietForMs: now - theater.last_progress_at,
    nextGuaranteed: g,
  };
}

module.exports = {
  hub, tick, start, stop, status, measureDemand, planFor, requirements, sample,
  currentTheater, ensureTheater, openTheater, grantTicket, approvedFilms, ticketRows,
  buildReel, reelOf, closeDoors, startShow, openBallot, tally, archive, logEvent,
  markProgress, drawFromReserve, nextGuaranteed, setDevGuaranteed, ACTIVE_STATES,
};
