/* =============================================================================
 * THE AUDITORIUM
 * Countdown, the synced screening, reactions, the ballot and the verdict.
 *
 * SYNC MODEL: the server owns the clock and the running order. The client
 * renders `serverNow - startedAt` and nothing else. There is no play button,
 * no seek bar, and any drift is corrected against the server's timeline — so a
 * late arrival drops straight into the middle of the film everyone else is
 * already watching.
 * ========================================================================== */
mountChrome('house');

const hall = new Hall('house');
const video = $('#video');
const canvas = $('#canvas');
const overlay = $('#overlay');

let S = null;              // latest state
let currentEntry = null;   // reel entry on screen
let localTallies = {};     // optimistic reaction counts between state pushes
let soundOn = false;

hall.on('state', (s) => { S = s; render(s); });
hall.on('chat', (m) => appendChat(m.msg));
hall.on('react', (r) => { throwThing(r); bump(r.filmId, r.kind); });
hall.on('transition', (t) => {
  if (t.state === 'SHOWING') toast('House lights down.');
  if (t.state === 'VOTING') toast('Ballot is open — 60 seconds.');
  if (t.state === 'RESULTS') toast('The verdict is in.');
});

/* ---------------------------------------------------------------------------
 * Layout per phase
 * ------------------------------------------------------------------------ */
function render(s) {
  const st = s.theater.state;
  const copy = STATE_COPY[st] || STATE_COPY.FILLING;
  $('#marquee').innerHTML = marqueeText(s);
  $('#theater-no').textContent = `Theater #${s.theater.number}`;
  $('#state-pill').textContent = copy.label;
  $('#state-pill').className = 'pill ' + copy.pill;

  const showing = st === 'SHOWING';
  $('#pre').style.display = ['FILLING', 'OPEN_CALL', 'DOORS_CLOSED'].includes(st) ? '' : 'none';
  $('#showing').style.display = showing ? '' : 'none';
  $('#voting').style.display = st === 'VOTING' ? '' : 'none';
  $('#results').style.display = st === 'RESULTS' ? '' : 'none';
  $('#house-panel').style.display = s.house ? '' : 'none';
  // The painted house wants the whole width while the reel is rolling.
  $('.grid').classList.toggle('showing', showing);
  $('#chat-title').textContent = showing ? 'The room' : st === 'VOTING' ? 'Closing arguments' : 'Hype';

  if (s.house) {
    const box = $('#house-list');
    box.innerHTML = '';
    for (const name of s.house.list) {
      const tag = el('span', null, name);
      box.appendChild(tag);
    }
  }

  renderPre(s);
  renderCountdown(s);
  renderProgramme(s);
  if (st === 'VOTING') renderBallot(s);
  if (st === 'RESULTS') renderResults(s);
}

function renderPre(s) {
  const st = s.theater.state;
  renderSeatMap($('#seatmap'), s.seatMap, `t${s.theater.number}`);
  const mine = $('.seat.you', $('#seatmap'));
  if (mine) { mine.title = 'Your seat — tap for your stubs'; mine.onclick = () => { location.href = '/me'; }; }
  arrivalWalk(s);
  $('#mood').textContent = s.seatMap.mood;
  const actions = $('#pre-actions');
  actions.innerHTML = '';
  if (st === 'DOORS_CLOSED') {
    $('#pre-note').textContent = s.you.ticket
      ? 'You are seated. Stay here — the reel starts on its own.'
      : 'Ticketless, but you may watch from the back. The doors are closed for this one.';
  } else {
    $('#pre-note').textContent = st === 'OPEN_CALL'
      ? 'No programme yet. The frames out front are empty — there is a guaranteed showtime regardless.'
      : 'Still filling. Buy a seat at the window out front, or wait here.';
    const a = el('a', 'btn', 'Back outside');
    a.href = '/';
    actions.appendChild(a);
    const b = el('a', 'btn ghost', 'Submit a film');
    b.href = '/submit';
    actions.appendChild(b);
  }
}

/* The clock on the wall before the show. Server time, not local time. */
function renderCountdown(s) {
  clearInterval(window._cd);
  const node = $('#countdown');
  const sub = $('#countdown-sub');
  if (s.theater.state !== 'DOORS_CLOSED') {
    node.style.display = 'none';
    sub.textContent = '';
    return;
  }
  node.style.display = '';
  const tick = () => {
    const left = s.theater.showtimeAt - hall.now();
    node.textContent = clockString(left);
    node.classList.toggle('urgent', left < 60000);
    sub.textContent = left > 0
      ? `until showtime · ${timeOfDay(s.theater.showtimeAt)}${s.theater.guaranteed ? ' · guaranteed' : ''}`
      : 'the reel is starting';
  };
  tick();
  window._cd = setInterval(tick, 250);
}

function renderProgramme(s) {
  const ul = $('#programme');
  const entries = s.reel ? s.reel.entries : s.programme.map((p) => ({ ...p, filmId: p.id }));
  const sig = entries.map((e) => e.filmId).join(',') + s.theater.state;
  if (ul.dataset.sig === sig) return;
  ul.dataset.sig = sig;
  ul.innerHTML = '';
  entries.forEach((e) => {
    const li = el('li');
    li.dataset.film = e.filmId;
    li.appendChild(el('span', 'film-no', String(e.order).padStart(2, '0')));
    const box = el('div');
    box.appendChild(el('span', 'film-title', e.title));
    box.appendChild(el('div', 'film-by', `by ${e.by}`));
    li.appendChild(box);
    ul.appendChild(li);
  });
}

/* ---------------------------------------------------------------------------
 * TAKING YOUR SEAT
 * You came through the doors from the street, so you walk down the aisle and
 * sit in the chair the box office gave you. Purely cosmetic; nothing waits.
 * ------------------------------------------------------------------------ */
let arrived = false;
async function arrivalWalk(s) {
  if (arrived || !new URLSearchParams(location.search).has('arrive')) return;
  if (s.seatMap.youIndex < 0 || $('#pre').style.display === 'none') return;
  arrived = true;
  history.replaceState({}, '', '/house');

  const stage = $('#seatmap');
  const seat = $$('.seat', stage)[s.seatMap.youIndex];
  if (!seat) return;
  const sr = stage.getBoundingClientRect(), tr = seat.getBoundingClientRect();

  const me = Avatar.make(s.you.id || 'you', { you: true, scale: 0.62, label: 'you' });
  me.id = 'aisle-walker';
  stage.appendChild(me);
  seat.style.visibility = 'hidden';

  const from = { x: sr.width / 2 - 8, y: sr.height + 14 };
  const to = { x: tr.left - sr.left + tr.width / 2 - 8, y: tr.top - sr.top - 22 };
  toast('Down the aisle — the gold seat is yours.');
  await Avatar.walk(me, from, to, { duration: 1500 });
  seat.style.visibility = '';
  me.style.transition = 'opacity .4s';
  me.style.opacity = '0';
  setTimeout(() => me.remove(), 450);
}

/* ---------------------------------------------------------------------------
 * THE SCREEN — one animation frame loop, driven entirely by server time.
 * ------------------------------------------------------------------------ */
function frame() {
  requestAnimationFrame(frame);
  if (!S || S.theater.state !== 'SHOWING' || !S.reel) return;

  const t = hall.now() - S.theater.startedAt;
  const reel = S.reel;
  $('#reel-bar').style.width = `${Math.max(0, Math.min(100, (t / reel.totalMs) * 100))}%`;

  if (t < 0) return leader(-t);

  const entry = reel.entries.find((e) => t >= e.startAt && t < e.endAt);
  if (!entry) return fin();

  if (entry !== currentEntry) {
    currentEntry = entry;
    $('#ns-title').textContent = entry.title;
    $('#ns-label').textContent = `Film ${entry.order} of ${reel.entries.length} · by ${entry.by}`;
    $$('#programme li').forEach((li) => {
      li.style.opacity = li.dataset.film === entry.filmId ? '1' : '.45';
    });
    if (entry.kind === 'upload') {
      video.src = entry.src;
      video.load();
    } else {
      video.removeAttribute('src');
      video.load();
    }
    updateTally();
  }

  const local = t - entry.startAt;
  if (local < entry.slateMs) {
    video.style.display = 'none';
    canvas.style.display = '';
    Slate.title(canvas, entry, local, S.theater.number);
    return;
  }

  const want = (local - entry.slateMs) / 1000;
  if (entry.kind === 'upload') {
    canvas.style.display = 'none';
    video.style.display = '';
    // The server's timeline is the truth; nudge the element back onto it.
    if (Math.abs(video.currentTime - want) > 0.75 && isFinite(video.duration || 0)) {
      video.currentTime = Math.min(want, Math.max(0, (video.duration || want) - 0.05));
    }
    if (video.paused) video.play().catch(() => {});
  } else {
    video.style.display = 'none';
    canvas.style.display = '';
    Slate.film(canvas, entry, local - entry.slateMs);
  }
}

function leader(msUntil) {
  video.style.display = 'none';
  canvas.style.display = '';
  const ctx = canvas.getContext('2d');
  const { w, h } = Slate.fit(canvas);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.fillStyle = '#e8c07d';
  ctx.font = `${Math.round(h * 0.3)}px ui-monospace, monospace`;
  ctx.fillText(String(Math.ceil(msUntil / 1000)), w / 2, h * 0.6);
  ctx.strokeStyle = 'rgba(232,192,125,.3)'; ctx.lineWidth = h * 0.006;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h * 0.34, -Math.PI / 2, -Math.PI / 2 + 6.283 * ((msUntil % 1000) / 1000));
  ctx.stroke();
}

function fin() {
  video.style.display = 'none';
  canvas.style.display = '';
  const ctx = canvas.getContext('2d');
  const { w, h } = Slate.fit(canvas);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f4ece2';
  ctx.font = `${Math.round(h * 0.13)}px Georgia, serif`;
  ctx.fillText('FIN', w / 2, h * 0.55);
}
requestAnimationFrame(frame);

/* No pause, no scrub — the controls simply do not exist. */
video.addEventListener('pause', () => { if (S && S.theater.state === 'SHOWING') video.play().catch(() => {}); });
video.addEventListener('contextmenu', (e) => e.preventDefault());

$('#sound').onclick = () => {
  soundOn = !soundOn;
  video.muted = !soundOn;
  if (soundOn) video.play().catch(() => {});
  $('#sound').textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off';
};

/* ---------------------------------------------------------------------------
 * THROWABLES
 * ------------------------------------------------------------------------ */
$('#throw-rose').onclick = () => hall.send({ t: 'react', kind: 'rose' });
$('#throw-tomato').onclick = () => hall.send({ t: 'react', kind: 'tomato' });
document.addEventListener('keydown', (e) => {
  if (/input|textarea/i.test(document.activeElement.tagName)) return;
  if (e.key === 'r') hall.send({ t: 'react', kind: 'rose' });
  if (e.key === 't') hall.send({ t: 'react', kind: 'tomato' });
});

function throwThing(r) {
  const box = overlay.getBoundingClientRect();
  const node = el('div', 'projectile', r.kind === 'rose' ? '🌹' : '🍅');
  node.style.left = `${r.x * (box.width - 40)}px`;
  node.style.top = `${box.height - 20}px`;
  overlay.appendChild(node);
  const driftX = (Math.random() - 0.5) * box.width * 0.4;
  const rise = -(box.height * (0.45 + Math.random() * 0.4));
  node.animate([
    { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
    { transform: `translate(${driftX * 0.6}px, ${rise}px) rotate(${r.spin * 260}deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${driftX}px, ${rise * 0.25}px) rotate(${r.spin * 520}deg)`, opacity: 0 },
  ], { duration: 1600 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)' })
    .onfinish = () => node.remove();
}

function bump(filmId, kind) {
  localTallies[filmId] ||= { roses: 0, tomatoes: 0 };
  localTallies[filmId][kind === 'rose' ? 'roses' : 'tomatoes']++;
  updateTally();
}

function updateTally() {
  if (!S || !currentEntry) return;
  const base = (S.tallies || {})[currentEntry.filmId] || { roses: 0, tomatoes: 0 };
  const extra = localTallies[currentEntry.filmId] || { roses: 0, tomatoes: 0 };
  const roses = Math.max(base.roses, extra.roses);
  const tomatoes = Math.max(base.tomatoes, extra.tomatoes);
  $('#tally').innerHTML = `<span>🌹 ${roses}</span><span>🍅 ${tomatoes}</span><span class="tiny">press R or T</span>`;
}
setInterval(() => { localTallies = {}; updateTally(); }, 6000);

/* ---------------------------------------------------------------------------
 * BALLOT
 * ------------------------------------------------------------------------ */
function renderBallot(s) {
  const box = $('#ballot');
  const sig = (s.ballot || []).map((b) => b.filmId).join(',');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.innerHTML = '';
    for (const b of s.ballot || []) {
      const btn = el('button');
      btn.dataset.film = b.filmId;
      btn.innerHTML = `<span class="bt">${b.title}</span><span class="bb">film ${b.order} · by ${b.by}</span>`;
      btn.onclick = () => { hall.send({ t: 'vote', filmId: b.filmId }); toast(`Ballot cast for “${b.title}”.`); };
      box.appendChild(btn);
    }
  }
  $$('#ballot button').forEach((b) => b.classList.toggle('chosen', b.dataset.film === s.you.votedFilmId));

  clearInterval(window._vt);
  const tick = () => {
    const left = Math.max(0, s.theater.votingEndsAt - hall.now());
    $('#vote-clock').textContent = Math.ceil(left / 1000);
    $('#vote-clock').classList.toggle('urgent', left < 15000);
  };
  tick();
  window._vt = setInterval(tick, 200);
}

function renderResults(s) {
  const winner = (s.results || []).find((r) => r.winner);
  $('#winner-box').innerHTML = winner ? `
    <div class="center" style="padding:14px 0 22px">
      <div class="laurel">Best Picture · Theater #${s.theater.number}</div>
      <div style="font-family:var(--serif);font-size:32px;color:var(--gold);margin:8px 0">${winner.title}</div>
      <div class="muted">by ${winner.by} · 🌹 ${winner.roses} · 🍅 ${winner.tomatoes}</div>
      <p class="lede tiny">Kept forever in the Hall of Fame. Every other print is struck.</p>
    </div>` : '<p class="lede">No ballots were cast.</p>';

  $('#results-list').innerHTML = (s.results || []).map((r) => `
    <div class="result-row${r.winner ? ' winner' : ''}">
      <span class="film-no">${String(r.order).padStart(2, '0')}</span>
      <div><div class="film-title">${r.title}</div><div class="film-by">by ${r.by}</div></div>
      <div class="result-stats"><span>🗳 ${r.votes}</span><span>🌹 ${r.roses}</span><span>🍅 ${r.tomatoes}</span></div>
    </div>`).join('');
}

/* ---------------------------------------------------------------------------
 * CHAT
 * ------------------------------------------------------------------------ */
const seen = new Set();
function appendChat(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  const log = $('#chat-log');
  const mine = S && S.you.id === m.userId;
  const node = el('div', 'chat-msg' + (mine ? ' mine' : ''));
  node.appendChild(el('b', null, `${m.handle} `));
  node.appendChild(document.createTextNode(m.body));
  log.appendChild(node);
  while (log.children.length > 120) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

$('#chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const body = input.value.trim();
  if (!body) return;
  hall.send({ t: 'chat', body });
  input.value = '';
};

api('/api/chat').then((d) => d.messages.forEach(appendChat)).catch(() => {});
