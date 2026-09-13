/* Filmmaker flow: probe the file in the browser, then upload it. */
mountChrome('submit');

const hall = new Hall('submit');
hall.on('state', (s) => {
  $('#marquee').innerHTML = marqueeText(s);
  limits = s.limits;
});

let limits = { minDurationSec: 15, maxDurationSec: 60, maxBytes: 50 * 1024 * 1024 };
let durationMs = 0;

const file = $('#file');
const probe = $('#probe');
const go = $('#go');

file.onchange = () => {
  durationMs = 0;
  go.disabled = true;
  const f = file.files[0];
  if (!f) return (probe.textContent = '');

  if (f.size > limits.maxBytes) {
    probe.innerHTML = `<span style="color:var(--red)">That is ${(f.size / 1048576).toFixed(1)}MB — the limit is ${(limits.maxBytes / 1048576).toFixed(0)}MB.</span>`;
    return;
  }
  const url = URL.createObjectURL(f);
  $('#preview').src = url;
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => {
    durationMs = Math.round(v.duration * 1000);
    const secs = v.duration;
    const ok = secs >= limits.minDurationSec && secs <= limits.maxDurationSec;
    probe.innerHTML = ok
      ? `<span style="color:var(--green)">${secs.toFixed(1)}s · ${(f.size / 1048576).toFixed(1)}MB — good for the projector.</span>`
      : `<span style="color:var(--red)">${secs.toFixed(1)}s — films must run ${limits.minDurationSec}–${limits.maxDurationSec} seconds.</span>`;
    go.disabled = !ok;
  };
  v.onerror = () => { probe.innerHTML = '<span style="color:var(--red)">Could not read that file.</span>'; };
  v.src = url;
};

$('#form').onsubmit = (e) => {
  e.preventDefault();
  const f = file.files[0];
  if (!f || !durationMs) return;
  const body = new FormData();
  body.append('video', f);
  body.append('title', $('#title').value.trim());
  body.append('blurb', $('#blurb').value.trim());
  body.append('durationMs', String(durationMs));

  go.disabled = true;
  $('#bar-wrap').style.display = '';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/films');
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) $('#bar').style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`;
  };
  xhr.onload = () => {
    let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      toast('Submitted. The desk will look at it shortly — your seat is held.');
      $('#form').reset();
      $('#bar-wrap').style.display = 'none';
      probe.textContent = '';
      loadMine();
    } else {
      toast(data.error || 'Upload failed.', true);
      go.disabled = false;
    }
  };
  xhr.onerror = () => { toast('Upload failed.', true); go.disabled = false; };
  xhr.send(body);
};

const STATUS_COPY = {
  pending: ['At the desk', 'var(--gold)'],
  approved: ['In the programme', 'var(--green)'],
  rejected: ['Turned down — comped ticket issued', 'var(--red)'],
  screened: ['Screened', 'var(--muted)'],
};

async function loadMine() {
  const { films } = await api('/api/films/mine');
  const ul = $('#mine');
  ul.innerHTML = '';
  if (!films.length) {
    ul.innerHTML = '<li class="empty-slot"><span class="film-title muted">Nothing submitted yet.</span></li>';
    return;
  }
  for (const f of films) {
    const [label, color] = STATUS_COPY[f.status] || [f.status, 'var(--muted)'];
    const li = el('li');
    const box = el('div');
    box.appendChild(el('span', 'film-title', f.title));
    const meta = el('div', 'film-by');
    meta.innerHTML = `<span style="color:${color}">${label}</span> · ${(f.duration_ms / 1000).toFixed(0)}s`
      + (f.reject_reason ? ` · “${f.reject_reason}”` : '');
    box.appendChild(meta);
    li.appendChild(box);
    ul.appendChild(li);
  }
}
loadMine();
