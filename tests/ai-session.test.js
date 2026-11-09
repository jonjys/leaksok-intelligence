const test = require('node:test');
const assert = require('node:assert/strict');
const Session = require('../server/ai-session');
const { createHandler: reviewHandler } = require('../api/ai-review');

const code = 'synthetic-only-access-code-32chars';
const env = { LEAKSOK_AI_ACCESS_CODE: code, ANTHROPIC_API_KEY: 'synthetic-provider-key' };
const now = Date.parse('2026-11-09T09:00:00Z');
const same = { host: 'leaksok.example', origin: 'https://leaksok.example', 'content-type': 'application/json' };
async function call(handler, method, headers, body) {
  const response = { headers: {} };
  const res = { setHeader(k, v) { response.headers[k] = v; }, status(s) { response.status = s; return this; },
    json(value) { response.body = value; }, end() {} };
  await handler({ method, headers, body }, res);
  return response;
}

test('Activation remembers an opaque HttpOnly session and never returns the credentials', async () => {
  const handler = Session.createHandler({ env, now: () => now });
  assert.equal((await call(handler, 'POST', same, { code: env.ANTHROPIC_API_KEY })).status, 401);
  const result = await call(handler, 'POST', same, { code });
  assert.equal(result.status, 200);
  const set = result.headers['Set-Cookie'], cookie = set.split(';')[0];
  assert.match(set, /^__Host-leaksok_ai=/);
  assert.match(set, /Path=\/; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict/);
  assert.ok(!JSON.stringify(result).includes(code));
  assert.ok(!JSON.stringify(result).includes(env.ANTHROPIC_API_KEY));
  assert.equal(Session.sessionValid({ headers: { cookie } }, env, now), true);
  assert.equal(Session.sessionValid({ headers: { cookie: cookie.slice(0,-1) + (cookie.endsWith('a') ? 'b' : 'a') } }, env, now), false);
  assert.equal(Session.sessionValid({ headers: { cookie } }, { ...env, LEAKSOK_AI_ACCESS_CODE: code + 'rotated' }, now), false);
  assert.equal(Session.sessionValid({ headers: { cookie } }, env, now + 30 * 86400000), false);
  assert.match((await call(handler, 'DELETE', same)).headers['Set-Cookie'], /Max-Age=0/);
});

test('Cross-origin or missing-origin browser calls cannot sign in or use the paid review endpoint', async () => {
  const session = Session.createHandler({ env, now: () => now });
  const review = reviewHandler({ env, now: () => now, fetcher: async () => assert.fail('No paid call expected') });
  assert.equal((await call(session, 'POST', { ...same, origin: 'https://other.example' }, { code })).status, 403);
  const result = await call(session, 'POST', same, { code }), cookie = result.headers['Set-Cookie'].split(';')[0];
  const status = await call(review, 'GET', { cookie }, null);
  assert.equal(status.body.authenticated, true); assert.equal(status.body.maxCases, 24);
  assert.equal((await call(review, 'POST', { ...same, cookie, origin: undefined }, {})).status, 403);
  assert.equal((await call(review, 'POST', { ...same, cookie, origin: 'https://other.example' }, {})).status, 403);
  assert.equal((await call(review, 'POST', { ...same, cookie }, {})).status, 400, 'Cookie authorised; only the deliberately invalid body is rejected');
});
