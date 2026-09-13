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
| Out front | <http://localhost:3000/> |
| Auditorium | <http://localhost:3000/house> |
| Submit a film | <http://localhost:3000/submit> |
| Hall of Fame | <http://localhost:3000/hall> |
| Your stubs | <http://localhost:3000/me> |
| Moderation desk | <http://localhost:3000/admin> — key `popcorn` |

## Standing outside

The front page is not a dashboard, it is a place, and it is first person: you are standing in
front of a painted cinema at dusk — a lit marquee, two shop windows with poster frames in them, a
ticket window between the doors, and the doors themselves with light behind them. There is no
figure of you and no pavement; the picture is what you see.

There are exactly two ways in, and both of them walk you through those doors:

- **Drop a film into an empty poster frame.** Drag a video anywhere onto the facade, or click an
  empty frame. It is checked in the browser (mp4/webm, 15–60s, ≤50MB), you name it, and it goes up
  in the frame as a poster while the moderation desk looks at it. Your filmmaker seat is held from
  that moment.
- **Buy a seat at the window.** Click the box office, pay the stub $1, done.

Either way the camera pushes through the door — the whole front swells around the doorway, the
light in it floods, the wipe takes over — and you come up inside the auditorium, the view settling
into your seat, facing the screen. Before the show the screen shows the house slate and the
countdown to curtain, with the room's chat beside you.

The building is the status display, so there is nothing else to read: the marquee says what is
happening, the board between the doors counts down to curtain, the frames in the windows are the
programme, the shutter comes down over the kiosk when the doors close, and light spills onto the
pavement while a film is running. During the screening the film plays inside the painted screen
of an illustrated auditorium, with roses and tomatoes flying over the audience in front of it.

### No menu

There is no navigation bar — it made the place feel like a website. Everything is painted on:

| To get to… | Do this |
|---|---|
| the auditorium | through the doors (buy a seat at the ticket window, hang a poster, or click the doors) |
| the full submission form | the brass **SUBMISSIONS →** plaque under the ticket window |
| the Hall of Fame | the pink neon **HALL OF FAME** sign on the building's flank |
| your ticket stubs | the ticket tucked under the marquee at the left |
| back outside | the lit green **EXIT** sign, top-left, on every page that isn't the street |

### Vibes

The psychedelia has a switch plate on the wall, bottom-left of the building: *house lights*,
*trippy* (default) and *cosmic*. It drives one CSS variable, `--trip`, which scales every effect:
coloured gels washing over the whole front, searchlights sweeping from behind the building, the
picture breathing through the spectrum (a full hue spin on *cosmic*), bulbs chasing colour round
the marquee, a moving gradient with split ghosts in the lettering, the door light and the neon
cycling, nebulae behind the page, and inside, the hue-drift on the curtains and the prismatic
projector beam. The film itself is never touched — the drift layer sits beneath the picture. The
setting is remembered per browser.

## The art

The scene plates are licensed Adobe Stock vector illustrations (free
collection, standard license), pulled through the Adobe connector, rasterised with Ghostscript
and reworked in Pillow/NumPy — nothing was hand-drawn and no generative model was used:

| File | Source | What was done |
|---|---|---|
| `public/art/facade.jpg` | Adobe Stock #426627839, *Cinema building vector illustration on background of city at night* | rendered from the .ai, right half mirrored from the left to remove the parked cars, cropped to the theater block, night-graded (windows kept lit) |
| `public/art/auditorium.jpg` | Adobe Stock #304236895, *Audience sitting in a vintage cinema theatre* | rendered from the .ai, blue room re-hued to the house purple |

The interactive hotspots (`public/css/street.css`) are percentages measured off the plate, so the
clickable doors, windows and board stay glued to the painting at any width. A Canva-generated
"Next Attraction" placeholder poster was also produced but could not be exported from this
environment; the design lives at <https://www.canva.com/d/AH4T4FIhrlSdBJf>.

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

The house is never shown empty. Real attendees are seated among ambient extras using the curve in
`policy.js` (`fullness`) — five real people read as a mostly-full house — and the attendee list in
the auditorium is drawn from that mix, real names and extras shuffled together. The API ships a
seat grid of occupied/empty plus your own seat index and nothing else, so nothing distinguishes a
real patron from an extra and no raw attendance count is ever exposed. (The seat map itself is no
longer drawn on screen; the data stays in the payload for the same reason.)

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
public/
  street.html      ← out front: marquee, poster frames, box office, doors
  house.html       ← the auditorium: countdown, screening, ballot, verdict
  js/slate.js      ← procedural films, title cards and poster art
  art/             ← the licensed scene plates
  …                ← submit, hall of fame, profile, moderation desk
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
