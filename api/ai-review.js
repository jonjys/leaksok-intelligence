/* Optional Claude second opinion. No meter identities, free-form prompts or
   client-selected models are accepted. Local analysis remains authoritative.
   Only server-computed evidence (versions 2 and 3) is sent to the provider. */
const { createHash } = require('node:crypto');
const Evidence = require('../server/ai-evidence');
const Session = require('../server/ai-session');
const MODEL = 'claude-sonnet-5-5';
// max_tokens caps thinking and answer together, and a truncated answer is
// discarded although it is billed. The reply allowance assumes a wordy but
// rule-abiding answer; the rest is reserved for adaptive thinking. 21 000 stays
// below the size where Anthropic expects streaming. See docs/AI-BUDGET.md.
const BUDGET = { ceiling: 21000,
  daily: { thinking: 6000, perCase: 625 },   // 24 cases: 6 000 + 15 000 = 21 000
  field: { thinking: 5000, perCase: 2000 } }; // 8 detailed cases: 5 000 + 16 000 = 21 000
function maxTokens(input) {
  const b = input.version === 3 ? BUDGET.daily : BUDGET.field;
  return Math.min(BUDGET.ceiling, b.thinking + input.cases.length * b.perCase);
}
const hash = value => createHash('sha256').update(value).digest();
function createHandler({ env = process.env, fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  let busy = false, windowAt = 0, calls = 0, lastCall = -Infinity;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const configured = Session.configured(env), authenticated = Session.sessionValid(req, env, now());
    if (req.method === 'GET') return res.status(200).json({ configured, authenticated, hasApiKey: !!env.ANTHROPIC_API_KEY, model: MODEL,
      needsAccessCode: !Session.accessConfigured(env), maxReadingDays: 1460, maxCases: Evidence.MAX_CASES, maxDetailedCases: 8,
      evidenceVersion: Evidence.VERSION, planVersion: Evidence.PLAN_VERSION });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    if (!configured) return res.status(503).json({ error: 'Claude behöver serverns API-nyckel och LEAKSOK_AI_ACCESS_CODE (minst 24 tecken).' });
    const credential = /^Bearer (.{1,512})$/.exec(String(req.headers.authorization || ''))?.[1];
    const legacy = Session.codeMatches(env, credential);
    if (!authenticated && !legacy) return res.status(401).json({ error: 'Aktivera AI på den här enheten först.' });
    if (!Session.sameOrigin(req, env, !legacy)) return res.status(403).json({ error: 'Anropet behöver komma från LeakSök.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'Underlaget behöver vara JSON.' });
    let input;
    try {
      const limit = req.body?.version === 3 ? 1900000 : 700000;
      if (Number(req.headers['content-length']) > limit || Buffer.byteLength(JSON.stringify(req.body) || '') > limit) return res.status(413).json({ error: 'För stort underlag.' });
      // Evidence.build accepts versions 2 and 3 only; anything else is rejected before any spend.
      input = Evidence.build(req.body);
    } catch (error) { return res.status(400).json({ error: error.message }); }
    const key = hash(JSON.stringify(input)).toString('hex'), cached = cache.get(key);
    if (cached && now() - cached.at < (input.mode === 'daily' ? 86400000 : 600000)) return res.status(200).json({ ...cached.result, cached: true });
    // These controls limit bursts in a warm function instance, not global spend.
    // A hard account budget belongs in the Anthropic workspace settings.
    if (now() - windowAt >= 3600000) { windowAt = now(); calls = 0; }
    if (busy || now() - lastCall < 10000 || calls >= 20) { res.setHeader('Retry-After', '10'); return res.status(429).json({ error: 'Vänta en stund före nästa Claude-bedömning.' }); }
    busy = true; calls++; lastCall = now();
    const compact = input.version === 3;
    const limit = maxTokens(input), startedAt = now();
    let stage = 'request', stopReason = null, outputTokens = 0, thinkingTokens = 0;
    try {
      const response = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(140000),
        headers: { Authorization: `Bearer ${env.ANTHROPIC_API_KEY}`, 'anthropic-version': '2026-10-21', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: limit,
          thinking: { type: 'adaptive' }, system: compact ? Evidence.planPrompt : Evidence.prompt,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
          output_config: { effort: compact ? 'low' : 'medium', format: { type: 'json_schema', schema: Evidence.schemaFor(input) } } }),
      });
      if (!response.ok) {
        const detail = response.json ? await response.json().catch(() => ({})) : {};
        console.warn('ai-review-upstream', { status: response.status, type: detail.error?.type });
        return res.status(response.status === 429 ? 429 : 502).json({ error: response.status === 429 ? 'Anthropic begränsar anropen just nu. Försök senare.' : 'Claude-anropet kunde inte slutföras. Kontrollera serverns nyckel, modellåtkomst och Anthropic-saldo.' });
      }
      const data = await response.json();
      stage = 'completion'; stopReason = data.stop_reason; outputTokens = Number(data.usage?.output_tokens) || 0;
      thinkingTokens = Number(data.usage?.output_tokens_details?.thinking_tokens) || 0;
      if (data.stop_reason !== 'end_turn') throw Error('Incomplete result');
      stage = 'parse';
      const parsed = JSON.parse((data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
      stage = 'validation';
      const review = Evidence.clean(parsed, input);
      const result = { review, model: data.model || MODEL, createdAt: new Date(now()).toISOString(),
        evidence: input, promptVersion: compact ? Evidence.PLAN_PROMPT_VERSION : 'field-plan-2.0',
        usage: { inputTokens: Number(data.usage?.input_tokens) || 0, outputTokens: Number(data.usage?.output_tokens) || 0 }, cached: false };
      // Counts only: never evidence, readings or text from the plan.
      console.info('ai-review-complete', { cases: input.cases.length, maxTokens: limit, outputTokens, thinkingTokens,
        seconds: Math.round((now() - startedAt) / 1000), removedReferences: review.removedReferences || 0,
        untraceableCases: review.cases.filter(c => c.untraceable).length });
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), result });
      return res.status(200).json(result);
    } catch (error) {
      const reason = /^AI_[A-Z_]+$/.test(error.code || '') ? error.code : 'incomplete';
      console.warn('ai-review-incomplete', { stage, reason, stopReason, outputTokens, thinkingTokens, maxTokens: limit,
        seconds: Math.round((now() - startedAt) / 1000), cases: input.cases.length });
      return res.status(502).json({ error: 'Claude gav inget komplett läsbart svar. Ingen automatisk omkörning görs.' });
    }
    finally { busy = false; }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.maxTokens = maxTokens;
