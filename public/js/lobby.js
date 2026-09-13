/* Lobby: house status, seat map, box office. */
mountChrome('lobby');

const hall = new Hall('lobby');
let last = null;

hall.on('state', (s) => { last = s; render(s); });
hall.on('transition', (t) => {
  if (t.state === 'SHOWING') toast('The reel is rolling. Take your seat.');
  if (t.state === 'DOORS_CLOSED') toast('Doors are closed. Showtime is set.');
});

function render(s) {
  const copy = STATE_COPY[s.theater.state] || STATE_COPY.FILLING;
  $('#marquee').innerHTML = marqueeText(s);
  $('#theater-no').textContent = `Theater #${s.theater.number}`;
  $('#state-pill').textContent = copy.label;
  $('#state-pill').className = 'pill ' + copy.pill;
  $('#state-line').textContent = copy.line;

  renderSeatMap($('#seatmap'), s.seatMap);
  $('#mood').textContent = s.seatMap.mood;

  $('#slot-count').textContent = `${s.slots.filled} of ${s.slots.total} films`;
  $('#slot-meter').style.width = `${Math.round((s.slots.filled / Math.max(1, s.slots.total)) * 100)}%`;

  renderProgramme(s);
  renderActions(s);
  renderCountdown(s);
}

function renderProgramme(s) {
  const ul = $('#programme');
  ul.innerHTML = '';
  const showTitles = ['FILLING', 'OPEN_CALL', 'DOORS_CLOSED'].includes(s.theater.state);
  const list = showTitles ? s.programme : (s.reel ? s.reel.entries.map((e) => ({ title: e.title, by: e.by, order: e.order, blurb: e.blurb })) : s.programme);
  for (const f of list) {
    const li = el('li');
    li.appendChild(el('span', 'film-no', String(f.order).padStart(2, '0')));
    const box = el('div');
    box.appendChild(el('span', 'film-title', f.title));
    box.appendChild(el('div', 'film-by', `by ${f.by}`));
    if (f.blurb) box.appendChild(el('div', 'film-blurb', f.blurb));
    li.appendChild(box);
    ul.appendChild(li);
  }
  const stillOpen = ['FILLING', 'OPEN_CALL'].includes(s.theater.state);
  for (let i = list.length; stillOpen && i < s.slots.total; i++) {
    const li = el('li', 'empty-slot');
    li.appendChild(el('span', 'film-no', String(i + 1).padStart(2, '0')));
    li.appendChild(el('span', 'film-title muted', 'seat open for a filmmaker'));
    ul.appendChild(li);
  }
}

function renderActions(s) {
  const box = $('#actions');
  const note = $('#ticket-note');
  box.innerHTML = '';
  const preShow = ['FILLING', 'OPEN_CALL'].includes(s.theater.state);
  const ticket = s.you.ticket;

  if (ticket) {
    note.innerHTML = `You hold a <b>${ticket.kind === 'FILMMAKER' ? 'filmmaker' : 'audience'}</b> ticket for Theater #${s.theater.number}` +
      (ticket.source === 'comp_rejected' ? ' — comped after your last submission was turned down.' : '.') +
      ' Your seat is the gold one.';
  } else if (preShow) {
    note.textContent = 'Two ways in: bring a film, or buy a seat.';
  } else {
    note.textContent = 'This house is sealed. The next one opens the moment this show ends.';
  }

  if (preShow && !ticket) {
    const buy = el('button', 'btn primary', `Audience ticket · $${(s.prices.audienceCents / 100).toFixed(2)}`);
    buy.onclick = () => checkout(s);
    box.appendChild(buy);
    const film = el('a', 'btn', 'Filmmaker ticket · submit a film');
    film.href = '/submit';
    box.appendChild(film);
  } else if (preShow && ticket) {
    const film = el('a', 'btn ghost', ticket.kind === 'FILMMAKER' ? 'Your film is in the queue' : 'Submit a film too');
    film.href = '/submit';
    box.appendChild(film);
    const seat = el('a', 'btn', 'Wait in the auditorium');
    seat.href = '/house';
    box.appendChild(seat);
  } else {
    const seat = el('a', 'btn primary', s.theater.state === 'SHOWING' ? 'Join the screening in progress' : 'Take your seat');
    seat.href = '/house';
    box.appendChild(seat);
  }
}

function renderCountdown(s) {
  const panel = $('#countdown-panel');
  const closed = s.theater.state === 'DOORS_CLOSED';
  panel.style.display = closed ? '' : 'none';
  if (!closed) return;
  const tick = () => {
    const left = s.theater.showtimeAt - hall.now();
    const node = $('#countdown');
    node.textContent = clockString(left);
    node.classList.toggle('urgent', left < 60000);
    $('#countdown-sub').textContent = left > 0
      ? `until showtime · ${timeOfDay(s.theater.showtimeAt)}`
      : 'the reel is starting';
  };
  tick();
  clearInterval(window._cd);
  window._cd = setInterval(tick, 250);
}

/* ---- stub checkout: no money moves, no card is stored ---- */
function checkout(s) {
  const bg = el('div', 'modal-bg');
  const m = el('div', 'modal');
  m.innerHTML = `
    <h3>One seat, Theater #${s.theater.number}</h3>
    <p class="lede tiny">This is a stub checkout. No payment is taken and nothing is stored —
    any card-shaped number is accepted.</p>
    <label>Card number</label>
    <input type="text" id="card" value="4242 4242 4242 4242" autocomplete="off">
    <div class="btn-row">
      <button class="btn primary" id="pay">Pay $${(s.prices.audienceCents / 100).toFixed(2)}</button>
      <button class="btn ghost" id="cancel">Never mind</button>
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
      toast('Ticket issued. Your seat is the gold one.');
    } catch (e) {
      toast(e.message, true);
      $('#pay', m).disabled = false;
    }
  };
}
