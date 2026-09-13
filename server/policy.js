/* =============================================================================
 * THE HOUSE MANAGER — POLICY FILE
 * =============================================================================
 * This is the ONLY place where the pacing of the entire building is decided.
 * Nothing about theater size, fill requirements, or countdown length is
 * hardcoded anywhere else in the codebase: `houseManager.js` reads this file,
 * measures real demand, and computes every number at runtime.
 *
 * HOW TO TUNE IT
 * --------------
 * Most knobs are "curves": a list of breakpoints sampled against a measured
 * demand signal. A curve looks like this:
 *
 *     [ { at: 0, value: 10 }, { at: 60, value: 120 } ]
 *
 * `at` is the measured value of the demand signal (tickets per hour, usually);
 * `value` is what the parameter should be at that level of demand. Anything in
 * between is linearly interpolated; anything outside is clamped to the nearest
 * endpoint. Add breakpoints to bend a curve, do not touch the interpolator.
 *
 * THE DEMAND SIGNAL
 * -----------------
 * `ticketsPerHour` is an exponentially-weighted rate: recent minutes count for
 * more than older ones (see `demand.halfLifeMinutes`). It is deliberately
 * smooth so the building does not resize itself every time one person walks in.
 * ===========================================================================*/

module.exports = {
  /* -------------------------------------------------------------------------
   * 1. CLOCK
   * The House Manager runs an autonomous loop. Everything it does — resizing,
   * closing doors, starting shows, tallying votes — happens on this tick.
   * ---------------------------------------------------------------------- */
  clock: {
    tickMs: 1000,            // how often the House Manager re-evaluates the world
    replanEveryMs: 15000,    // how often a FILLING theater is allowed to resize
  },

  /* -------------------------------------------------------------------------
   * 2. DEMAND MEASUREMENT
   * How we turn raw event history into the signals the curves are sampled on.
   * ---------------------------------------------------------------------- */
  demand: {
    windowMinutes: 120,      // how far back we look at all
    halfLifeMinutes: 25,     // an event 25 min old counts half as much as one now
    // Attendance rate = (people who actually showed up) / (tickets sold), over
    // the last N archived theaters. Used to oversell seats when no-shows are
    // common, and to shrink the house when nobody turns up.
    attendanceLookbackTheaters: 6,
    attendanceFloor: 0.25,   // never assume worse than this
    attendanceDefault: 0.75, // assumed rate before we have any history
  },

  /* -------------------------------------------------------------------------
   * 3. TRAFFIC TIERS
   * Purely cosmetic/diagnostic labels for the current demand level. The actual
   * numbers come from the curves below, not from the tier — but the tier is
   * shown in /admin and the DEV panel so you can see what the building thinks
   * is happening.
   * ---------------------------------------------------------------------- */
  tiers: [
    { name: 'DARK',   minTicketsPerHour: 0,   blurb: 'The house is quiet. Tiny rooms, guaranteed nightly show.' },
    { name: 'LOW',    minTicketsPerHour: 4,   blurb: 'A trickle. Small rooms, patient doors.' },
    { name: 'NORMAL', minTicketsPerHour: 15,  blurb: 'Steady business.' },
    { name: 'HIGH',   minTicketsPerHour: 45,  blurb: 'Busy night. Bigger rooms, shorter waits.' },
    { name: 'PEAK',   minTicketsPerHour: 120, blurb: 'Queues around the block. Rapid turnover.' },
  ],

  /* -------------------------------------------------------------------------
   * 4. THEATER SHAPE  (all sampled against ticketsPerHour)
   * ---------------------------------------------------------------------- */
  shape: {
    // Total seats in the room. This is the REAL capacity — it is not what the
    // seat map displays (see section 8, FAKE FULLNESS).
    seats: [
      { at: 0,   value: 10 },
      { at: 4,   value: 18 },
      { at: 15,  value: 40 },
      { at: 45,  value: 90 },
      { at: 120, value: 180 },
    ],

    // How many of those seats are reserved for filmmakers (i.e. how many films
    // can possibly be in the reel). Kept well under `seats` so the audience
    // always outnumbers the programme.
    filmSlots: [
      { at: 0,   value: 3 },
      { at: 4,   value: 4 },
      { at: 15,  value: 6 },
      { at: 45,  value: 9 },
      { at: 120, value: 12 },
    ],

    // Fill condition, part 1: how many approved films the reel needs before the
    // doors are allowed to close. Anti-stall (section 6) can lower this.
    minFilms: [
      { at: 0,   value: 3 },
      { at: 4,   value: 3 },
      { at: 15,  value: 4 },
      { at: 45,  value: 6 },
      { at: 120, value: 8 },
    ],

    // Fill condition, part 2: what fraction of the seats must be sold. Busy
    // nights close on a lower fraction because the room is bigger and the next
    // show is right behind it.
    seatQuorum: [
      { at: 0,   value: 0.70 },
      { at: 15,  value: 0.75 },
      { at: 45,  value: 0.65 },
      { at: 120, value: 0.55 },
    ],

    // Hard floors. The House Manager may never plan a room smaller than this.
    minSeatsEver: 6,
    minFilmSlotsEver: 2,
  },

  /* -------------------------------------------------------------------------
   * 5. TIMING
   * ---------------------------------------------------------------------- */
  timing: {
    // Doors close -> showtime. Long enough to build anticipation, short enough
    // that a busy night can turn the room over.
    countdownMinutes: [
      { at: 0,   value: 30 },
      { at: 15,  value: 45 },
      { at: 45,  value: 20 },
      { at: 120, value: 8 },
    ],

    // A title card plays before each film in the reel.
    slateMs: 3500,

    // How long the Best Picture ballot stays open after the last frame.
    votingSeconds: 60,

    // How long the results stay on screen before the theater archives itself
    // and the next one opens its doors.
    resultsSeconds: 45,

    // Minimum wall-clock gap between one theater archiving and the next one
    // being allowed to close its doors. Stops a firehose of back-to-back shows.
    minGapBetweenShowsMinutes: [
      { at: 0,   value: 0 },
      { at: 45,  value: 0 },
      { at: 120, value: 0 },
    ],
  },

  /* -------------------------------------------------------------------------
   * 6. ANTI-STALL  — "a theater must never be visibly stuck"
   * Three escalating mechanisms, in order of severity.
   * ---------------------------------------------------------------------- */
  antiStall: {
    // (a) DECAY. If nothing has happened (no ticket, no approved film) for this
    // long, the requirements start dropping on a repeating timer.
    quietMinutesBeforeDecay: 6,
    decayEveryMinutes: 4,
    filmsDecayStep: 1,          // minFilms -= 1 each decay step
    seatQuorumDecayStep: 0.12,  // seatQuorum -= 0.12 each decay step
    minFilmsFloor: 1,           // never require fewer than one film
    seatQuorumFloor: 0.10,      // ...or fewer than 10% of the seats
    // Each decay step also MOVES THE SHOW TO A SMALLER HOUSE: the planned room
    // shrinks by this fraction. A big room that nobody came to becomes a small
    // room that is nearly full — which is both truer and better theatre than
    // leaving 200 empty seats on the screen.
    roomShrinkPerStep: 0.18,
    maxDecaySteps: 14,          // safety rail; by here the room is at its floor

    // (b) CONVERSION. Regardless of quiet time, once a theater has been open
    // this long AND has at least `minFilmsFloor` films, it stops waiting to
    // fill and simply schedules itself a showtime. Filling becomes optional.
    convertToScheduledAfterMinutes: [
      { at: 0,   value: 45 },
      { at: 15,  value: 60 },
      { at: 45,  value: 90 },
      { at: 120, value: 120 },
    ],

    // (c) OPEN CALL. A theater with zero films can't screen anything, so
    // instead of showing "waiting", the lobby flips to an OPEN CALL state: an
    // explicit, timed call for submissions pinned to the next guaranteed
    // showtime. If `houseReelFallback` is on, the House Manager will pull a
    // House Selection short from the reserve so the show goes on regardless.
    houseReelFallback: true,
  },

  /* -------------------------------------------------------------------------
   * 7. GUARANTEED SHOWTIMES
   * The promise: there is ALWAYS a show tonight, filled or not.
   * Times are local to the server, in 24h "HH:MM".
   * ---------------------------------------------------------------------- */
  guaranteed: {
    // Always fires, every day, whatever the traffic. Screens whatever it has
    // (minimum one film — see houseReelFallback above).
    daily: ['20:00'],

    // Extra guaranteed slots that only switch on once demand is high enough.
    // `minTicketsPerHour` is checked against the live demand signal.
    extra: [
      { at: '13:00', minTicketsPerHour: 45 },
      { at: '17:00', minTicketsPerHour: 45 },
      { at: '22:30', minTicketsPerHour: 45 },
      { at: '11:00', minTicketsPerHour: 120 },
      { at: '15:00', minTicketsPerHour: 120 },
      { at: '00:30', minTicketsPerHour: 120 },
    ],

    // How long before a guaranteed showtime the doors are locked. The
    // countdown page appears at this point no matter how empty the room is.
    doorsCloseBeforeMinutes: [
      { at: 0,   value: 20 },
      { at: 45,  value: 12 },
      { at: 120, value: 6 },
    ],

    // A guaranteed showtime inside this window of "right now" is considered
    // already missed and rolls to the next slot (protects against restarts).
    graceMinutes: 3,
  },

  /* -------------------------------------------------------------------------
   * 8. FAKE FULLNESS  (display only — never affects any real decision)
   * The seat map is a piece of theatre in itself. Five real people should feel
   * like a Friday night. Real attendance is NEVER surfaced as a number.
   * ---------------------------------------------------------------------- */
  fullness: {
    // displayed_fill = base + real_fill * slope   (then clamped, then jittered)
    // The brief's example curve is 0.60 + real * 0.40; these are nudged up so
    // that a handful of real people reads as a MOSTLY-FULL house rather than a
    // half-empty one. Drop base back to 0.60 for the literal example.
    base: 0.70,
    slope: 0.30,
    max: 0.97,               // always leave a few empty seats; a 100% room reads as fake
    min: 0.58,               // an empty room still looks like a decent turnout

    // Extras drift in over the life of the theater so the map visibly breathes:
    // the displayed fill ramps from `arrivalStart` of its target to 100% of it
    // over `arrivalRampMinutes`.
    arrivalStart: 0.55,
    arrivalRampMinutes: 12,

    // Once the doors are closed the house fills up to its final number.
    doorsClosedBoost: 0.08,

    // Tiny per-tick wobble so the map is never perfectly static.
    jitter: 0.015,
  },

  /* -------------------------------------------------------------------------
   * 9. TICKETS
   * ---------------------------------------------------------------------- */
  tickets: {
    audiencePriceCents: 100,      // $1 — payments are stubbed, nothing is charged
    encorePriceCents: 200,        // $2 — the encore button is a placeholder only
    // A rejected filmmaker is automatically comped into the next theater.
    compRejectedFilmmakers: true,
    // Filmmakers whose film did not make the reel roll over to the next one.
    carryOverUnscreenedFilms: true,
  },

  /* -------------------------------------------------------------------------
   * 10. SUBMISSIONS
   * ---------------------------------------------------------------------- */
  submissions: {
    minDurationSec: 15,
    maxDurationSec: 60,
    maxBytes: 50 * 1024 * 1024,   // ~50MB
    acceptMime: ['video/mp4', 'video/webm'],
    // Auto-approve when the moderation queue is drowning, so the loop never
    // blocks on a human. Set to null to disable.
    autoApproveIfQueueOlderThanMinutes: 90,
  },
};
