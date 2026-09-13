'use strict';
/* =============================================================================
 * THE SEAT MAP — decoupled from reality on purpose.
 * =============================================================================
 * The room always looks lively. Real ticket holders are seated among ambient
 * "extras" using the fullness curve in policy.js. The payload sent to clients
 * deliberately does NOT distinguish a real patron from an extra — the only
 * seat anyone can identify is their own ("you are here") — so no client can
 * reverse-engineer the real attendance figure.
 * ===========================================================================*/

const POLICY = require('./policy');
const { mulberry32, pseudonym } = require('./ids');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Auditorium geometry: rows get wider toward the back, with an aisle gap. */
function layout(capacity) {
  const rowCount = clamp(Math.round(Math.sqrt(capacity / 1.6)), 2, 14);
  const rows = [];
  let remaining = capacity;
  // Weight each row so the back rows are wider than the front ones.
  const weights = [];
  for (let r = 0; r < rowCount; r++) weights.push(1 + (r / Math.max(1, rowCount - 1)) * 0.9);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let r = 0; r < rowCount; r++) {
    const n = r === rowCount - 1 ? remaining : Math.max(2, Math.round((weights[r] / total) * capacity));
    const take = Math.min(n, remaining);
    rows.push(take);
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) rows[rows.length - 1] += remaining;
  return rows.filter((n) => n > 0);
}

/* Seats near the middle of the middle rows are the best in the house; we hand
 * them out first so early arrivals feel rewarded. Returns seat indices ordered
 * by desirability. */
function desirabilityOrder(capacity) {
  const rows = layout(capacity);
  const scored = [];
  let idx = 0;
  rows.forEach((len, r) => {
    for (let c = 0; c < len; c++) {
      const rowScore = Math.abs(r - (rows.length - 1) * 0.62);      // slightly back of centre
      const colScore = Math.abs(c - (len - 1) / 2) / Math.max(1, len);
      scored.push({ idx, score: rowScore * 0.7 + colScore * 3 });
      idx++;
    }
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.idx);
}

/* The fullness curve. Returns the fraction of seats that will LOOK occupied. */
function displayedFill({ realOccupied, capacity, ageMs, doorsClosed, now }) {
  const F = POLICY.fullness;
  const realFill = capacity > 0 ? clamp(realOccupied / capacity, 0, 1) : 0;
  let target = F.base + realFill * F.slope;
  if (doorsClosed) target += F.doorsClosedBoost;
  target = clamp(target, F.min, F.max);

  // Extras drift in over the first few minutes so the map visibly breathes.
  const ramp = clamp(ageMs / (F.arrivalRampMinutes * 60000), 0, 1);
  const arrived = F.arrivalStart + (1 - F.arrivalStart) * ramp;
  let fill = target * arrived;

  // Slow wobble, shared by every client because the server computes it.
  const wobble = Math.sin(now / 9000) * F.jitter + Math.sin(now / 3700) * (F.jitter / 2);
  fill = clamp(fill + wobble, 0, F.max);

  // Real people must always have a seat, whatever the curve says.
  return Math.max(fill, realFill);
}

/**
 * Build the seat map for a theater.
 * @param {object} theater  row from `theaters`
 * @param {Array}  ticketRows [{ user_id, seat_index, kind }]
 * @param {string|null} viewerId
 */
function buildSeatMap(theater, ticketRows, viewerId, now = Date.now()) {
  const plan = JSON.parse(theater.plan_json);
  const capacity = Math.max(POLICY.shape.minSeatsEver, plan.seats);
  const rows = layout(capacity);
  const doorsClosed = ['DOORS_CLOSED', 'SHOWING', 'VOTING', 'RESULTS'].includes(theater.state);
  const ageMs = now - theater.created_at;

  const fill = displayedFill({
    realOccupied: ticketRows.length, capacity, ageMs, doorsClosed, now,
  });
  const occupiedCount = clamp(Math.round(capacity * fill), ticketRows.length, capacity);

  const taken = new Uint8Array(capacity);
  const names = new Array(capacity).fill(null);
  let youIndex = -1;

  // 1. Real patrons take their assigned seats.
  for (const t of ticketRows) {
    let seat = Number.isInteger(t.seat_index) ? t.seat_index : -1;
    if (seat < 0 || seat >= capacity || taken[seat]) {
      seat = desirabilityOrder(capacity).find((i) => !taken[i]);
    }
    if (seat === undefined) continue;
    taken[seat] = 1;
    names[seat] = t.handle || 'Patron';
    if (viewerId && t.user_id === viewerId) youIndex = seat;
  }

  // 2. Extras fill in around them, deterministically per theater.
  const rng = mulberry32(theater.id * 7919 + 13);
  const pool = desirabilityOrder(capacity).filter((i) => !taken[i]);
  // Shuffle the pool a little so extras aren't a perfect desirability gradient.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let need = occupiedCount - ticketRows.length;
  for (let i = 0; i < pool.length && need > 0; i++) {
    // Bias extras toward good seats but leave believable gaps.
    if (rng() < 0.07 && need < pool.length - i) continue;
    taken[pool[i]] = 1;
    names[pool[i]] = pseudonym(rng);
    need--;
  }

  // 3. Flatten into rows. `1` = occupied, `0` = empty. No one can tell which
  //    of the occupied seats hold real people.
  const grid = [];
  let idx = 0;
  for (const len of rows) {
    const row = [];
    for (let c = 0; c < len; c++) row.push(taken[idx++] ? 1 : 0);
    grid.push(row);
  }

  return {
    rows: grid,
    youIndex,
    // A qualitative descriptor — we never ship a headcount.
    mood: fill > 0.92 ? 'Packed' : fill > 0.84 ? 'Nearly full' : fill > 0.72 ? 'Busy house' : 'Filling nicely',
    fillPct: Math.round(fill * 100),
  };
}

/** Pseudonymous house list, drawn from the seat map (extras included). */
function attendeeList(theater, ticketRows, limit = 60) {
  const map = buildSeatMap(theater, ticketRows, null);
  const rng = mulberry32(theater.id * 104729 + 7);
  const real = ticketRows.map((t) => t.handle).filter(Boolean);
  const out = new Set(real);
  while (out.size < Math.min(limit, real.length + 40)) out.add(pseudonym(rng));
  const list = [...out];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return { list: list.slice(0, limit), mood: map.mood };
}

/** Pick a seat for a brand new ticket holder. */
function assignSeat(capacity, usedSeats) {
  const used = new Set(usedSeats.filter((n) => Number.isInteger(n)));
  const order = desirabilityOrder(capacity);
  for (const i of order) if (!used.has(i)) return i;
  return null;
}

module.exports = { buildSeatMap, attendeeList, assignSeat, layout, displayedFill };
