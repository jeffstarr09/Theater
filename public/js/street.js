/* =============================================================================
 * OUTSIDE THE THEATER
 * You are a person standing on a sidewalk. Above you is a lit marquee; in front
 * of you are the poster frames, the box office window and the doors.
 *
 * There are exactly two ways in, and both of them walk you through the doors:
 *   - drop a film into an empty poster frame  → filmmaker ticket
 *   - buy a seat at the window                → audience ticket
 * ========================================================================== */
mountChrome('street');

const hall = new Hall('street');
let S = null;
let you = null;              // your avatar on the sidewalk
let crowdSeed = null;
let entering = false;
const posterCache = new Map();

hall.on('state', (s) => { S = s; render(s); });
hall.on('transition', (t) => {
  if (t.state === 'SHOWING') toast('The doors are open — it has started.');
  if (t.state === 'DOORS_CLOSED') toast('Doors closed. Showtime is set.');
});

/* ---------------------------------------------------------------------------
 * THE FACADE
 * ------------------------------------------------------------------------ */
const SIGN = {
  OPEN_CALL:    ['OPEN CALL', 'filling'],
  FILLING:      ['NOW FILLING', 'filling'],
  DOORS_CLOSED: ['DOORS CLOSED', ''],
  SHOWING:      ['NOW SHOWING', ''],
  VOTING:       ['BALLOT OPEN', ''],
  RESULTS:      ['THE VERDICT', ''],
};

function render(s) {
  const st = s.theater.state;
  const [word, cls] = SIGN[st] || SIGN.FILLING;
  $('#sign-now').textContent = `${word} · THEATER #${s.theater.number}`;
  $('#sign-now').className = 'sign-now ' + cls;
  renderSignWhen(s);
  renderPosters(s);
  renderBoxOffice(s);
  renderEntrance(s);
  renderPlacard(s);
  renderSidewalk(s);
  renderBill(s);
}

function renderSignWhen(s) {
  clearInterval(window._signTimer);
  const node = $('#sign-when');
  if (s.theater.state === 'DOORS_CLOSED') {
    const tick = () => {
      const left = s.theater.showtimeAt - hall.now();
      node.innerHTML = left > 0
        ? `Curtain in <span class="sign-clock">${clockString(left)}</span>`
        : '<span class="sign-clock">rolling</span>';
    };
    tick();
    window._signTimer = setInterval(tick, 250);
  } else if (s.theater.state === 'SHOWING') {
    node.innerHTML = 'In progress — <span class="sign-clock">walk in late, it does not wait</span>';
  } else if (s.marquee) {
    const today = new Date(s.marquee.at).toDateString() === new Date().toDateString();
    node.innerHTML = `${today ? 'Tonight' : 'Tomorrow'} at <span class="sign-clock">${timeOfDay(s.marquee.at)}</span> — guaranteed`;
  } else {
    node.textContent = '';
  }
}

/* ---------- poster frames: the programme, and the way in for filmmakers ---- */
function renderPosters(s) {
  const wall = $('#posters');
  const entries = s.reel ? s.reel.entries.map((e) => ({
    filmId: e.filmId, title: e.title, by: e.by, order: e.order, slate: e.slate,
  })) : s.programme.map((p) => ({ filmId: p.id, title: p.title, by: p.by, order: p.order }));

  const open = ['FILLING', 'OPEN_CALL'].includes(s.theater.state);
  const mine = s.you.submission;
  const pending = mine && mine.status === 'pending' ? mine : null;
  const slots = Math.max(s.slots.total, entries.length + (open ? 1 : 0));

  const sig = entries.map((e) => e.filmId).join(',') + `|${slots}|${open}|${pending ? pending.id : ''}`;
  if (wall.dataset.sig === sig) return;
  wall.dataset.sig = sig;
  wall.innerHTML = '';

  for (const e of entries) wall.appendChild(filledFrame(e, s));
  if (pending) wall.appendChild(filledFrame(
    { filmId: pending.id, title: pending.title, by: 'you', order: null }, s, 'at the desk',
  ));
  if (open) {
    const empties = Math.max(1, Math.min(slots - entries.length, 4));
    for (let i = 0; i < empties; i++) wall.appendChild(emptyFrame());
  }
}

function filledFrame(entry, s, badge) {
  const frame = el('div', 'poster-frame');
  const canvas = el('canvas');
  frame.appendChild(canvas);
  const plate = el('div', 'poster-plate', entry.title);
  frame.appendChild(plate);
  if (badge) frame.classList.add('mine');
  // Canvases need a layout pass before they know how big they are.
  requestAnimationFrame(() => Slate.poster(canvas, entry, { order: entry.order, badge }));
  posterCache.set(entry.filmId, canvas);
  frame.title = `${entry.title} — by ${entry.by}`;
  return frame;
}

function emptyFrame() {
  const frame = el('div', 'poster-frame empty');
  frame.innerHTML = '<span class="plus">+</span><span>drop a film here<br>15–60s · mp4 / webm</span>';
  frame.onclick = () => pickFile();
  frame.ondragover = (e) => { e.preventDefault(); frame.classList.add('drag-over'); };
  frame.ondragleave = () => frame.classList.remove('drag-over');
  frame.ondrop = (e) => {
    e.preventDefault();
    frame.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) offerFilm(file, frame);
  };
  return frame;
}

/* ---------- the window ---------- */
function renderBoxOffice(s) {
  const bo = $('#box-office');
  const open = ['FILLING', 'OPEN_CALL'].includes(s.theater.state);
  const ticket = s.you.ticket;
  $('#bo-price').textContent = `$${(s.prices.audienceCents / 100).toFixed(2)}`;
  bo.classList.toggle('closed', !open);
  if (ticket) {
    $('#bo-note').textContent = 'you have a ticket';
  } else if (open) {
    $('#bo-note').textContent = 'one seat, please';
  } else {
    $('#bo-note').textContent = 'window closed';
  }
  bo.onclick = () => {
    if (!open) return toast('The window is shut for this one. The next house opens shortly.');
    if (ticket) return toast('You are already holding a ticket. Walk in.');
    checkout(s);
  };
}

/* ---------- the doors ---------- */
function renderEntrance(s) {
  const door = $('#entrance');
  const st = s.theater.state;
  const ticket = s.you.ticket;
  const showing = ['SHOWING', 'VOTING', 'RESULTS'].includes(st);
  door.classList.toggle('open', showing || !!ticket);
  $('#door-label').textContent = showing
    ? (ticket ? 'in progress — go in' : 'in progress — watch from the back')
    : ticket ? 'this way to your seat' : 'ticket holders only';
  door.onclick = () => enterTheater(ticket ? 'to your seat' : 'this way');
}

/* ---------- the placard by the door ---------- */
function renderPlacard(s) {
  const st = s.theater.state;
  const ticket = s.you.ticket;
  const box = $('#placard');
  let head = 'Tonight', body = '';
  if (ticket) {
    head = 'Your ticket';
    body = `<p class="big">${ticket.kind === 'FILMMAKER' ? 'Filmmaker' : 'Audience'}</p>
      <p>${ticket.source === 'comp_rejected'
        ? 'Comped after your last submission was turned down.'
        : 'Seat held. Your chair is the gold one.'}</p>
      <p>Walk in whenever you like — the doors are open to you.</p>`;
  } else if (st === 'OPEN_CALL') {
    body = `<p class="big">Open call</p><p>No programme yet. Drop a film in an empty frame and
      the evening starts with you.</p>`;
  } else if (st === 'FILLING') {
    body = `<p class="big">Tickets on sale</p><p>Buy a seat at the window, or bring a film and the
      seat is free.</p>`;
  } else if (st === 'DOORS_CLOSED') {
    body = `<p class="big">Doors closed</p><p>No more tickets for this one. You can still stand at
      the back — or wait for the next house.</p>`;
  } else {
    body = `<p class="big">In progress</p><p>Late arrivals join where everyone else already is.
      Nothing rewinds.</p>`;
  }
  box.innerHTML = `<h4>${head}</h4>${body}`;
}

/* ---------- the sidewalk ---------- */
function renderSidewalk(s) {
  const walk = $('#sidewalk');
  const seed = `street:${s.theater.number}`;
  if (crowdSeed !== seed) {
    crowdSeed = seed;
    $$('.avatar', walk).forEach((a) => a.remove());
    const width = walk.clientWidth || 900;
    for (const node of Avatar.loiterers(seed, 5, { x0: width * 0.06, x1: width * 0.86 })) {
      walk.appendChild(node);
    }
    you = null;
  }
  if (!you) {
    you = Avatar.make(s.you.id || 'you', { you: true, label: 'you' });
    you.style.left = `${(walk.clientWidth || 900) * 0.5 - 10}px`;
    walk.appendChild(you);
  }
  $('#street-note').textContent = s.you.ticket
    ? 'ticket in hand — the doors are open to you'
    : 'you are standing on the sidewalk';
}
window.addEventListener('resize', () => { crowdSeed = null; if (S) renderSidewalk(S); });

function renderBill(s) {
  const ul = $('#programme');
  const entries = s.reel ? s.reel.entries : s.programme;
  ul.innerHTML = '';
  for (const f of entries) {
    const li = el('li');
    li.appendChild(el('span', 'film-no', String(f.order).padStart(2, '0')));
    const box = el('div');
    box.appendChild(el('span', 'film-title', f.title));
    box.appendChild(el('div', 'film-by', `by ${f.by}`));
    if (f.blurb) box.appendChild(el('div', 'film-blurb', f.blurb));
    li.appendChild(box);
    ul.appendChild(li);
  }
  if (!entries.length) {
    ul.innerHTML = '<li class="empty-slot"><span class="film-title muted">Nothing on the bill yet — the frames out front are empty.</span></li>';
  }
  $('#bill-note').textContent = ['FILLING', 'OPEN_CALL'].includes(s.theater.state)
    ? `${s.slots.filled} of ${s.slots.total} frames filled.`
    : 'The running order is locked.';
}

/* =============================================================================
 * WALKING IN
 * ========================================================================== */
async function enterTheater(word = 'this way') {
  if (entering) return;
  entering = true;
  const walk = $('#sidewalk');
  const door = $('#entrance');
  door.classList.add('open');

  if (you) {
    const wr = walk.getBoundingClientRect();
    const dr = door.getBoundingClientRect();
    const from = { x: parseFloat(you.style.left) || 0, y: 0 };
    const to = { x: dr.left - wr.left + dr.width / 2 - 10, y: -18 };
    you.querySelector('.avatar-label')?.remove();
    await Avatar.walk(you, from, to, { duration: 1100 });
    you.style.opacity = '0';
    you.style.transition = 'opacity .35s';
  }
  $('#wipe-word').textContent = word;
  $('#enter-wipe').classList.add('on');
  setTimeout(() => { location.href = '/house?arrive=1'; }, 760);
}

/* =============================================================================
 * THE WINDOW — stub checkout. No money moves, no card is stored.
 * ========================================================================== */
function checkout(s) {
  const bg = el('div', 'modal-bg');
  const m = el('div', 'modal');
  m.innerHTML = `
    <h3>One seat, Theater #${s.theater.number}</h3>
    <p class="lede tiny">Stub checkout — nothing is charged and nothing is stored. Any
      card-shaped number works.</p>
    <label>Card number</label>
    <input type="text" id="card" value="4242 4242 4242 4242" autocomplete="off">
    <div class="btn-row">
      <button class="btn primary" id="pay">Pay $${(s.prices.audienceCents / 100).toFixed(2)} and go in</button>
      <button class="btn ghost" id="cancel">Not tonight</button>
    </div>`;
  bg.appendChild(m);
  document.body.appendChild(bg);
  $('#cancel', m).onclick = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  $('#pay', m).onclick = async () => {
    $('#pay', m).disabled = true;
    try {
      await api('/api/tickets/audience', { method: 'POST', body: { card: $('#card', m).value } });
      bg.remove();
      enterTheater('enjoy the show');
    } catch (e) {
      toast(e.message, true);
      $('#pay', m).disabled = false;
    }
  };
}

/* =============================================================================
 * THE FRAMES — dropping a film into an empty poster slot
 * ========================================================================== */
function pickFile() {
  const input = el('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm';
  input.onchange = () => {
    const f = input.files[0];
    if (f) offerFilm(f, $('.poster-frame.empty'));
  };
  input.click();
}

async function probe(file) {
  const limits = (S && S.limits) || { minDurationSec: 15, maxDurationSec: 60, maxBytes: 52428800 };
  if (!/^video\/(mp4|webm)$/.test(file.type)) throw new Error('The projector takes mp4 or webm only.');
  if (file.size > limits.maxBytes) {
    throw new Error(`That reel is ${(file.size / 1048576).toFixed(1)}MB — the limit is ${(limits.maxBytes / 1048576).toFixed(0)}MB.`);
  }
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.src = url;
  const secs = await new Promise((resolve, reject) => {
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => reject(new Error('Could not read that file.'));
  });
  if (secs < limits.minDurationSec || secs > limits.maxDurationSec) {
    URL.revokeObjectURL(url);
    throw new Error(`Films run ${limits.minDurationSec}–${limits.maxDurationSec} seconds. Yours runs ${secs.toFixed(1)}s.`);
  }
  return { durationMs: Math.round(secs * 1000), previewUrl: url, seconds: secs };
}

async function offerFilm(file, frame) {
  let info;
  try { info = await probe(file); } catch (e) { return toast(e.message, true); }

  const bg = el('div', 'modal-bg');
  const m = el('div', 'modal');
  m.innerHTML = `
    <h3>Put it in the frame</h3>
    <p class="lede tiny">${info.seconds.toFixed(1)}s · ${(file.size / 1048576).toFixed(1)}MB —
      good for the projector. It goes to the moderation desk, and your seat is held from now.</p>
    <video src="${info.previewUrl}" controls playsinline style="width:100%;border-radius:8px;margin-top:12px;background:#000"></video>
    <label>Title</label>
    <input type="text" id="f-title" maxlength="80" placeholder="Notes on a Laundromat">
    <label>One line about it (optional)</label>
    <input type="text" id="f-blurb" maxlength="200" placeholder="Shot in one take at 4am.">
    <div class="btn-row">
      <button class="btn primary" id="f-go">Hang the poster</button>
      <button class="btn ghost" id="f-cancel">Keep it</button>
    </div>`;
  bg.appendChild(m);
  document.body.appendChild(bg);
  const close = () => { URL.revokeObjectURL(info.previewUrl); bg.remove(); };
  $('#f-cancel', m).onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };
  $('#f-title', m).focus();

  $('#f-go', m).onclick = () => {
    const title = $('#f-title', m).value.trim();
    if (!title) return toast('Give it a title.', true);
    const blurb = $('#f-blurb', m).value.trim();
    close();
    upload(file, { title, blurb, durationMs: info.durationMs }, frame);
  };
}

function upload(file, meta, frame) {
  if (frame) {
    frame.classList.add('uploading');
    frame.innerHTML = `<span class="plus">🎞️</span><span>${meta.title}</span><div class="up-bar"><i></i></div>`;
  }
  const body = new FormData();
  body.append('video', file);
  body.append('title', meta.title);
  body.append('blurb', meta.blurb || '');
  body.append('durationMs', String(meta.durationMs));

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/films');
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable && frame) {
      const bar = frame.querySelector('.up-bar i');
      if (bar) bar.style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`;
    }
  };
  xhr.onload = () => {
    let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      $('#posters').dataset.sig = '';
      toast('In the frame. The desk will look at it — your seat is held.');
      enterTheater('take your seat');
    } else {
      toast(data.error || 'The projectionist dropped it.', true);
      $('#posters').dataset.sig = '';
      if (S) renderPosters(S);
    }
  };
  xhr.onerror = () => { toast('Upload failed.', true); $('#posters').dataset.sig = ''; if (S) renderPosters(S); };
  xhr.send(body);
}

/* A film dropped anywhere on the facade still lands in a frame. */
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.target.closest('.poster-frame')) return;      // the frame handles its own
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && S && ['FILLING', 'OPEN_CALL'].includes(S.theater.state)) {
    offerFilm(file, $('.poster-frame.empty'));
  }
});
