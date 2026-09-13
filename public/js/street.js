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
  MATCHING:     ['FINDING YOU A HOUSE', 'filling'],
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
  $('#sign-now').textContent = s.theater.number ? `${word} · THEATER #${s.theater.number}` : word;
  $('#sign-now').className = 'sign-now ' + cls;
  renderSignWhen(s);
  renderPosters(s);
  renderBooth(s);
  renderEntrance(s);
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
  } else if (s.theater.state === 'MATCHING') {
    const m = s.matching;
    node.innerHTML = `<span class="sign-clock">${m.filmsReady}/${m.filmsToStart}</span> films ready` +
      (m.roomsRunning ? ` · <span class="sign-clock">${m.roomsRunning}</span> room${m.roomsRunning === 1 ? '' : 's'} running` : '') +
      ` · starts within <span class="sign-clock">${m.maxWaitMinutes} min</span>`;
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
  const wall = $('#window-r');
  const wallL = $('#window-l');
  const entries = s.reel ? s.reel.entries.map((e) => ({
    filmId: e.filmId, title: e.title, by: e.by, order: e.order, slate: e.slate,
  })) : s.programme.map((p) => ({ filmId: p.id, title: p.title, by: p.by, order: p.order }));

  const open = ['FILLING', 'OPEN_CALL', 'MATCHING'].includes(s.theater.state);
  const mine = s.you.submission;
  const pending = mine && mine.status === 'pending' ? mine : null;
  const slots = Math.max(s.slots.total, entries.length + (open ? 1 : 0));

  const sig = entries.map((e) => e.filmId).join(',') + `|${slots}|${open}|${pending ? pending.id : ''}`;
  if (wall.dataset.sig === sig) return;
  wall.dataset.sig = sig;
  wall.innerHTML = ''; wallL.innerHTML = '';

  // Four frames across the two windows: the bill first, then your pending
  // print, then empty frames while the doors are open. Anything past four
  // is a chip, not a frame.
  const frames = [];
  for (const e of entries) frames.push(filledFrame(e, s));
  if (pending) frames.push(filledFrame({ filmId: pending.id, title: pending.title, by: 'you', order: null }, s, 'at the desk'));
  if (open) for (let i = frames.length; i < Math.min(4, Math.max(frames.length + 1, slots)); i++) frames.push(emptyFrame());
  const overflow = entries.length - 4;
  frames.slice(0, 4).forEach((f, i) => (i < 2 ? wallL : wall).appendChild(f));
  if (overflow > 0) wall.appendChild(el('span', 'more-chip', `+${overflow} more`));
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
  frame.innerHTML = '<span class="plus">+</span><span>drop a<br>film</span>';
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

/* ---------- the ticket window between the doors ---------- */
function renderBooth(s) {
  const bo = $('#booth');
  const open = ['FILLING', 'OPEN_CALL', 'MATCHING'].includes(s.theater.state);
  const ticket = s.you.ticket;
  const credits = s.you.credits || 0;
  $('#b-price').textContent = credits > 0 ? `${credits} seat${credits === 1 ? '' : 's'}` : `$${(s.prices.audienceCents / 100).toFixed(2)}`;
  bo.classList.toggle('closed', !open);
  $('#b-note').textContent = ticket ? 'you hold a ticket' : credits > 0 ? 'in your pocket · tap to sit' : open ? 'one seat, please' : 'window closed';
  bo.onclick = () => {
    if (!open) return toast('The window is shut for this one. The next house opens shortly.');
    if (ticket) return toast('You are already holding a ticket. Go on in.');
    if (credits > 0) return takeSeat();
    wallet(s);
  };
}

/** Spend a credit on a seat and go in. */
async function takeSeat() {
  try {
    const out = await api('/api/tickets/audience', { method: 'POST', body: {} });
    if (out.already) return enterTheater('to your seat', $('#door-r'));
    enterTheater(out.pool ? 'a house is forming' : 'enjoy the show', $('#door-r'));
  } catch (e) {
    if (/pocket/i.test(e.message) && S) return wallet(S);
    toast(e.message, true);
  }
}

/* ---------- the doors ---------- */
function renderEntrance(s) {
  const st = s.theater.state;
  const ticket = s.you.ticket;
  const showing = ['SHOWING', 'VOTING', 'RESULTS'].includes(st);
  for (const door of [$('#door-l'), $('#door-r')]) {
    door.classList.toggle('open', showing || !!ticket);
    door.classList.toggle('spill', showing);
    door.onclick = () => enterTheater(ticket ? 'to your seat' : 'this way', door);
  }
  $('#door-label').textContent = showing
    ? (ticket ? 'in progress — go in' : 'in progress — watch from the back')
    : ticket ? (ticket.pool ? 'this way — a house is forming' : 'this way to your seat') : 'ticket holders only';
}

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
async function enterTheater(word = 'this way', door = null) {
  if (entering) return;
  entering = true;
  const stage = $('#stage');
  const doors = [$('#door-l'), $('#door-r')];
  door = door || doors[0];
  doors.forEach((d) => d.classList.add('open'));

  // Push the camera through the chosen door. The stage scales up around the
  // door's centre, the light in the doorway floods, then the wipe takes over.
  const sr = stage.getBoundingClientRect(), dr = door.getBoundingClientRect();
  const ox = ((dr.left + dr.width / 2 - sr.left) / sr.width) * 100;
  const oy = ((dr.top + dr.height * 0.62 - sr.top) / sr.height) * 100;
  stage.style.transformOrigin = `${ox}% ${oy}%`;
  stage.classList.add('entering');
  door.classList.add('through');
  await new Promise((r) => setTimeout(r, 950));
  $('#wipe-word').textContent = word;
  $('#enter-wipe').classList.add('on');
  await new Promise((r) => setTimeout(r, 650));
  location.href = '/house?arrive=1';
}

/* =============================================================================
 * THE WINDOW — seat credits, by card or over Lightning. Both rails are stubs
 * until a provider is configured (see server/payments.js).
 * ========================================================================== */
function wallet(s) {
  const bundles = s.prices.bundles || [];
  const bg = el('div', 'modal-bg');
  const m = el('div', 'modal');
  m.innerHTML = `
    <h3>Seats</h3>
    <p class="lede tiny">A seat is a dollar. Buy a few at once and the card fees stop eating the
      ticket — or pay in bitcoin over Lightning, where they never did.</p>
    <div class="bundles">${bundles.map((b) => `
      <button class="bundle${b.featured ? ' featured' : ''}" data-b="${b.id}">
        <b>${b.credits}</b><span>${b.label}</span><em>$${(b.cents / 100).toFixed(2)}${b.note ? ` · ${b.note}` : ''}</em>
      </button>`).join('')}</div>
    <label>Card number</label>
    <input type="text" id="card" value="4242 4242 4242 4242" autocomplete="off">
    <div class="btn-row">
      <button class="btn primary" id="pay">Pay by card</button>
      ${s.prices.lightning ? '<button class="btn" id="pay-ln">⚡ Pay in bitcoin</button>' : ''}
      <button class="btn ghost" id="cancel">Not tonight</button>
    </div>
    <div id="ln-box" class="hidden"></div>
    <p class="lede tiny">Stub checkout — nothing is charged and nothing is stored.</p>`;
  bg.appendChild(m);
  document.body.appendChild(bg);
  let chosen = (bundles.find((b) => b.featured) || bundles[0] || {}).id;
  const pick = () => $$('.bundle', m).forEach((b) => b.classList.toggle('on', b.dataset.b === chosen));
  $$('.bundle', m).forEach((b) => { b.onclick = () => { chosen = b.dataset.b; pick(); }; });
  pick();
  const close = () => bg.remove();
  $('#cancel', m).onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };

  const done = async (credits) => {
    close();
    toast(`${credits} seat${credits === 1 ? '' : 's'} in your pocket.`);
    takeSeat();
  };

  $('#pay', m).onclick = async () => {
    $('#pay', m).disabled = true;
    try {
      const out = await api('/api/wallet/checkout', { method: 'POST', body: { bundle: chosen, card: $('#card', m).value } });
      done(out.wallet.credits);
    } catch (e) { toast(e.message, true); $('#pay', m).disabled = false; }
  };

  const ln = $('#pay-ln', m);
  if (ln) ln.onclick = async () => {
    ln.disabled = true;
    try {
      const { invoice } = await api('/api/wallet/lightning', { method: 'POST', body: { bundle: chosen } });
      const box = $('#ln-box', m);
      box.classList.remove('hidden');
      box.innerHTML = `
        <div class="ln">
          <div class="ln-amt">⚡ ${invoice.sats.toLocaleString()} sats <small>for ${invoice.credits} seat${invoice.credits === 1 ? '' : 's'}</small></div>
          <code class="ln-req">${invoice.paymentRequest}</code>
          <div class="ln-status" id="ln-status">waiting for payment…</div>
          ${invoice.provider === 'stub' ? '<button class="btn small" id="ln-sim">Simulate payment (stub)</button>' : ''}
        </div>`;
      const sim = $('#ln-sim', m);
      if (sim) sim.onclick = async () => {
        const out = await api(`/api/wallet/lightning/${invoice.purchaseId}/simulate`, { method: 'POST' });
        done(out.wallet.credits);
      };
      const poll = setInterval(async () => {
        if (!document.body.contains(bg)) return clearInterval(poll);
        const st = await api(`/api/wallet/lightning/${invoice.purchaseId}`).catch(() => null);
        if (st && st.status === 'paid') { clearInterval(poll); done(st.credits); }
      }, 2500);
    } catch (e) { toast(e.message, true); ln.disabled = false; }
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
    frame.innerHTML = `<span class="plus">🎞️</span><span>${meta.title.slice(0, 18)}</span><div class="up-bar"><i></i></div>`;
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
      $('#window-r').dataset.sig = '';
      toast('In the frame. The desk will look at it — your seat is held.');
      enterTheater('take your seat', $('#door-l'));
    } else {
      toast(data.error || 'The projectionist dropped it.', true);
      $('#window-r').dataset.sig = '';
      if (S) renderPosters(S);
    }
  };
  xhr.onerror = () => { toast('Upload failed.', true); $('#window-r').dataset.sig = ''; if (S) renderPosters(S); };
  xhr.send(body);
}

/* A film dropped anywhere on the facade still lands in a frame. */
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.target.closest('.poster-frame')) return;      // the frame handles its own
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && S && ['FILLING', 'OPEN_CALL', 'MATCHING'].includes(S.theater.state)) {
    offerFilm(file, $('.poster-frame.empty'));
  }
});

/* ---------- the vibes switch on the wall ---------- */
function renderDial() {
  const v = getVibe();
  $$('#dial button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v));
}
$$('#dial button').forEach((b) => {
  b.onclick = (e) => {
    e.stopPropagation();
    setVibe(Number(b.dataset.v));
    renderDial();
    toast(['House lights up.', 'Trippy.', 'Cosmic. Mind the curb.'][Number(b.dataset.v)]);
  };
});
renderDial();
