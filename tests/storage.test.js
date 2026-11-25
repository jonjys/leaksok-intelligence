const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Minimal in-memory IndexedDB with explicit transaction completion. Like a
// browser, read/write transactions run one at a time: a later one's requests
// see what an earlier one committed. Read-only ones read committed data.
function fakeIndexedDB({ failNext = false } = {}) {
  const data = new Map();
  const control = { failNext, pending: [] };
  let writer = Promise.resolve();
  const db = {
    close() {},
    transaction(_store, mode = "readonly") {
      const staged = [], waiting = [];
      let started = false, aborted = false;
      const request = (fn) => { if (started) queueMicrotask(fn); else waiting.push(fn); };
      const tx = {
        abort() { aborted = true; },
        objectStore: () => ({
          put(value, key) { staged.push(["put", key, value]); return {}; },
          delete(key) { staged.push(["delete", key]); return {}; },
          get(key) { const req = {}; request(() => req.onsuccess?.({ target: { result: data.get(key) } })); return req; },
        }),
      };
      const start = () => new Promise((finished) => {
        started = true;
        waiting.splice(0).forEach((fn) => queueMicrotask(fn));
        control.pending.push(() => {
          if (aborted || control.failNext) {
            if (!aborted) { control.failNext = false; tx.error = new Error("quota"); }
            tx.onabort(); finished(); return;
          }
          for (const [op, key, value] of staged) op === "put" ? data.set(key, value) : data.delete(key);
          tx.oncomplete(); finished();
        });
        setTimeout(() => control.pending.shift()?.(), 0);
      });
      if (mode === "readwrite") writer = writer.then(start); else queueMicrotask(start);
      return tx;
    },
  };
  return {
    data, control,
    indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } },
  };
}
function load(fake) {
  const root = { indexedDB: fake.indexedDB };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/storage.js"), "utf8"), { window: root, structuredClone, Promise, Error, Date, setTimeout, queueMicrotask });
  return root.LeakStorage;
}

test("importer och beslut sparas och laddas; nyare beslut vinner", async () => {
  const fake = fakeIndexedDB();
  const storage = load(fake);
  await storage.saveAll("p", { files: [{ name: "a.csv", rows: [1] }], labels: { a: { type: "leak" } }, tripList: [] });
  await new Promise((r) => setTimeout(r, 5));
  await storage.saveState("p", { labels: { a: { type: "repaired", comment: "klar" } }, tripList: [{ id: "a" }] });
  const loaded = await storage.load("p");
  assert.equal(loaded.files.length, 1, "Imported files remain after saving decisions");
  assert.equal(loaded.labels.a.type, "repaired");
  assert.equal(loaded.labels.a.comment, "klar");
  assert.equal(loaded.tripList.length, 1);
  assert.equal(fake.data.get("p").labels.a.type, "leak", "Full snapshot stays readable for older versions");
});

test("äldre profil utan separat beslutspost laddas oförändrad", async () => {
  const fake = fakeIndexedDB();
  fake.data.set("old", { files: [{ name: "x" }], labels: { b: { type: "seasonal" } }, tripList: [{ id: "b", reason: "legacy" }], savedAt: new Date("2026-09-01") });
  const loaded = await load(fake).load("old");
  assert.equal(loaded.labels.b.type, "seasonal");
  assert.equal(loaded.tripList[0].reason, "legacy");
});

test("avbruten transaktion rapporteras aldrig som sparad", async () => {
  const fake = fakeIndexedDB();
  const storage = load(fake);
  fake.control.failNext = true;
  await assert.rejects(storage.saveState("p", { labels: {}, tripList: [] }), /quota/);
  assert.equal(fake.data.has("p::state"), false);
});
test("mappanslutningen är profilspecifik och påverkas inte av full säkerhetslagring", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  await storage.saveImportSource("p", { name: "Exporter", handle: { kind: "directory" }, seen: { "a.csv": "100:1" } });
  await storage.saveAll("p", { files: [], labels: {}, tripList: [] });
  assert.equal((await storage.loadImportSource("p")).seen["a.csv"], "100:1");
  assert.equal(await storage.loadImportSource("other"), null);
  await storage.clearImportSource("p"); assert.equal(await storage.loadImportSource("p"), null);
});

test("Dagsgranskningen reserveras en gång och sparas även för nästa omladdning", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  const run = { id: "first", day: "2026-11-09", exportKey: "first-export", startedAt: 1000 };
  const a = await storage.reserveDailyReview("p", run);
  const b = await storage.reserveDailyReview("p", { ...run, id: "other" });
  assert.equal(a.kind, "start"); assert.equal(b.kind, "running");
  await storage.finishDailyReview("p", run.id, null, "AI gick inte att nå");
  assert.equal((await storage.reserveDailyReview("p", run)).kind, "retry");
  const retry = { ...run, id: "retry", startedAt: 10000 };
  assert.equal((await storage.reserveDailyReview("p", retry, true)).kind, "start");
  await storage.finishDailyReview("p", retry.id, { day: run.day, exportKey: run.exportKey, result: { review: "klart" } });
  const reloaded = load(fake);
  assert.equal((await reloaded.reserveDailyReview("p", retry, true)).kind, "cached");
  assert.equal((await reloaded.reserveDailyReview("p", { ...retry, exportKey: "second-export" }, true)).kind, "done");
  assert.equal((await reloaded.reserveDailyReview("p", { ...retry, day: "2026-11-10", exportKey: "tomorrow" })).kind, "start");
});


test("historiken sparas en export per post, aldrig som ett enda stort värde", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  const file = (name, n) => ({ name, exportDate: new Date(`2026-11-${String(n).padStart(2, "0")}T05:00:00Z`), rows: [{ id: name, current: n }] });
  await storage.saveAll("p", { files: [file("a.xlsx", 1), file("b.xlsx", 2)], labels: {}, tripList: [] });
  assert.equal(fake.data.get("p").files, undefined, "Huvudposten innehåller inga exporter");
  assert.equal(fake.data.get("p").fileKeys.length, 2);
  for (const key of fake.data.get("p").fileKeys) assert.ok(fake.data.get(key)?.rows, "Varje export har en egen post");
  // Nästa import skriver bara den nya exporten och tar bort den som försvann.
  const puts = [];
  const original = fake.data.set.bind(fake.data);
  fake.data.set = (key, value) => { puts.push(key); return original(key, value); };
  await storage.saveAll("p", { files: [file("b.xlsx", 2), file("c.xlsx", 3)], labels: {}, tripList: [] });
  assert.deepEqual(puts.filter((k) => k.includes("::file::")).length, 1, "Oförändrade exporter skrivs inte om");
  assert.equal([...fake.data.keys()].filter((k) => k.includes("::file::")).length, 2, "Borttagen export raderas");
  const loaded = await load(fake).load("p");
  assert.equal(loaded.files.map((f) => f.name).join(","), "b.xlsx,c.xlsx", "Ordningen behålls");
});

test("äldre profil med alla exporter i en post laddas och flyttas vid nästa sparning", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  fake.data.set("old", { files: [{ name: "x.xlsx", rows: [1] }, { name: "y.xlsx", rows: [2] }], labels: {}, tripList: [], savedAt: "2026-09-01T00:00:00Z" });
  const loaded = await storage.load("old");
  assert.equal(loaded.files.length, 2);
  await storage.saveAll("old", loaded);
  assert.equal(fake.data.get("old").files, undefined);
  assert.equal((await load(fake).load("old")).files.length, 2);
});

test("misslyckad historiksparning lämnar förra versionen orörd", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  await storage.saveAll("p", { files: [{ name: "a.xlsx", rows: [1] }], labels: {}, tripList: [] });
  const before = new Map(fake.data);
  // Läsning och skrivning är samma transaktion; avbryts den sparas ingenting.
  fake.control.failNext = true;
  const save = storage.saveAll("p", { files: [{ name: "a.xlsx", rows: [1] }, { name: "b.xlsx", rows: [2] }], labels: {}, tripList: [] });
  await assert.rejects(save, /quota/);
  assert.deepEqual([...fake.data.keys()].sort(), [...before.keys()].sort());
  assert.deepEqual(fake.data.get("p"), before.get("p"));
});

test("rensning tar bort alla sparade exporter för profilen", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  await storage.saveAll("p", { files: [{ name: "a.xlsx", rows: [1] }], labels: {}, tripList: [] });
  await storage.saveAll("q", { files: [{ name: "a.xlsx", rows: [1] }], labels: {}, tripList: [] });
  await storage.clear("p");
  assert.equal([...fake.data.keys()].filter((k) => k.startsWith("p")).length, 0);
  assert.equal((await storage.load("q")).files.length, 1, "Andra profiler påverkas inte");
});

test("en kompletterad export (ny revision) skrivs om", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  const file = { name: "a.xlsx", exportDate: "2026-11-01", rows: [{ id: "a", interestRank: null }] };
  await storage.saveAll("p", { files: [file], labels: {}, tripList: [] });
  await storage.saveAll("p", { files: [{ ...file, rows: [{ id: "a", interestRank: 2 }], revision: 1 }], labels: {}, tripList: [] });
  const loaded = await load(fake).load("p");
  assert.equal(loaded.files[0].rows[0].interestRank, 2);
  assert.equal([...fake.data.keys()].filter((k) => k.includes("::file::")).length, 1, "Gamla revisionen raderas");
});

// Samma dags export, exporterad igen med andra avläsningar: samma namn, datum
// och antal rader. Appen behåller båda; ingen av dem får skriva över den andra.
const morning = { name: "Leaksok 2026-11-01.xlsx", exportDate: new Date("2026-11-01T00:00:00Z"), rows: [{ id: "a", current: 10 }, { id: "b", current: 20 }] };
const afternoon = { ...morning, rows: [{ id: "a", current: 55 }, { id: "b", current: 21 }] };
const readings = (files) => [...files].map((f) => f.rows.map((r) => r.current).join("/")).sort();

test("två exporter med samma namn, datum och storlek överlever båda en omladdning", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  await storage.saveAll("p", { files: [morning], labels: {}, tripList: [] });
  await storage.saveAll("p", { files: [morning, afternoon], labels: {}, tripList: [] });
  const keys = fake.data.get("p").fileKeys;
  assert.equal(new Set(keys).size, 2, "Två olika nycklar");
  assert.deepEqual(readings((await load(fake).load("p")).files), ["10/20", "55/21"]);
  // Båda nya i samma sparning.
  const fresh = fakeIndexedDB(), other = load(fresh);
  await other.saveAll("p", { files: [morning, afternoon], labels: {}, tripList: [] });
  assert.deepEqual(readings((await load(fresh).load("p")).files), ["10/20", "55/21"]);
  // Samma innehåll ger samma nyckel: en omladdning skriver inte om något.
  const reloaded = await load(fresh).load("p");
  const puts = [], set = fresh.data.set.bind(fresh.data);
  fresh.data.set = (key, value) => { puts.push(key); return set(key, value); };
  await other.saveAll("p", { files: reloaded.files, labels: {}, tripList: [] });
  assert.equal(puts.filter((k) => k.includes("::file::")).length, 0);
});

test("en export utan namnkrock behåller sin nyckel och skrivs inte om", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  assert.deepEqual([...storage.fileKeys("p", [morning])], ["p::file::Leaksok 2026-11-01.xlsx|2026-11-01T00:00:00.000Z|2|r0"]);
  const [a, b] = storage.fileKeys("p", [morning, afternoon]);
  assert.notEqual(a, b);
  const [c, d] = storage.fileKeys("p", [morning, morning]);
  assert.notEqual(c, d, "Även identiska exporter får var sin nyckel");
});

test("två flikar som sparar samtidigt lämnar aldrig en hänvisning till en raderad export", async () => {
  const fake = fakeIndexedDB(), tabA = load(fake), tabB = load(fake);
  const x = { name: "x.xlsx", exportDate: "2026-11-01", rows: [{ id: "a", interestRank: null }] };
  const y = { name: "y.xlsx", exportDate: "2026-11-02", rows: [{ id: "a", interestRank: null }] };
  await tabA.saveAll("p", { files: [x], labels: {}, tripList: [] });
  // A kompletterar x (ny revision), B lägger till y med gamla x i minnet.
  await Promise.all([
    tabA.saveAll("p", { files: [{ ...x, rows: [{ id: "a", interestRank: 2 }], revision: 1 }], labels: {}, tripList: [] }),
    tabB.saveAll("p", { files: [x, y], labels: {}, tripList: [] }),
  ]);
  for (const key of fake.data.get("p").fileKeys) assert.ok(fake.data.has(key), `${key} finns`);
  const loaded = await load(fake).load("p");
  assert.equal(loaded.missing, 0);
  assert.equal(loaded.files.length, fake.data.get("p").fileKeys.length);
});

test("saknade exporter låser inte ute profilen; beslut och arbetslista öppnas", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  await storage.saveAll("p", { files: [morning, { ...morning, name: "b.xlsx" }], labels: { a: { type: "leak" } }, tripList: [{ id: "a" }] });
  fake.data.delete(fake.data.get("p").fileKeys[1]);
  const loaded = await load(fake).load("p");
  assert.equal(loaded.missing, 1);
  assert.equal(loaded.files.length, 1);
  assert.equal(loaded.labels.a.type, "leak");
  assert.equal(loaded.tripList.length, 1);
});

test("en huvudpost från förra versionen med samma nyckel två gånger repareras vid laddning", async () => {
  const fake = fakeIndexedDB(), storage = load(fake);
  const key = storage.fileKeys("p", [morning])[0];
  fake.data.set(key, morning);
  fake.data.set("p", { labels: {}, tripList: [], savedAt: "2026-11-25T10:00:00Z", fileKeys: [key, key] });
  const loaded = await storage.load("p");
  assert.equal(loaded.files.length, 1);
  assert.equal(loaded.missing, 0);
});
