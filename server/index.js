'use strict';
/* The Theater — entry point. One command: `npm start`. */

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');

const { identify } = require('./auth');
const HM = require('./houseManager');
const realtime = require('./realtime');
const { router, ADMIN_KEY, DEV_ENABLED } = require('./routes');
const { seed, isSeeded } = require('./seed');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
/* Payment webhooks are verified against the raw body, so they bypass the JSON parser. */
app.post('/webhooks/lightning', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
  try {
    const p = require('./payments').handleWebhook(req.headers, req.body);
    res.json({ ok: true, settled: p ? p.id : null });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(identify);                       // everyone gets a pseudonym on arrival
app.use('/static', express.static(PUBLIC, { maxAge: '1h' }));
app.use(router);

/* Pages. Each is a plain HTML file; no build step, no bundler. */
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
app.get('/', page('street.html'));
app.get('/house', page('house.html'));
app.get('/submit', page('submit.html'));
app.get('/hall', page('hall.html'));
app.get('/me', page('profile.html'));
app.get('/admin', page('admin.html'));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, 'street.html')));
app.use((err, req, res, next) => {
  console.error('[http]', err);
  res.status(500).json({ error: err.message || 'Something went wrong in the projection booth.' });
});

if (!isSeeded()) {
  const out = seed();
  console.log(`[seed] demo house built — now showing Theater #${out.theater}`);
}

const server = http.createServer(app);
realtime.attach(server);
HM.start();

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   T H E   T H E A T E R                      ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log(`  Out front      http://localhost:${PORT}/`);
  console.log(`  Auditorium     http://localhost:${PORT}/house`);
  console.log(`  Submit a film  http://localhost:${PORT}/submit`);
  console.log(`  Hall of Fame   http://localhost:${PORT}/hall`);
  console.log(`  Moderation     http://localhost:${PORT}/admin   (key: ${ADMIN_KEY})`);
  console.log(`  DEV panel      ${DEV_ENABLED ? 'enabled — press D or click DEV, bottom right' : 'disabled'}`);
  console.log('');
});

process.on('SIGINT', () => { HM.stop(); server.close(() => process.exit(0)); });
