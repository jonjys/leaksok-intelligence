/* A remembered browser session authorises AI calls; the Anthropic key is
   never a login credential. Rotating the access code revokes all sessions. */
const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const COOKIE = '__Host-leaksok_ai';
const SESSION_AGE = 30 * 86400;
const hash = value => createHash('sha256').update(value).digest();
const accessConfigured = env => typeof env.LEAKSOK_AI_ACCESS_CODE === 'string'
  && env.LEAKSOK_AI_ACCESS_CODE.length >= 24 && env.LEAKSOK_AI_ACCESS_CODE.length <= 512;
const configured = env => !!env.ANTHROPIC_API_KEY && accessConfigured(env);
const codeMatches = (env, code) => accessConfigured(env) && typeof code === 'string'
  && code.length <= 512 && timingSafeEqual(hash(code), hash(env.LEAKSOK_AI_ACCESS_CODE));
const signature = (env, value) => createHmac('sha256', env.LEAKSOK_AI_ACCESS_CODE)
  .update(`leaksok/ai-session/v1/${value}`).digest('base64url');

function sameOrigin(req, env, required = false) {
  const origin = req.headers.origin;
  if (!origin) return !required;
  const host = req.headers.host;
  return typeof host === 'string' && (origin === `https://${host}`
    || (env.NODE_ENV === 'test' && origin === `http://${host}`));
}
function sessionValid(req, env, now = Date.now()) {
  if (!configured(env)) return false;
  const prefix = `${COOKIE}=`;
  const cookies = String(req.headers.cookie || '').split(';').map(c => c.trim()).filter(c => c.startsWith(prefix));
  if (cookies.length !== 1) return false;
  const token = cookies[0].slice(prefix.length);
  const match = /^(\d{10})\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const [, expiry, nonce, mac] = match, seconds = Math.floor(now / 1000);
  return Number(expiry) > seconds && Number(expiry) <= seconds + SESSION_AGE
    && timingSafeEqual(Buffer.from(mac), Buffer.from(signature(env, `${expiry}.${nonce}`)));
}
function authCookie(env, now = Date.now()) {
  const value = `${Math.floor(now / 1000) + SESSION_AGE}.${randomBytes(18).toString('base64url')}`;
  return cookie(`${value}.${signature(env, value)}`, SESSION_AGE);
}
const cookie = (value, age) => `${COOKIE}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`;

function createHandler({ env = process.env, now = Date.now } = {}) {
  return function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, DELETE'); return res.status(405).end(); }
    if (!sameOrigin(req, env, true)) return res.status(403).json({ error: 'Öppna AI direkt i LeakSök.' });
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', cookie('', 0));
      return res.status(200).json({ authenticated: false });
    }
    if (!configured(env)) return res.status(503).json({ error: 'AI är inte konfigurerad på servern.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'Inloggningen behöver vara JSON.' });
    if (Number(req.headers['content-length']) > 4096 || Buffer.byteLength(JSON.stringify(req.body) || '') > 4096)
      return res.status(413).json({ error: 'För stor inloggningsförfrågan.' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !codeMatches(env, body.code))
      return res.status(401).json({ error: 'Fel åtkomstkod för LeakSök AI.' });
    res.setHeader('Set-Cookie', authCookie(env, now()));
    return res.status(200).json({ authenticated: true, days: 30 });
  };
}
module.exports = { createHandler, configured, accessConfigured, codeMatches, sameOrigin, sessionValid };
