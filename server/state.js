'use strict';
/* The single public view of the building. Both the REST snapshot and every
 * websocket broadcast are built from this function, so the lobby, the
 * countdown and the auditorium can never disagree.
 *
 * NOTE: this payload deliberately contains NO raw attendance figures. The only
 * seat data that leaves the server is the (faked) seat map and your own seat. */

const POLICY = require('./policy');
const { db } = require('./db');
const HM = require('./houseManager');
const { buildSeatMap, attendeeList } = require('./seats');

function tallies(theaterId) {
  const rows = db.prepare(`
    SELECT film_id,
      SUM(CASE WHEN kind='rose' THEN 1 ELSE 0 END) roses,
      SUM(CASE WHEN kind='tomato' THEN 1 ELSE 0 END) tomatoes
    FROM reactions WHERE theater_id = ? GROUP BY film_id`).all(theaterId);
  const out = {};
  for (const r of rows) out[r.film_id] = { roses: r.roses, tomatoes: r.tomatoes };
  return out;
}

function voteCounts(theaterId) {
  const rows = db.prepare('SELECT film_id, COUNT(*) n FROM votes WHERE theater_id = ? GROUP BY film_id').all(theaterId);
  const out = {};
  for (const r of rows) out[r.film_id] = r.n;
  return out;
}

function publicState(viewerId, now = Date.now()) {
  const theater = HM.ensureTheater(now);
  const plan = JSON.parse(theater.plan_json);
  const tickets = HM.ticketRows(theater.id);
  const films = HM.approvedFilms(theater.id);
  const demand = HM.measureDemand(now);
  const guaranteed = HM.nextGuaranteed(demand, now);
  const seatMap = buildSeatMap(theater, tickets, viewerId, now);

  const myTicket = viewerId ? tickets.find((t) => t.user_id === viewerId) : null;
  const mySubmission = viewerId ? db.prepare(
    `SELECT id, title, status, reject_reason, theater_id FROM films
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(viewerId) : null;
  const myVote = viewerId ? db.prepare('SELECT film_id FROM votes WHERE theater_id = ? AND user_id = ?')
    .get(theater.id, viewerId) : null;

  const showing = ['SHOWING', 'VOTING', 'RESULTS'].includes(theater.state);
  const reel = theater.reel_json ? JSON.parse(theater.reel_json) : null;

  const state = {
    serverNow: now,
    theater: {
      id: theater.id,
      number: theater.id,
      state: theater.state,
      tier: theater.tier,
      guaranteed: !!theater.guaranteed,
      createdAt: theater.created_at,
      doorsClosedAt: theater.doors_closed_at,
      showtimeAt: theater.showtime_at,
      startedAt: theater.started_at,
      votingEndsAt: theater.voting_ends_at,
      resultsEndAt: theater.results_end_at,
      winnerFilmId: theater.winner_film_id,
      capacity: plan.seats,
      filmSlots: plan.filmSlots,
      countdownMinutes: Math.round(plan.countdownMinutes),
    },
    marquee: guaranteed ? { at: guaranteed.at, label: guaranteed.label, always: guaranteed.always } : null,
    seatMap,
    programme: films.map((f, i) => ({
      id: f.id, title: f.title, by: f.handle, order: i + 1, blurb: f.blurb,
    })),
    // How full the programme is. (This is the reel, not the audience — no
    // attendance number is ever implied by it.)
    slots: { filled: films.length, total: plan.filmSlots },
    you: {
      id: viewerId || null,
      ticket: myTicket ? { kind: myTicket.kind, source: myTicket.source, seatIndex: myTicket.seat_index } : null,
      submission: mySubmission || null,
      votedFilmId: myVote ? myVote.film_id : null,
    },
    prices: {
      audienceCents: POLICY.tickets.audiencePriceCents,
      encoreCents: POLICY.tickets.encorePriceCents,
    },
    limits: {
      minDurationSec: POLICY.submissions.minDurationSec,
      maxDurationSec: POLICY.submissions.maxDurationSec,
      maxBytes: POLICY.submissions.maxBytes,
    },
  };

  if (showing && reel) {
    state.reel = {
      entries: reel.entries.map((e) => ({
        filmId: e.filmId, title: e.title, by: e.by, blurb: e.blurb, order: e.order,
        kind: e.kind, slate: e.slate, slateMs: e.slateMs, durationMs: e.durationMs,
        startAt: e.startAt, endAt: e.endAt,
        src: e.kind === 'upload' ? `/media/film/${e.filmId}` : null,
      })),
      totalMs: reel.totalMs,
    };
    state.tallies = tallies(theater.id);
  }
  if (['VOTING', 'RESULTS'].includes(theater.state)) {
    state.ballot = (reel ? reel.entries : []).map((e) => ({ filmId: e.filmId, title: e.title, by: e.by, order: e.order }));
  }
  if (theater.state === 'RESULTS') {
    const v = voteCounts(theater.id), t = tallies(theater.id);
    state.results = (reel ? reel.entries : []).map((e) => ({
      filmId: e.filmId, title: e.title, by: e.by, order: e.order,
      votes: v[e.filmId] || 0, roses: (t[e.filmId] || {}).roses || 0, tomatoes: (t[e.filmId] || {}).tomatoes || 0,
      winner: e.filmId === theater.winner_film_id,
    })).sort((a, b) => b.votes - a.votes || b.roses - a.roses);
  }
  if (['DOORS_CLOSED', 'SHOWING', 'VOTING', 'RESULTS'].includes(theater.state)) {
    state.house = attendeeList(theater, tickets, 48);
  }
  return state;
}

module.exports = { publicState, tallies, voteCounts };
