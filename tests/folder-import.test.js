const test = require('node:test');
const assert = require('node:assert/strict');
const Folder = require('../src/folder-import.js');

function setup(t, options = {}) {
  const files = new Map(); let permission = 'granted', stored = null, calls = 0, ready = true;
  const handle = { name: 'Exporter', async queryPermission() { return permission; }, async requestPermission() { permission = 'granted'; return permission; }, async *values() { for (const file of files.values()) yield { kind: 'file', name: file.name, async getFile() { return file; } }; } };
  const storage = { async loadImportSource() { return stored; }, async saveImportSource(id, source) { stored = { ...source, seen: { ...source.seen } }; }, async clearImportSource() { stored = null; } };
  const importer = Folder.create({ storage, pickDirectory: async opts => { assert.equal(opts.mode, 'read'); return handle; }, isReady: () => ready, onFiles: async pending => { calls++; return options.onFiles ? options.onFiles(pending) : { saved: true, accepted: pending.map(f => f.name) }; } });
  t.after(() => importer.pause());
  return { importer, files, storage, handle, get calls() { return calls; }, set permission(v) { permission = v; }, set ready(v) { ready = v; }, get stored() { return stored; } };
}
const file = (name, lastModified = 10, size = 100) => ({ name, lastModified, size });

test('mappimport läser nya och ändrade filer, skippar oförändrade och tillfälliga filer', async t => {
  const s = setup(t);
  for (const f of [file('a.xlsx'), file('b.csv'), file('~$a.xlsx'), file('empty.xls', 10, 0), file('notes.txt')]) s.files.set(f.name, f);
  await s.importer.open('profile'); await s.importer.connect();
  assert.equal(s.calls, 1); assert.deepEqual(Object.keys(s.stored.seen).sort(), ['a.xlsx', 'b.csv']);
  await s.importer.scan(); assert.equal(s.calls, 1);
  s.files.set('a.xlsx', file('a.xlsx', 20)); await s.importer.scan(); assert.equal(s.calls, 2);
  s.files.set('c.csv', file('c.csv')); await s.importer.scan(); assert.equal(s.calls, 3);
  await s.importer.disconnect(); assert.equal(s.stored, null); assert.equal(s.importer.getStatus().phase, 'disconnected');
});
test('misslyckad lagring kvitterar aldrig filen och en ny kontroll försöker igen', async t => {
  let succeed = false; const s = setup(t, { onFiles: pending => ({ saved: succeed, accepted: pending.map(f => f.name) }) });
  s.files.set('a.csv', file('a.csv')); await s.importer.open('p'); await s.importer.connect();
  assert.equal(s.importer.getStatus().phase, 'error'); assert.deepEqual(s.stored.seen, {});
  succeed = true; await s.importer.scan(); assert.equal(s.calls, 2); assert.equal(s.importer.getStatus().phase, 'connected');
});
test('lagrad mapp återanvänds utan omimport; återkallad behörighet kräver explicit återanslutning', async t => {
  const s = setup(t); s.files.set('a.csv', file('a.csv')); await s.importer.open('p'); await s.importer.connect();
  s.importer.pause(); await s.importer.open('p'); assert.equal(s.calls, 1);
  s.permission = 'prompt'; await s.importer.scan(); assert.equal(s.importer.getStatus().phase, 'permission');
  s.files.set('b.csv', file('b.csv')); await s.importer.resume(); assert.equal(s.calls, 2);
});
test('låst arbetsyta importerar inte och överlappande skanningar serialiseras', async t => {
  let finish; const s = setup(t, { onFiles: pending => new Promise(resolve => { finish = () => resolve({ saved: true, accepted: pending.map(f => f.name) }); }) });
  await s.importer.open('p'); s.ready = false; s.files.set('a.csv', file('a.csv')); await s.importer.connect(); assert.equal(s.calls, 0);
  s.ready = true; const first = s.importer.scan(); await new Promise(r => setImmediate(r));
  await s.importer.scan(); assert.equal(s.calls, 1); finish(); await first;
  assert.equal(s.importer.isBusy(), false);
});
test('en oläsbar fil kvitteras inte medan giltiga filer slipper omimport', async t => {
  const s = setup(t, { onFiles: () => ({ saved: true, accepted: ['good.csv'] }) });
  s.files.set('good.csv', file('good.csv')); s.files.set('bad.csv', file('bad.csv'));
  await s.importer.open('p'); await s.importer.connect();
  assert.equal(s.stored.seen['good.csv'], '100:10'); assert.equal(s.stored.seen['bad.csv'], undefined);
  assert.equal(s.importer.getStatus().phase, 'error');
});
test('en fil som inte kan öppnas blockerar inte de andra exporterna', async t => {
  const s = setup(t); const original = s.handle.values;
  s.handle.values = async function* () { yield { kind: 'file', name: 'locked.xlsx', async getFile() { throw new Error('busy'); } }; yield* original.call(this); };
  s.files.set('good.csv', file('good.csv')); await s.importer.open('p'); await s.importer.connect();
  assert.equal(s.calls, 1); assert.equal(s.stored.seen['good.csv'], '100:10');
  assert.equal(s.importer.getStatus().phase, 'error'); assert.match(s.importer.getStatus().message, /locked.xlsx/);
});
