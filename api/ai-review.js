/* Optional Claude second opinion. No meter identities, free-form prompts or
   client-selected models are accepted. Local analysis remains authoritative. */
const { createHash, timingSafeEqual } = require('node:crypto');
const MODEL = 'claude-sonnet-5-5';
const MAX_BYTES = 24000;
const PROMPT = `Du är ett försiktigt stöd för svensk VA-drift. Bedöm endast det anonymiserade underlaget i JSON.
Brusvärden är Kamstrup-exportens nivåvärden utan angiven enhet, inte dB eller läckflöde. Avläsningsdagar är faktiska observationer, inte exportdagar. Tolka aldrig luckor som stabilitet, noll eller avlästa värden. En hög oförändrad nivå kan ha flera orsaker; en varaktig förändring mot egen historik är mer informativ. Procent från noll saknar mening. Bekräfta aldrig läcka, läckans läge eller före/efter mätaren från brus ensamt. LEAK/BURST är stöd för möjlig kundsideskontroll; DRY gör brusbedömning osäker. Positivt minimiflöde kan vara legitim förbrukning och kräver färskt datum. Områdessignal beskriver gemensam påverkan utan känd ledningskoppling. Appens poäng är rangordning, inte sannolikhet. Respektera lokala beslut och ändra dem inte.
Svara kort på svenska: observationer med datum och faktiska värden, möjliga orsaker tydligt som hypoteser, konkreta nästa kontroller och vad som saknas. Skilj observerat från tolkat. Påstå inte att du sett READy, kartan, tillverkardokument eller andra data. Ge inga påhittade gränsvärden. Underlaget kan vara ett begränsat urval av historiken. Ingen läcksannolikhet i procent. Högst fyra korta punkter per lista.`;
const outputSchema = { type: 'object', additionalProperties: false,
  properties: Object.fromEntries(['summary', 'observations', 'possibleCauses', 'nextChecks', 'limitations'].map(k => [k,
    k === 'summary' ? { type: 'string' } : { type: 'array', items: { type: 'string' } }])),
  required: ['summary', 'observations', 'possibleCauses', 'nextChecks', 'limitations'] };
const hash = value => createHash('sha256').update(value).digest();
const date = v => typeof v === 'string' && /^20\d\d-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000000;
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Ogiltigt underlag.');
  const allowed = ['version', 'readings', 'totalReadingDays', 'exportDate', 'infoCodes', 'neighborAddresses', 'minimumFlow', 'localAssessment'];
  if (Object.keys(body).some(k => !allowed.includes(k)) || body.version !== 1 || !date(body.exportDate)) throw Error('Ogiltigt underlag.');
  if (!Array.isArray(body.readings) || !body.readings.length || body.readings.length > 180) throw Error('Välj en mätare med 1–180 avläsningsdagar i urvalet.');
  let previous = '';
  const readings = body.readings.map(p => {
    if (!p || Object.keys(p).some(k => !['date', 'value'].includes(k)) || !date(p.date) || !number(p.value) || p.date <= previous || p.date > body.exportDate) throw Error('Avläsningarna behöver giltiga, unika datum i tidsordning.');
    previous = p.date; return { date: p.date, value: p.value };
  });
  if (!Number.isInteger(body.totalReadingDays) || body.totalReadingDays < readings.length || body.totalReadingDays > 100000) throw Error('Ogiltigt antal avläsningsdagar.');
  const infoCodes = {};
  if (!body.infoCodes || Object.keys(body.infoCodes).some(k => !['leak', 'burst', 'dry', 'acousticLeak', 'follow'].includes(k))) throw Error('Ogiltiga infokoder.');
  for (const k of ['leak', 'burst', 'dry', 'acousticLeak', 'follow']) {
    if (typeof body.infoCodes[k] !== 'boolean') throw Error('Ogiltiga infokoder.');
    infoCodes[k] = body.infoCodes[k];
  }
  if (!Number.isInteger(body.neighborAddresses) || body.neighborAddresses < 0 || body.neighborAddresses > 10000) throw Error('Ogiltigt områdesunderlag.');
  const a = body.localAssessment;
  if (!a || Object.keys(a).some(k => !['score', 'confidence'].includes(k)) || !Number.isInteger(a.score) || a.score < 0 || a.score > 100 || !['tunt', 'medel', 'starkt'].includes(a.confidence)) throw Error('Ogiltig lokal bedömning.');
  let minimumFlow = null;
  if (body.minimumFlow !== null) {
    const f = body.minimumFlow;
    if (!f || Object.keys(f).some(k => !['valueLph', 'date'].includes(k)) || !number(f.valueLph) || (f.date !== null && !date(f.date))) throw Error('Ogiltigt minimiflöde.');
    minimumFlow = { valueLph: f.valueLph, date: f.date };
  }
  const expectedDays = Math.round((Date.parse(body.exportDate) - Date.parse(readings[0].date)) / 86400000) + 1;
  let maxGapDays = 0;
  for (let i = 1; i < readings.length; i++) maxGapDays = Math.max(maxGapDays, Math.round((Date.parse(readings[i].date) - Date.parse(readings[i-1].date)) / 86400000) - 1);
  maxGapDays = Math.max(maxGapDays, Math.round((Date.parse(body.exportDate) - Date.parse(readings.at(-1).date)) / 86400000));
  return { version: 1, readings, totalReadingDays: body.totalReadingDays, exportDate: body.exportDate,
    coverage: { selectedDays: readings.length, expectedDays, missingDays: expectedDays - readings.length, maxGapDays, truncated: body.totalReadingDays > readings.length },
    infoCodes, neighborAddresses: body.neighborAddresses, minimumFlow, localAssessment: { score: a.score, confidence: a.confidence } };
}
function cleanResult(value) {
  if (!value || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1200) throw Error('Ogiltigt AI-svar.');
  const result = { summary: value.summary.trim() };
  for (const k of ['observations', 'possibleCauses', 'nextChecks', 'limitations']) {
    if (!Array.isArray(value[k]) || value[k].length > 6 || value[k].some(s => typeof s !== 'string' || !s.trim() || s.length > 1200)) throw Error('Ogiltigt AI-svar.');
    result[k] = value[k].map(s => s.trim());
  }
  return result;
}
function createHandler({ env = process.env, fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  let busy = false, windowAt = 0, calls = 0, lastCall = -Infinity;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const configured = !!env.ANTHROPIC_API_KEY && (env.LEAKSOK_AI_ACCESS_CODE || '').length >= 24;
    if (req.method === 'GET') return res.status(200).json({ configured, hasApiKey: !!env.ANTHROPIC_API_KEY, model: MODEL,
      needsAccessCode: (env.LEAKSOK_AI_ACCESS_CODE || '').length < 24, maxReadingDays: 180 });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    if (!configured) return res.status(503).json({ error: 'Claude behöver serverns API-nyckel och LEAKSOK_AI_ACCESS_CODE (minst 24 tecken).' });
    const credential = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (credential.length > 512 || !timingSafeEqual(hash(credential), hash(env.LEAKSOK_AI_ACCESS_CODE))) return res.status(401).json({ error: 'Fel åtkomstkod för Claude.' });
    if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}` && !(env.NODE_ENV === 'test' && req.headers.origin === `http://${req.headers.host}`)) return res.status(403).json({ error: 'Anropet behöver komma från LeakSök.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'Underlaget behöver vara JSON.' });
    let input;
    try {
      if (Number(req.headers['content-length']) > MAX_BYTES || Buffer.byteLength(JSON.stringify(req.body) || '') > MAX_BYTES) return res.status(413).json({ error: 'För stort underlag.' });
      input = validate(req.body);
    } catch (error) { return res.status(400).json({ error: error.message }); }
    const key = hash(JSON.stringify(input)).toString('hex'), cached = cache.get(key);
    if (cached && now() - cached.at < 600000) return res.status(200).json({ ...cached.result, cached: true });
    // These controls limit bursts in a warm function instance, not global spend.
    // A hard account budget belongs in the Anthropic workspace settings.
    if (now() - windowAt >= 3600000) { windowAt = now(); calls = 0; }
    if (busy || now() - lastCall < 10000 || calls >= 20) { res.setHeader('Retry-After', '10'); return res.status(429).json({ error: 'Vänta en stund före nästa Claude-bedömning.' }); }
    busy = true; calls++; lastCall = now();
    try {
      const response = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${env.ANTHROPIC_API_KEY}`, 'anthropic-version': '2026-10-21', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1600, thinking: { type: 'between_tools' }, system: PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
          output_config: { format: { type: 'json_schema', schema: outputSchema } } }),
      });
      if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: response.status === 429 ? 'Anthropic begränsar anropen just nu. Försök senare.' : 'Claude-anropet kunde inte slutföras. Kontrollera serverns nyckel, modellåtkomst och Anthropic-saldo.' });
      const data = await response.json();
      if (data.stop_reason !== 'end_turn') throw Error('Incomplete result');
      const review = cleanResult(JSON.parse((data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')));
      const result = { review, model: data.model || MODEL, createdAt: new Date(now()).toISOString(),
        usage: { inputTokens: Number(data.usage?.input_tokens) || 0, outputTokens: Number(data.usage?.output_tokens) || 0 }, cached: false };
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), result });
      return res.status(200).json(result);
    } catch { return res.status(502).json({ error: 'Claude gav inget komplett läsbart svar. Ingen automatisk omkörning görs.' }); }
    finally { busy = false; }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.validate = validate;
