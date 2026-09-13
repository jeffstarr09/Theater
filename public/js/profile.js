/* Pseudonymous profile: stubs, films, wins, ballots cast. */
mountChrome('me');

const STATUS = { pending: 'at the desk', approved: 'in the programme', rejected: 'turned down', screened: 'screened' };

function render(p) {
  $('#handle').textContent = p.user.handle;
  const w = p.wallet || { credits: 0, purchases: [] };
  $('#wallet').innerHTML = `<p class="theater-no" style="font-size:28px">${w.credits} seat${w.credits === 1 ? '' : 's'} in your pocket</p>` +
    (w.purchases.length ? `<ul class="film-list">${w.purchases.map((x) => `<li><span class="film-no">${x.rail === 'lightning' ? '⚡' : x.rail === 'comp' ? '🎁' : '💳'}</span><div><span class="film-title">${x.credits} seat${x.credits === 1 ? '' : 's'}</span><div class="film-by">${x.status} · ${x.rail === 'lightning' ? `${x.sats} sats` : `$${(x.amount_cents / 100).toFixed(2)}`} · ${dayAndTime(x.created_at)}</div></div></li>`).join('')}</ul>` : '<p class="lede tiny">Nothing bought yet. The window is out front.</p>');
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
