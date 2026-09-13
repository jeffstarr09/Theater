'use strict';
/* Pseudonymous identity. No emails, no passwords — a cookie is a person. */

const { db } = require('./db');
const { id, token, pseudonym } = require('./ids');

const COOKIE = 'theater_token';

function userByToken(tok) {
  if (!tok) return null;
  return db.prepare('SELECT * FROM users WHERE token = ?').get(tok) || null;
}

function createUser({ handle, isHouse = false } = {}) {
  const user = {
    id: id('usr'), handle: handle || pseudonym(), token: token(),
    is_house: isHouse ? 1 : 0, created_at: Date.now(),
  };
  db.prepare('INSERT INTO users (id, handle, token, is_house, created_at) VALUES (@id,@handle,@token,@is_house,@created_at)').run(user);
  return user;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Express middleware: guarantees req.user exists. */
function identify(req, res, next) {
  let user = userByToken(req.cookies?.[COOKIE]);
  if (!user) {
    user = createUser();
    res.cookie(COOKIE, user.token, {
      httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 3600 * 1000,
    });
  }
  req.user = user;
  next();
}

/** For the websocket upgrade, where we can only read the cookie header. */
function userFromRequest(req) {
  return userByToken(parseCookies(req.headers?.cookie || '')[COOKIE]);
}

module.exports = { COOKIE, identify, userFromRequest, userByToken, createUser, parseCookies };
