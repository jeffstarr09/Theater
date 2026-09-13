/* =============================================================================
 * DEV PANEL
 * Forces every state transition so the whole loop — fill, doors, countdown,
 * synced screening, reactions, ballot, winner, Hall of Fame — can be demoed in
 * about two minutes. Press D, or click DEV bottom-right. Disable with
 * THEATER_DEV=off.
 * ========================================================================== */

(function () {
  let open = false, timer = null;

  const toggle = document.createElement('button');
  toggle.id = 'dev-toggle';
  toggle.textContent = 'DEV';
  document.body.appendChild(toggle);

  const panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.className = 'hidden';
  document.body.appendChild(panel);

  const GROUPS = [
    ['Fill & crowd', [
      ['Fill theater', { path: '/api/dev/fill' }],
      ['+5 patrons', { path: '/api/dev/crowd', body: { n: 5 } }],
      ['Hype chat', { path: '/api/dev/hype', body: { n: 4 } }],
    ]],
    ['Run the show', [
      ['Close doors · 30s', { path: '/api/dev/close-doors', body: { seconds: 30 } }],
      ['Start show NOW', { path: '/api/dev/start-show', body: { seconds: 0 }, go: '/house' }],
      ['Throw 10', { path: '/api/dev/reactions', body: { n: 10 } }],
      ['Skip to end', { path: '/api/dev/skip-to-end' }],
    ]],
    ['Ballot & after', [
      ['Open ballot', { path: '/api/dev/open-ballot' }],
      ['Fake ballots', { path: '/api/dev/votes' }],
      ['Crown winner', { path: '/api/dev/close-ballot' }],
      ['Next theater', { path: '/api/dev/next-theater' }],
    ]],
    ['House Manager', [
      ['Guaranteed in 60s', { path: '/api/dev/guaranteed', body: { seconds: 60 } }],
      ['Traffic: dark', { path: '/api/dev/traffic', body: { level: 'dark' } }],
      ['low', { path: '/api/dev/traffic', body: { level: 'low' } }],
      ['normal', { path: '/api/dev/traffic', body: { level: 'normal' } }],
      ['high', { path: '/api/dev/traffic', body: { level: 'high' } }],
      ['peak', { path: '/api/dev/traffic', body: { level: 'peak' } }],
    ]],
  ];

  function build() {
    panel.innerHTML = '';
    for (const [heading, buttons] of GROUPS) {
      panel.appendChild(Object.assign(document.createElement('h4'), { textContent: heading }));
      const row = document.createElement('div');
      row.className = 'dev-btns';
      for (const [label, action] of buttons) {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = async () => {
          b.disabled = true;
          try {
            const out = await api(action.path, { method: 'POST', body: action.body || {} });
            toast(out.note || `${label} ✓`);
            if (action.go && location.pathname !== action.go) location.href = action.go;
          } catch (e) { toast(e.message, true); }
          b.disabled = false;
          refresh();
        };
        row.appendChild(b);
      }
      panel.appendChild(row);
    }
    panel.appendChild(Object.assign(document.createElement('h4'), { textContent: 'What the House Manager sees' }));
    const pre = document.createElement('div');
    pre.id = 'dev-readout';
    panel.appendChild(pre);
    const foot = document.createElement('pre');
    foot.textContent = 'Tune every number in server/policy.js';
    panel.appendChild(foot);
  }

  const kv = (k, v) => `<div class="dev-kv"><span>${k}</span><b>${v}</b></div>`;

  async function refresh() {
    if (!open) return;
    try {
      const s = await api('/api/dev/status');
      const mins = (ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
      $('#dev-readout').innerHTML =
        kv('theater', `#${s.theaterId} ${s.state}`) +
        kv('tier', `${s.demand.tier}`) +
        kv('tickets/hr', s.demand.ticketsPerHour.toFixed(1)) +
        kv('subs/hr', s.demand.submissionsPerHour.toFixed(1)) +
        kv('attendance', `${Math.round(s.demand.attendanceRate * 100)}%`) +
        kv('planned seats', s.plan.seats) +
        kv('film slots', s.plan.filmSlots) +
        kv('needs films', `${s.have.films} / ${s.effective.minFilms}`) +
        kv('needs seats', `${s.have.tickets} / ${s.effective.seatsNeeded}`) +
        kv('stall decay', `${s.decaySteps} step(s)`) +
        kv('quiet for', mins(s.quietForMs)) +
        kv('countdown', `${Math.round(s.plan.countdownMinutes)} min`) +
        kv('next guaranteed', s.nextGuaranteed ? new Date(s.nextGuaranteed.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—') +
        kv('admin key', s.adminKey);
    } catch {
      $('#dev-readout').innerHTML = '<pre>dev tools disabled</pre>';
    }
  }

  function setOpen(v) {
    open = v;
    panel.classList.toggle('hidden', !open);
    clearInterval(timer);
    if (open) { refresh(); timer = setInterval(refresh, 2000); }
  }

  toggle.onclick = () => setOpen(!open);
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd' && !/input|textarea/i.test(document.activeElement.tagName)) setOpen(!open);
  });

  build();
  // Hide the whole affair if the server has dev tools turned off.
  api('/api/dev/status').catch(() => { toggle.remove(); panel.remove(); });
})();
