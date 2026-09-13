/* Shared client runtime: server clock sync, state socket, seat map, chrome. */

/* ---------- tiny helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function toast(msg, bad = false) {
  let box = $('#toasts');
  if (!box) { box = el('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = el('div', 'toast' + (bad ? ' bad' : ''), msg);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 4200);
  setTimeout(() => t.remove(), 4700);
}

/* ---------- time ---------- */
function clockString(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
function timeOfDay(ts) {
  if (!ts) return '--:--';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function dayAndTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const STATE_COPY = {
  OPEN_CALL:    { label: 'Open call',   pill: 'warn', line: 'The house is taking submissions. The doors stay open until there is a programme.' },
  FILLING:      { label: 'Filling',     pill: '',     line: 'Tickets are on sale. When the house is ready, the doors close and the clock starts.' },
  DOORS_CLOSED: { label: 'Doors closed',pill: 'warn', line: 'No more tickets for this one. Showtime is set.' },
  SHOWING:      { label: 'Now showing', pill: 'live', line: 'One time only. No pause, no scrub, no replay.' },
  VOTING:       { label: 'Balloting',   pill: 'live', line: 'Best Picture. You have sixty seconds.' },
  RESULTS:      { label: 'Results',     pill: 'ok',   line: 'The winner is entering the Hall of Fame. Everything else becomes a statistic.' },
  ARCHIVED:     { label: 'Archived',    pill: '',     line: 'This house is closed.' },
};

/* =============================================================================
 * THE HALL — websocket client with a server-authoritative clock.
 * The server's `now` is the only truth; we keep a rolling offset so
 * `hall.now()` returns server time even if the local clock is wrong.
 * ========================================================================== */
class Hall {
  constructor(page) {
    this.page = page;
    this.handlers = {};
    this.offset = 0;
    this.samples = [];
    this.state = null;
    this.connect();
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.send({ t: 'hello', page: this.page });
      this.ping();
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this.ping(), 5000);
      this.emit('open');
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'pong') return this.onPong(msg);
      if (msg.t === 'clock') return this.onClock(msg.now);
      if (msg.t === 'state') { this.state = msg; this.onClock(msg.serverNow); }
      this.emit(msg.t, msg);
    };
    this.ws.onclose = () => {
      clearInterval(this._pingTimer);
      this.emit('close');
      setTimeout(() => this.connect(), 1200);
    };
    this.ws.onerror = () => this.ws.close();
  }
  ping() { this._pingSent = performance.now(); this.send({ t: 'ping', c: Date.now() }); }
  onPong(msg) {
    const rtt = performance.now() - this._pingSent;
    // Assume symmetric latency: server time at receipt ≈ msg.now + rtt/2.
    const offset = msg.now + rtt / 2 - Date.now();
    this.samples.push(offset);
    if (this.samples.length > 9) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.offset = sorted[Math.floor(sorted.length / 2)];   // median beats mean here
  }
  onClock(serverNow) {
    // Coarse correction between pings; never fights the ping-derived offset.
    if (!this.samples.length) this.offset = serverNow - Date.now();
  }
  now() { return Date.now() + this.offset; }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  emit(type, payload) { for (const fn of this.handlers[type] || []) fn(payload); }
}

/* =============================================================================
 * SEAT MAP
 * The server sends a grid of 1s and 0s plus your own seat. It does not send —
 * and cannot be asked for — how many of those seats hold real people.
 * ========================================================================== */
function renderSeatMap(container, seatMap) {
  const sig = seatMap.rows.map((r) => r.length).join(',');
  if (container.dataset.sig !== sig) {
    container.dataset.sig = sig;
    container.innerHTML = '';
    let idx = 0;
    for (const row of seatMap.rows) {
      const rowEl = el('div', 'seat-row');
      for (let c = 0; c < row.length; c++) {
        const s = el('div', 'seat');
        s.dataset.i = idx++;
        rowEl.appendChild(s);
      }
      container.appendChild(rowEl);
    }
  }
  const flat = seatMap.rows.flat();
  $$('.seat', container).forEach((s, i) => {
    const you = i === seatMap.youIndex;
    s.className = 'seat' + (flat[i] ? ' taken' : '') + (you ? ' you' : '');
    s.title = you ? 'You are here' : '';
  });
}

/* ---------- chrome ---------- */
function mountChrome(active) {
  const header = el('header', 'top');
  header.innerHTML = `
    <a class="brand" href="/">
      <span class="bulbs"><i class="bulb"></i><i class="bulb"></i><i class="bulb"></i><i class="bulb"></i><i class="bulb"></i></span>
      <h1>The Theater</h1>
    </a>
    <nav class="top-nav">
      <a href="/" data-k="lobby">Lobby</a>
      <a href="/house" data-k="house">Auditorium</a>
      <a href="/submit" data-k="submit">Submit a film</a>
      <a href="/hall" data-k="hall">Hall of Fame</a>
      <a href="/me" data-k="me">Your stubs</a>
    </nav>`;
  document.body.prepend(header);
  const on = header.querySelector(`[data-k="${active}"]`);
  if (on) on.classList.add('on');
}

function marqueeText(state) {
  if (!state || !state.marquee) return 'Tonight: a show, whether or not the house fills.';
  const at = timeOfDay(state.marquee.at);
  const when = new Date(state.marquee.at).toDateString() === new Date().toDateString() ? 'Tonight' : 'Tomorrow';
  return `${when} at <b>${at}</b> — guaranteed showtime. It screens whatever it has.`;
}
