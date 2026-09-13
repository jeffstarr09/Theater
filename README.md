# The Theater

User-submitted short films premiere in scheduled, synchronized, **one-time-only** screenings.

A theater fills with ticket holders. When the house is ready the doors close, a public countdown
starts, and at showtime everybody watches the same reel at the same second — no pause, no scrub,
no replay. Afterwards the audience votes Best Picture. The winner is kept forever in the Hall of
Fame; every other print is struck and survives only as a line in the Necrology.

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

That is the whole setup. On first boot it seeds itself with two past theaters, a Hall of Fame, a
house already filling, a crowd, and a film waiting at the moderation desk.

| | |
|---|---|
| Lobby | <http://localhost:3000/> |
| Auditorium | <http://localhost:3000/house> |
| Submit a film | <http://localhost:3000/submit> |
| Hall of Fame | <http://localhost:3000/hall> |
| Your stubs | <http://localhost:3000/me> |
| Moderation desk | <http://localhost:3000/admin> — key `popcorn` |

## Demo the whole loop in two minutes

Click **DEV** (bottom right, or press <kbd>D</kbd>) on any page.

1. **Fill theater** — fake films and patrons until the fill condition is met. The House Manager
   closes the doors on its own within a second.
2. **Start show NOW** — jumps the countdown. You land in the auditorium mid-reel.
3. **Throw 10** / <kbd>R</kbd> / <kbd>T</kbd> — roses and tomatoes fly across the screen for
   everyone, tallied per film.
4. **Open ballot** → **Fake ballots** → **Crown winner** — Best Picture, then the verdict.
5. **Next theater** — archives the house and opens the next one. Check the Hall of Fame.

Also worth pressing:

- **Guaranteed in 60s** — schedules a guaranteed showtime a minute out. If nothing has been
  submitted, the House Manager pulls a House Selection short from the reserve so the show still
  happens.
- **Traffic: dark / low / normal / high / peak** — injects synthetic demand. Watch the readout:
  the room, the film slots, the fill condition and the countdown all resize.

Open a second browser window on `/house` during a screening to see the sync — both are driven by
the server's clock, and a window opened late drops straight into the middle of the film.

## The House Manager

`server/houseManager.js` is an autonomous server-side module that owns every pacing decision.
Nothing about theater size, fill requirements or timing is hardcoded: it measures demand and
computes the numbers each tick.

- **Demand** — exponentially-weighted tickets/hour and submissions/hour, plus the real attendance
  rate over recent theaters (used to oversell seats when no-shows are common).
- **Shape** — seats, filmmaker slots, minimum films and seat quorum are all sampled from curves.
- **Timing** — countdown length, ballot window and turnaround shorten as traffic rises.
- **Guaranteed showtimes** — 8pm every day, whatever happens, plus extra slots that switch on at
  higher traffic. It screens whatever it has, minimum one film.
- **Never stuck** — three escalating mechanisms:
  1. *decay* — a quiet house drops its requirements on a timer;
  2. *smaller room* — each decay step also moves the show to a smaller house, so an empty 200-seat
     room becomes a nearly-full 30-seat one;
  3. *conversion* — past a certain age it stops waiting to fill and just schedules itself a
     showtime. A house with no programme at all shows as an **Open Call** pinned to the next
     guaranteed showtime, never as a stalled theater.

**Every parameter lives in [`server/policy.js`](server/policy.js)**, heavily commented, as curves
you can bend. Nothing else in the codebase carries a pacing constant.

## Fake fullness

The seat map is theatre in itself. Real attendees are seated among ambient extras using the curve
in `policy.js` (`fullness`) — five real people read as a mostly-full house. The payload sent to
browsers is a grid of occupied/empty plus *your own* seat, which is drawn in gold; nothing in the
API distinguishes a real patron from an extra, and no raw attendance count is ever exposed.

## How the sync works

The server freezes a running order at doors-close: each film gets a title card and a slot on one
timeline. During the show the only thing a client does is compute `serverNow - startedAt` and
render whatever that instant says it should be — a title card, or a film at a given offset. Clients
keep a median-filtered clock offset from websocket pings, so a wrong local clock does not matter.
Video drift over 0.75s is corrected against the server timeline, pausing re-plays immediately, and
there are no controls to scrub with.

Demo films are **slates**: procedurally drawn on a canvas from a seed, where every frame is a pure
function of elapsed time — so they stay in sync for exactly the same reason a real video does. Real
uploads and the seeded `assets/demo` clips play through `<video>` on the identical timeline.

## Stack

Node + Express + `ws` + SQLite (better-sqlite3), and plain HTML/CSS/JS on the front end — no build
step, no bundler. Videos are stored as files under `data/videos`.

```
server/
  policy.js        ← every tunable number, commented
  houseManager.js  ← the autonomous pacing module
  seats.js         ← fake fullness / seat map
  state.js         ← the one public view of the building
  realtime.js      ← websockets: clock, chat, reactions, ballot
  routes.js        ← REST, uploads, moderation, DEV panel
  seed.js          ← demo data
public/            ← lobby, auditorium, submit, hall, profile, admin
assets/demo/       ← three short clips used to seed real video
```

## Notes on the stubs

- **Payments are fake.** The $1 audience ticket opens a stub checkout that accepts any card-shaped
  number, charges nothing and stores nothing.
- **Encore** is a deliberate placeholder: the button on a Hall of Fame card returns "not yet on
  sale" and does nothing else.
- **Moderation** is protected by a single shared key (`ADMIN_KEY`, default `popcorn`), which is
  appropriate for a prototype and nothing more.
- Film duration is measured in the browser and trusted by the server, which is fine here and would
  not be in production.

## Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `ADMIN_KEY` | `popcorn` | moderation desk key |
| `THEATER_DEV` | on | set to `off` to remove the DEV panel and its endpoints |
| `THEATER_DATA_DIR` | `./data` | database and video storage |
| `THEATER_START_NUMBER` | `100` | first theater number |

`npm run seed` reseeds the demo data (wiping what is there); `npm run reset` does the same.
