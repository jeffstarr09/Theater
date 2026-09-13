/* Moderation desk: preview, approve, reject with a reason. */
mountChrome(null);

let KEY = localStorage.getItem('theater_admin_key') || '';
const slateLoops = [];

const adminApi = (path, opts = {}) =>
  api(path, { ...opts, headers: { ...(opts.headers || {}), 'x-admin-key': KEY } });

$('#unlock').onclick = () => unlock($('#key').value.trim());
$('#key').onkeydown = (e) => { if (e.key === 'Enter') unlock($('#key').value.trim()); };

async function unlock(key) {
  KEY = key;
  try {
    await adminApi('/api/admin/house');
    localStorage.setItem('theater_admin_key', key);
    $('#gate').classList.add('hidden');
    $('#desk').classList.remove('hidden');
    load();
    setInterval(load, 5000);
  } catch (e) {
    toast('That key does not open this desk.', true);
  }
}
if (KEY) unlock(KEY);

async function load() {
  const data = await adminApi('/api/admin/queue');
  renderQueue(data.pending);
  renderRecent(data.recent);
  renderHouse(data.house);
}

function renderQueue(pending) {
  const box = $('#queue');
  const sig = pending.map((p) => p.id).join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  slateLoops.length = 0;
  box.innerHTML = '';
  if (!pending.length) {
    box.innerHTML = '<p class="lede">Queue is clear. The desk is free to watch the show.</p>';
    return;
  }
  for (const f of pending) {
    const card = el('div', 'record');
    const head = el('div', 'record-head');
    head.innerHTML = `<span class="n">${f.title}</span>
      <span class="d">by ${f.by} · ${(f.durationMs / 1000).toFixed(1)}s · ${(f.sizeBytes / 1048576).toFixed(1)}MB · ${dayAndTime(f.createdAt)}</span>`;
    card.appendChild(head);
    if (f.blurb) card.appendChild(el('p', 'film-blurb', f.blurb));

    const screen = el('div', 'screen');
    screen.style.maxWidth = '480px';
    screen.style.margin = '12px 0';
    if (f.kind === 'upload' && f.src) {
      const v = el('video');
      v.src = f.src; v.controls = true; v.playsInline = true;
      screen.appendChild(v);
    } else {
      const c = el('canvas');
      screen.appendChild(c);
      slateLoops.push({ canvas: c, entry: f });
    }
    card.appendChild(screen);

    const row = el('div', 'btn-row');
    const ok = el('button', 'btn primary small', 'Approve');
    ok.onclick = async () => {
      const out = await adminApi(`/api/admin/films/${f.id}/approve`, { method: 'POST' });
      toast(out.placed ? `Approved — placed in Theater #${out.placed}.` : 'Approved — held in reserve for the next house.');
      box.dataset.sig = ''; load();
    };
    const reasonInput = el('input');
    reasonInput.type = 'text';
    reasonInput.placeholder = 'Reason (shown to the filmmaker)';
    reasonInput.style.maxWidth = '280px';
    const no = el('button', 'btn ghost small', 'Reject');
    no.onclick = async () => {
      await adminApi(`/api/admin/films/${f.id}/reject`, { method: 'POST', body: { reason: reasonInput.value } });
      toast('Rejected — the filmmaker has been comped into the next theater.');
      box.dataset.sig = ''; load();
    };
    row.appendChild(ok); row.appendChild(reasonInput); row.appendChild(no);
    card.appendChild(row);
    box.appendChild(card);
  }
}

function renderRecent(recent) {
  const ul = $('#recent');
  ul.innerHTML = recent.length ? '' : '<li class="empty-slot"><span class="film-title muted">Nothing reviewed yet.</span></li>';
  for (const r of recent) {
    const li = el('li');
    li.appendChild(el('span', 'film-no', r.status === 'approved' ? '✓' : '✕'));
    const box = el('div');
    box.appendChild(el('span', 'film-title', r.title));
    box.appendChild(el('div', 'film-by', `${r.by} · ${r.status}${r.reason ? ` · “${r.reason}”` : ''} · ${dayAndTime(r.reviewedAt)}`));
    li.appendChild(box);
    ul.appendChild(li);
  }
}

function renderHouse(h) {
  $('#house').innerHTML = `
    <table class="stats">
      <tr><th>Signal</th><th>Value</th><th>Meaning</th></tr>
      <tr><td>Theater</td><td>#${h.theaterId} · ${h.state}</td><td class="muted">current house</td></tr>
      <tr><td>Tier</td><td>${h.demand.tier}</td><td class="muted">${h.demand.tierBlurb}</td></tr>
      <tr><td>Tickets / hour</td><td>${h.demand.ticketsPerHour.toFixed(1)}</td><td class="muted">decayed rate, drives every curve</td></tr>
      <tr><td>Submissions / hour</td><td>${h.demand.submissionsPerHour.toFixed(1)}</td><td class="muted">programme supply</td></tr>
      <tr><td>Attendance rate</td><td>${Math.round(h.demand.attendanceRate * 100)}%</td><td class="muted">how many ticket holders turn up — seats are oversold to match</td></tr>
      <tr><td>Planned room</td><td>${h.plan.seats} seats · ${h.plan.filmSlots} film slots</td><td class="muted">recomputed while the house fills</td></tr>
      <tr><td>Fill condition</td><td>${h.have.films}/${h.effective.minFilms} films · ${h.have.tickets}/${h.effective.seatsNeeded} seats</td><td class="muted">closes the doors when both are met</td></tr>
      <tr><td>Anti-stall decay</td><td>${h.decaySteps} step(s)</td><td class="muted">requirements drop while the house is quiet</td></tr>
      <tr><td>Countdown</td><td>${Math.round(h.plan.countdownMinutes)} min</td><td class="muted">doors closed → showtime</td></tr>
      <tr><td>Next guaranteed</td><td>${h.nextGuaranteed ? dayAndTime(h.nextGuaranteed.at) : '—'}</td><td class="muted">fires whether or not the house filled</td></tr>
    </table>`;
}

function loop() {
  requestAnimationFrame(loop);
  const t = Date.now() % 60000;
  for (const l of slateLoops) Slate.film(l.canvas, l.entry, t % (l.entry.durationMs || 30000));
}
requestAnimationFrame(loop);
