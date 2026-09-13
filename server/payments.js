'use strict';
/* =============================================================================
 * PAYMENTS — a wallet of seat credits, filled by card or over Lightning.
 * =============================================================================
 * Nothing here moves real money yet. The card rail is a stub that accepts any
 * card-shaped number; the Lightning rail is a stub that mints a fake invoice
 * and settles it when told to. Both are shaped so that a real provider drops
 * in behind the same three calls:
 *
 *   createInvoice(user, bundle)   -> { id, paymentRequest, sats, expiresAt }
 *   handleWebhook(headers, body)  -> { purchaseId, paid: bool }
 *   creditPurchase(purchaseId)    -> adds the credits exactly once
 *
 * For BTCPay Server: set LIGHTNING_PROVIDER=btcpay, BTCPAY_URL, BTCPAY_STORE,
 * BTCPAY_API_KEY, BTCPAY_WEBHOOK_SECRET, and point a BTCPay webhook for
 * "InvoiceSettled" at POST /webhooks/lightning. The adapter below shows the
 * calls; it is not exercised in this environment.
 * ===========================================================================*/

const crypto = require('crypto');
const POLICY = require('./policy');
const { db } = require('./db');
const { id } = require('./ids');

const PROVIDER = process.env.LIGHTNING_PROVIDER || 'stub';
/* A stand-in rate so the stub can quote sats. A real adapter asks the provider. */
const SATS_PER_USD = Number(process.env.SATS_PER_USD || 1500);

function bundles() { return POLICY.tickets.bundles; }
function bundle(bid) { return bundles().find((b) => b.id === bid) || null; }

function wallet(userId) {
  const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  const purchases = db.prepare(`
    SELECT id, rail, bundle, credits, amount_cents, sats, status, created_at, paid_at
    FROM purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(userId);
  return { credits: u ? u.credits : 0, purchases, bundles: bundles(), lightning: POLICY.tickets.lightning };
}

/* Adds the credits for a purchase exactly once, whatever rail it came in on. */
const creditPurchase = db.transaction((purchaseId, now = Date.now()) => {
  const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
  if (!p || p.status === 'paid') return p;
  db.prepare("UPDATE purchases SET status='paid', paid_at=? WHERE id=?").run(now, purchaseId);
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(p.credits, p.user_id);
  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
});

/* Spend one credit for a seat. Returns false if the pocket is empty. */
const spendCredit = db.transaction((userId) => {
  const r = db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0').run(userId);
  return r.changes === 1;
});

function grantComp(userId, credits, reason) {
  const p = {
    id: id('pur'), user_id: userId, rail: 'comp', bundle: reason, credits, amount_cents: 0, sats: null,
    status: 'pending', ref: null, payment_request: null, created_at: Date.now(), paid_at: null,
  };
  db.prepare(`INSERT INTO purchases (id,user_id,rail,bundle,credits,amount_cents,sats,status,ref,payment_request,created_at,paid_at)
              VALUES (@id,@user_id,@rail,@bundle,@credits,@amount_cents,@sats,@status,@ref,@payment_request,@created_at,@paid_at)`).run(p);
  return creditPurchase(p.id);
}

/* ---------------------------------------------------------------------------
 * CARD — stub. A real integration creates a Stripe Checkout session here and
 * credits on the checkout.session.completed webhook, not on the redirect.
 * ------------------------------------------------------------------------ */
function cardCheckout(userId, bundleId, card) {
  const b = bundle(bundleId);
  if (!b) throw new Error('No such bundle.');
  const digits = String(card || '').replace(/\s+/g, '');
  if (digits && digits.length < 12) throw Object.assign(new Error('That card was declined by our imaginary bank.'), { status: 402 });
  const p = {
    id: id('pur'), user_id: userId, rail: 'card', bundle: b.id, credits: b.credits, amount_cents: b.cents, sats: null,
    status: 'pending', ref: `stub_${crypto.randomBytes(6).toString('hex')}`, payment_request: null,
    created_at: Date.now(), paid_at: null,
  };
  db.prepare(`INSERT INTO purchases (id,user_id,rail,bundle,credits,amount_cents,sats,status,ref,payment_request,created_at,paid_at)
              VALUES (@id,@user_id,@rail,@bundle,@credits,@amount_cents,@sats,@status,@ref,@payment_request,@created_at,@paid_at)`).run(p);
  return creditPurchase(p.id);
}

/* ---------------------------------------------------------------------------
 * LIGHTNING
 * ------------------------------------------------------------------------ */
async function createInvoice(userId, bundleId) {
  const b = bundle(bundleId);
  if (!b) throw new Error('No such bundle.');
  if (!POLICY.tickets.lightning.enabled) throw new Error('Bitcoin is not on at the moment.');
  const sats = Math.round((b.cents / 100) * SATS_PER_USD);
  const pid = id('pur');
  let ref, paymentRequest, expiresAt = Date.now() + 15 * 60 * 1000;

  if (PROVIDER === 'btcpay') {
    // BTCPay Greenfield API: create an invoice with the purchase id as metadata,
    // ask for the BOLT11 from the Lightning payment method.
    const base = process.env.BTCPAY_URL, store = process.env.BTCPAY_STORE;
    const res = await fetch(`${base}/api/v1/stores/${store}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${process.env.BTCPAY_API_KEY}` },
      body: JSON.stringify({ amount: (b.cents / 100).toFixed(2), currency: 'USD', metadata: { purchaseId: pid, userId } }),
    });
    if (!res.ok) throw new Error(`BTCPay refused the invoice (${res.status}).`);
    const inv = await res.json();
    const pm = await (await fetch(`${base}/api/v1/stores/${store}/invoices/${inv.id}/payment-methods`, {
      headers: { Authorization: `token ${process.env.BTCPAY_API_KEY}` },
    })).json();
    const ln = pm.find((m) => /LightningNetwork|LN/i.test(m.paymentMethod || m.paymentMethodId || ''));
    ref = inv.id; paymentRequest = ln ? ln.destination : null; expiresAt = Date.parse(inv.expirationTime) || expiresAt;
  } else {
    // Stub: a fake but plausible-looking BOLT11 string. Settle it from the
    // dev endpoint, which stands in for the provider's webhook.
    ref = `stub_${crypto.randomBytes(8).toString('hex')}`;
    paymentRequest = `lnbc${sats}n1stub${crypto.randomBytes(24).toString('hex')}`;
  }

  const p = {
    id: pid, user_id: userId, rail: 'lightning', bundle: b.id, credits: b.credits, amount_cents: b.cents, sats,
    status: 'pending', ref, payment_request: paymentRequest, created_at: Date.now(), paid_at: null,
  };
  db.prepare(`INSERT INTO purchases (id,user_id,rail,bundle,credits,amount_cents,sats,status,ref,payment_request,created_at,paid_at)
              VALUES (@id,@user_id,@rail,@bundle,@credits,@amount_cents,@sats,@status,@ref,@payment_request,@created_at,@paid_at)`).run(p);
  return { purchaseId: pid, paymentRequest, sats, cents: b.cents, credits: b.credits, expiresAt, provider: PROVIDER };
}

function invoiceStatus(purchaseId, userId) {
  const p = db.prepare('SELECT id, status, credits, sats, paid_at FROM purchases WHERE id = ? AND user_id = ?').get(purchaseId, userId);
  return p || null;
}

/* Verifies and applies a provider webhook. Returns the purchase it settled. */
function handleWebhook(headers, rawBody) {
  if (PROVIDER === 'btcpay') {
    // BTCPay signs the raw body with HMAC-SHA256 in "BTCPay-Sig: sha256=<hex>".
    const secret = process.env.BTCPAY_WEBHOOK_SECRET || '';
    const sig = String(headers['btcpay-sig'] || '');
    const expect = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!sig || sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
      throw Object.assign(new Error('bad signature'), { status: 401 });
    }
    const evt = JSON.parse(rawBody.toString('utf8'));
    if (evt.type !== 'InvoiceSettled') return null;
    const purchaseId = evt.metadata?.purchaseId
      || db.prepare("SELECT id FROM purchases WHERE ref = ? AND rail='lightning'").get(evt.invoiceId)?.id;
    return purchaseId ? creditPurchase(purchaseId) : null;
  }
  throw Object.assign(new Error('no webhook provider configured'), { status: 404 });
}

/* Stub settlement, for the DEV panel and tests: stands in for the webhook. */
function simulateSettle(purchaseId, userId) {
  const p = db.prepare("SELECT * FROM purchases WHERE id = ? AND user_id = ? AND rail='lightning'").get(purchaseId, userId);
  if (!p) return null;
  return creditPurchase(p.id);
}

module.exports = {
  PROVIDER, bundles, bundle, wallet, cardCheckout, createInvoice, invoiceStatus,
  handleWebhook, simulateSettle, creditPurchase, spendCredit, grantComp,
};
