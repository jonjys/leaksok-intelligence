const test = require('node:test');
const assert = require('node:assert/strict');
const Backup = require('../src/backup.js');
const snapshot = () => ({ files: [{ name: 'x.csv', exportDate: new Date('2026-09-28T06:30:00Z'), rows: [{ id: '1', current: 8, readAt: new Date('2026-09-28T04:00:00Z') }] }], labels: { '1': { type: 'leak', at: '2026-09-28T10:00:00Z', comment: 'Lyssna' } }, tripList: [{ id: '1' }] });
test('full säkerhetskopia återställer avläsningar, beslut och arbetslista utan kod eller mappbehörighet', () => {
  const source = snapshot(); source.profileId = 'secret'; source.code = '1234'; source.folder = 'private';
  const text = Backup.stringify(source); const restored = Backup.parse(text);
  assert.equal(restored.files[0].rows[0].current, 8); assert.equal(restored.labels['1'].comment, 'Lyssna');
  assert.equal(restored.tripList[0].id, '1'); assert.ok(!text.includes('secret') && !text.includes('1234') && !text.includes('private'));
});
test('sammanslagning är idempotent även när lagrade rader har hydratiserats', () => {
  const current = snapshot(), incoming = Backup.parse(Backup.stringify(current));
  incoming.files[0].rows[0].exportDate = incoming.files[0].exportDate;
  const merged = Backup.merge(current, incoming); assert.equal(merged.files.length, 1); assert.equal(merged.tripList.length, 1);
  assert.equal(Backup.merge(merged, incoming).files.length, 1);
});
test('nyare kommentarer och beslut behålls; nya exporter och arbetsmätare läggs till', () => {
  const current = snapshot(), incoming = snapshot();
  current.labels['1'].commentAt = '2026-09-30T10:00:00Z'; current.labels['1'].comment = 'Nytt';
  incoming.files[0].name = 'y.csv'; incoming.tripList.push({ id: '2' }); incoming.labels['2'] = { type: 'interesting' };
  const merged = Backup.merge(current, incoming);
  assert.equal(merged.labels['1'].comment, 'Nytt'); assert.equal(merged.files.length, 2); assert.equal(merged.tripList.length, 2);
  assert.equal(current.files.length, 1);
});
test('äldre beslutskopior stöds; okända versioner och trasiga värden avvisas', () => {
  assert.equal(Backup.parse(JSON.stringify({ labels: {}, tripList: [] })).files.length, 0);
  assert.throws(() => Backup.parse('{bad'));
  assert.throws(() => Backup.parse(JSON.stringify({ ...snapshot(), version: 2 })));
  const invalid = snapshot(); invalid.files[0].rows[0].current = -1;
  assert.throws(() => Backup.parse(JSON.stringify(invalid)), /ogiltig/);
});
test('en nyare status ersätter beslutet utan att tappa separat nyare kommentar och synlighet', () => {
  const current = snapshot(), incoming = snapshot();
  current.labels['1'] = { type: 'leak', at: '2026-09-28', comment: 'Ny kommentar', commentAt: '2026-10-03', hidden: true, visibilityUpdatedAt: '2026-10-04' };
  incoming.labels['1'] = { type: 'repaired', at: '2026-10-02', comment: 'Gammal kommentar', commentAt: '2026-10-01' };
  const result = Backup.merge(current, incoming).labels['1'];
  assert.equal(result.type, 'repaired'); assert.equal(result.comment, 'Ny kommentar'); assert.equal(result.hidden, true);
});
