/* Hall of Fame + Necrology. Winners can be watched; nothing else can. */
mountChrome('hall');

const loops = [];

api('/api/hall').then(({ hallOfFame, necrology }) => {
  renderHall(hallOfFame, necrology);
  renderNecrology(necrology);
  tickLoops();
});

function renderHall(winners, records) {
  const box = $('#hof');
  if (!winners.length) {
    box.innerHTML = '<p class="lede">Nothing has won yet. The first Best Picture is still out there.</p>';
    return;
  }
  box.innerHTML = '';
  for (const w of winners) {
    const card = el('div', 'hof-card');
    const frame = el('div', 'frame');

    // A winner that was an uploaded film plays; a demo slate is redrawn.
    if (w.kind === 'slate') {
      const c = el('canvas');
      frame.appendChild(c);
      loops.push({ canvas: c, entry: w });
    } else {
      const v = el('video');
      v.src = w.src; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
      v.onerror = () => { frame.innerHTML = '<div class="center muted tiny" style="padding-top:28%">print unavailable</div>'; };
      frame.appendChild(v);
    }
    card.appendChild(frame);

    const meta = el('div', 'meta');
    meta.innerHTML = `
      <div class="laurel">Best Picture · Theater #${w.number}</div>
      <h3>${w.title}</h3>
      <div class="film-by">by ${w.by} · ${dayAndTime(w.screenedAt)}</div>
      <div class="result-stats" style="margin:10px 0 0">
        <span>🗳 ${w.votes}</span><span>🌹 ${w.roses}</span><span>🍅 ${w.tomatoes}</span>
      </div>`;
    const encore = el('button', 'btn ghost small', `Request encore · $2`);
    encore.style.marginTop = '14px';
    encore.onclick = async () => {
      try { await api(`/api/encore/${w.number}`, { method: 'POST' }); }
      catch (e) { toast(e.message || 'Encores are not on sale yet.'); }
    };
    meta.appendChild(encore);
    card.appendChild(meta);
    box.appendChild(card);
  }
}

function renderNecrology(records) {
  const box = $('#necrology');
  if (!records.length) { box.innerHTML = '<p class="lede">No closed houses yet.</p>'; return; }
  box.innerHTML = '';
  for (const r of records) {
    const card = el('div', 'record');
    card.innerHTML = `
      <div class="record-head">
        <span class="n">Theater #${r.number}</span>
        <span class="d">${dayAndTime(r.screenedAt)}${r.guaranteed ? ' · guaranteed showtime' : ''} · ${r.tier || ''}</span>
        <span class="d" style="margin-left:auto">${r.totals.films} films · 🌹 ${r.totals.roses} · 🍅 ${r.totals.tomatoes} · 🗳 ${r.totals.votes}</span>
      </div>
      <table class="stats">
        <tr><th>#</th><th>Film</th><th>Filmmaker</th><th class="num">🗳</th><th class="num">🌹</th><th class="num">🍅</th></tr>
        ${r.films.map((f) => `
          <tr class="${f.winner ? 'win' : ''}">
            <td class="film-no">${String(f.order).padStart(2, '0')}</td>
            <td>${f.title}${f.winner ? ' <span class="laurel">· winner</span>' : ''}</td>
            <td class="muted">${f.by}</td>
            <td class="num">${f.votes}</td><td class="num">${f.roses}</td><td class="num">${f.tomatoes}</td>
          </tr>`).join('')}
      </table>`;
    box.appendChild(card);
  }
}

/* Slate winners are redrawn live on their card. */
function tickLoops() {
  requestAnimationFrame(tickLoops);
  const t = Date.now() % 60000;
  for (const l of loops) Slate.film(l.canvas, l.entry, t % (l.entry.durationMs || 30000));
}
