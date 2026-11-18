const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/ai-review');
const Evidence = require('../server/ai-evidence');
const code = 'only-a-synthetic-access-code-123456';
const env = { ANTHROPIC_API_KEY: 'synthetic-provider-secret', LEAKSOK_AI_ACCESS_CODE: code };
// Synthetic single-meter evidence request (version 2). No real readings.
const input = (last = 15) => ({ version: 2, mode: 'meter', exportDate: '2026-10-31', cases: [{ caseId: 'm1',
  readings: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: i < 25 ? 5 : last })), totalReadingDays: 30,
  codes: Object.fromEntries(['leak','burst','dry','reverse','tamper','noConsumption','afterMeterText','acousticLeak','acousticOther','acousticUndetermined','follow'].map(k => [k, false])), minimumFlow: null,
  vendor: { average: 5, maximum: 15, interestRank: null, exportDate: '2026-10-31' },
  decision: { type: 'none', origin: 'none', confirmedDate: null, repairedDate: null, resetAfter: null, uncertain: false, lineType: 'unknown' }, incidents: [], areaGroup: null,
  importQuality: { exportRows: 30, reexports: 0, missingValues: 0, undated: 0, conflicts: 0 }, interference: { districtHeating: false, largeSubstation: false } }] });
const plan = evidence => ({ summary: 'Kontrollera förändringen.', order: ['m1'], sharedChecks: [],
  cases: [{ caseId: 'm1', summary: 'Ändrat mönster.', evidenceIds: [evidence.cases[0].evidence[0].id], hypotheses: [], nextChecks: ['Kontrollera på plats.'], limitations: [] }] });
const upstream = options => ({ ok: true, json: async () => ({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(plan(JSON.parse(JSON.parse(options.body).messages[0].content))) }], usage: { input_tokens: 500, output_tokens: 100 } }) });
async function request(handler, { body = input(), method = 'POST', token = code, headers = {} } = {}) {
  const result = { headers: {} };
  const res = { setHeader(k,v) { result.headers[k] = v; }, status(n) { result.status = n; return this; }, json(value) { result.body = value; return result; }, end() { return result; } };
  const info = console.info, warn = console.warn; console.info = console.warn = () => {};
  try { await handler({ method, url: '/api/ai-review', headers: { host: 'leaksok.example', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body }, res); }
  finally { console.info = info; console.warn = warn; }
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
test('The removed version 1 request and unknown versions are rejected before any provider call', async () => {
  let calls = 0; const handler = createHandler({ env, fetcher: () => { calls++; } });
  const legacy = { version: 1, readings: [{ date: '2026-01-01', value: 384 }], totalReadingDays: 1, exportDate: '2026-11-03',
    infoCodes: { leak: false, burst: false, dry: false, acousticLeak: false, follow: true }, neighborAddresses: 0, minimumFlow: null, localAssessment: { score: 8, confidence: 'tunt' } };
  for (const body of [legacy, { ...input(), version: 4 }, {}, null, []]) assert.equal((await request(handler, { body })).status, 400);
  assert.equal(calls, 0);
  assert.equal(require('../api/ai-review').validate, undefined);
});
test('One bounded structured request; a repeat uses cache without extra credits', async () => {
  const sent = [];
  const handler = createHandler({ env, fetcher: async (url, options) => { sent.push({ url, options }); return upstream(options); } });
  const a = await request(handler), b = await request(handler);
  assert.equal(a.status, 200); assert.equal(b.body.cached, true); assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].options.body);
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(body.max_tokens, 7000); assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.output_config.format.type, 'json_schema'); assert.equal(body.output_config.effort, 'medium'); assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.system, Evidence.prompt);
  assert.equal(sent[0].options.headers.Authorization, `Bearer ${env.ANTHROPIC_API_KEY}`);
  assert.equal(sent[0].options.headers['anthropic-version'], '2026-10-21');
  assert.deepEqual(JSON.parse(body.messages[0].content), Evidence.build(input()));
  assert.ok(!JSON.stringify(a.body).includes(env.ANTHROPIC_API_KEY));
});
test('Cross-origin, wrong content type and oversized bodies cannot spend credits', async () => {
  let calls = 0; const handler = createHandler({ env, fetcher: () => { calls++; } });
  assert.equal((await request(handler, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(handler, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(handler, { headers: { 'content-length': '700001' } })).status, 413);
  assert.equal(calls, 0);
});
test('Concurrent requests and immediate reruns are bounded before calling the provider', async () => {
  let release, calls = 0;
  const handler = createHandler({ env, now: () => 100000, fetcher: (url, options) => { calls++; return new Promise(resolve => { release = () => resolve(upstream(options)); }); } });
  const pending = request(handler);
  assert.equal((await request(handler)).status, 429);
  release(); await pending;
  assert.equal((await request(handler, { body: input(16) })).status, 429); assert.equal(calls, 1);
});
test('Provider failures, refusal and truncated output are not retried or returned as completed analysis', async () => {
  for (const response of [{ ok: false, status: 401 }, { ok: false, status: 429 }, { ok: true, json: async () => ({ stop_reason: 'max_tokens' }) }, { ok: true, json: async () => ({ stop_reason: 'refusal', content: [{ type: 'text', text: '{}' }] }) }, { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not JSON' }] }) }]) {
    let calls = 0; const handler = createHandler({ env, fetcher: async () => { calls++; return response; } });
    const result = await request(handler); assert.ok([429,502].includes(result.status));
    assert.equal(calls, 1); assert.equal(result.body.review, undefined);
  }
});
