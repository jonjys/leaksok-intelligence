const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, validate } = require('../api/ai-review');
const code = 'only-a-synthetic-access-code-123456';
const env = { ANTHROPIC_API_KEY: 'synthetic-provider-secret', LEAKSOK_AI_ACCESS_CODE: code };
const input = () => ({ version: 1, readings: [{ date: '2026-01-01', value: 384 }, { date: '2026-11-01', value: 394 }],
  totalReadingDays: 2, exportDate: '2026-11-03', infoCodes: { leak: false, burst: false, dry: false, acousticLeak: false, follow: true },
  neighborAddresses: 0, minimumFlow: null, localAssessment: { score: 8, confidence: 'tunt' } });
const review = { summary: 'Glest underlag.', observations: ['Två observerade dagar.'], possibleCauses: ['Flera möjliga orsaker.'], nextChecks: ['Jämför fler faktiska avläsningar.'], limitations: ['Luckor är inga avläsningar.'] };
const upstream = () => ({ ok: true, json: async () => ({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(review) }], usage: { input_tokens: 500, output_tokens: 100 } }) });
async function request(handler, { body = input(), method = 'POST', token = code, headers = {} } = {}) {
  const result = { headers: {} };
  const res = { setHeader(k,v) { result.headers[k] = v; }, status(n) { result.status = n; return this; }, json(value) { result.body = value; return result; }, end() { return result; } };
  await handler({ method, url: '/api/ai-review', headers: { host: 'leaksok.example', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body }, res);
  return result;
}
test('Missing server access code fails closed; status and auth never reveal the provider key', async () => {
  let calls = 0;
  const off = createHandler({ env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }, fetcher: () => { calls++; } });
  assert.equal((await request(off)).status, 503);
  const status = await request(off, { method: 'GET' });
  assert.equal(status.body.configured, false); assert.equal(status.body.needsAccessCode, true);
  const on = createHandler({ env, fetcher: () => { calls++; } });
  for (const token of ['', '1234', env.ANTHROPIC_API_KEY]) assert.equal((await request(on, { token })).status, 401);
  assert.equal(calls, 0); assert.ok(!JSON.stringify(status).includes(env.ANTHROPIC_API_KEY));
});
test('Private identity fields, duplicated days, invalid dates and non-numeric levels are rejected', () => {
  for (const mutate of [p => { p.address = 'PRIVATE'; }, p => { p.readings[0].serial = 'PRIVATE'; }, p => { p.readings[1].date = p.readings[0].date; }, p => { p.readings[0].date = '2026-02-30'; }, p => { p.readings[0].value = '384'; }, p => { p.infoCodes.follow = 'inject prompt'; }, p => { p.localAssessment.prompt = 'inject'; }]) {
    const p = input(); mutate(p); assert.throws(() => validate(p));
  }
});
test('Coverage is recomputed from actual reading days including the stale tail', () => {
  const p = validate(input());
  assert.equal(p.coverage.selectedDays, 2); assert.equal(p.coverage.expectedDays, 307);
  assert.equal(p.coverage.missingDays, 305); assert.equal(p.coverage.maxGapDays, 303);
  const truncated = input(); truncated.totalReadingDays = 300;
  assert.equal(validate(truncated).coverage.truncated, true);
});
test('One bounded structured request; a repeat uses cache without extra credits', async () => {
  const sent = [];
  const handler = createHandler({ env, fetcher: async (url, options) => { sent.push({ url, options }); return upstream(); } });
  const a = await request(handler), b = await request(handler);
  assert.equal(a.status, 200); assert.equal(b.body.cached, true); assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].options.body);
  assert.equal(body.max_tokens, 1600); assert.equal(body.thinking.type, 'between_tools');
  assert.equal(body.output_config.format.type, 'json_schema'); assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(sent[0].options.headers.Authorization, `Bearer ${env.ANTHROPIC_API_KEY}`);
  assert.deepEqual(JSON.parse(body.messages[0].content), validate(input()));
  assert.ok(!JSON.stringify(a.body).includes(env.ANTHROPIC_API_KEY));
});
test('Cross-origin, wrong content type and oversized bodies cannot spend credits', async () => {
  let calls = 0; const handler = createHandler({ env, fetcher: () => { calls++; } });
  assert.equal((await request(handler, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(handler, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(handler, { headers: { 'content-length': '24001' } })).status, 413);
  assert.equal(calls, 0);
});
test('Concurrent requests and immediate reruns are bounded before calling the provider', async () => {
  let release, calls = 0;
  const handler = createHandler({ env, now: () => 100000, fetcher: () => { calls++; return new Promise(resolve => { release = () => resolve(upstream()); }); } });
  const pending = request(handler);
  assert.equal((await request(handler)).status, 429);
  release(); await pending;
  const p = input(); p.readings[1].value++;
  assert.equal((await request(handler, { body: p })).status, 429); assert.equal(calls, 1);
});
test('Provider failures, refusal and truncated output are not retried or returned as completed analysis', async () => {
  for (const response of [{ ok: false, status: 401 }, { ok: false, status: 429 }, { ok: true, json: async () => ({ stop_reason: 'max_tokens' }) }, { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not JSON' }] }) }]) {
    let calls = 0; const handler = createHandler({ env, fetcher: async () => { calls++; return response; } });
    const result = await request(handler); assert.ok([429,502].includes(result.status));
    assert.equal(calls, 1); assert.equal(result.body.review, undefined);
  }
});
