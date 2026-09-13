/* Pseudonymous profile: stubs, films, wins, ballots cast. */
mountChrome('me');

const STATUS = { pending: 'at the desk', approved: 'in the programme', rejected: 'turned down', screened: 'screened' };

function render(p) {
  $('#handle').textContent = p.user.handle;
  $('#counters').innerHTML = `
    <span>🎟 ${p.stubs.length} theaters</span>
    <span>🎞 ${p.films.length} films</span>
    <span>🏆 ${p.wins.length} wins</span>
    <span>🗳 ${p.votesCast} ballots</span>
    <span>🌹 ${p.thrown.roses}</span>
    <span>🍅 ${p.thrown.tomatoes}</span>`;

  const stubs = $('#stubs');
  stubs.innerHTML = p.stubs.length ? '' : '<li class="empty-slot"><span class="film-title muted">No stubs yet.</span></li>';
  for (const s of p.stubs) {
    const li = el('li');
    li.appendChild(el('span', 'film-no', `#${s.number}`));
    const box = el('div');
    box.appendChild(el('span', 'film-title', s.kind === 'FILMMAKER' ? 'Filmmaker' : 'Audience'));
    box.appendChild(el('div', 'film-by',
      `${s.started_at ? dayAndTime(s.started_at) : 'not yet screened'} · ${s.attended ? 'attended' : 'no-show'} · ${s.state.toLowerCase()}`));
    li.appendChild(box);
    stubs.appendChild(li);
  }

  const films = $('#films');
  films.innerHTML = p.films.length ? '' : '<li class="empty-slot"><span class="film-title muted">Nothing submitted yet.</span></li>';
  for (const f of p.films) {
    const li = el('li');
    const box = el('div');
    box.appendChild(el('span', 'film-title', f.title));
    box.appendChild(el('div', 'film-by', `${STATUS[f.status] || f.status} · ${(f.duration_ms / 1000).toFixed(0)}s`));
    li.appendChild(box);
    films.appendChild(li);
  }

  const wins = $('#wins');
  wins.innerHTML = p.wins.length ? '' : '<li class="empty-slot"><span class="film-title muted">No Best Picture yet.</span></li>';
  for (const w of p.wins) {
    const li = el('li');
    li.appendChild(el('span', 'film-no', '🏆'));
    const box = el('div');
    box.appendChild(el('span', 'film-title', w.title));
    box.appendChild(el('div', 'film-by', `Theater #${w.number} · ${dayAndTime(w.started_at)}`));
    li.appendChild(box);
    wins.appendChild(li);
  }
}

api('/api/me').then(render);

$('#rename').onclick = async () => {
  const handle = $('#new-handle').value.trim();
  if (!handle) return;
  render(await api('/api/me', { method: 'POST', body: { handle } }));
  $('#new-handle').value = '';
  toast('Renamed.');
};
