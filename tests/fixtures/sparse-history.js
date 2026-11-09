// Anonymized screenshot-like pattern: daily snapshots only expose nine distinct
// reading days over a year. No serial/address from the user's data is included.
const observations = [
  ['2025-11-17', 384], ['2026-02-03', 409], ['2026-04-28', 360],
  ['2026-05-01', 368], ['2026-05-31', 380], ['2026-06-06', 405],
  ['2026-08-31', 368], ['2026-10-20', 395], ['2026-10-28', 394],
];
function sparseExports() {
  const samples = observations.map(([day, value]) => ({ date: new Date(`${day}T04:00:00`), value }));
  const files = [];
  let i = 0;
  for (let date = new Date('2026-01-01T06:30:00'); date <= new Date('2026-11-02T06:30:00'); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 6, 30)) {
    while (i + 1 < samples.length && samples[i + 1].date <= date) i++;
    const { date: readAt, value } = samples[i];
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    files.push({ name: `Dagsexport ${stamp} 06-30.csv`, exportDate: date, rows: [{ id: '99000999', serial: '99000999', address: 'GLAPPVÄGEN 1 TUMBA 14730', area: 'TUMBA', current: value, readAt, average: 390, max: 436 }] });
  }
  return files;
}
module.exports = { observations, sparseExports };
