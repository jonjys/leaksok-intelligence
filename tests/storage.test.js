const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Minimal in-memory IndexedDB with explicit transaction completion.
function fakeIndexedDB({ failNext = false } = {}) {
  const data = new Map();
  const control = { failNext, pending: [] };
  const db = {
    close() {},
    transaction() {
      const staged = [];
      const tx = {
        objectStore: () => ({
          put(value, key) { staged.push(["put", key, value]); return {}; },
          delete(key) { staged.push(["delete", key]); return {}; },
          get(key) { const req = {}; queueMicrotask(() => req.onsuccess?.({ target: { result: data.get(key) } })); return req; },
        }),
      };
      control.pending.push(() => {
        if (control.failNext) { control.failNext = false; tx.error = new Error("quota"); tx.onabort(); return; }
        for (const [op, key, value] of staged) op === "put" ? data.set(key, value) : data.delete(key);
        tx.oncomplete();
      });
      setTimeout(() => control.pending.shift()?.(), 0);
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
  const reads = fake.control;
  // Läsningen går igenom, skrivningen avbryts.
  const failWrite = () => { reads.failNext = true; };
  const save = storage.saveAll("p", { files: [{ name: "a.xlsx", rows: [1] }, { name: "b.xlsx", rows: [2] }], labels: {}, tripList: [] });
  await new Promise((r) => setTimeout(r, 2)); failWrite();
  await assert.rejects(save, /quota/);
  assert.deepEqual([...fake.data.keys()].sort(), [...before.keys()].sort());
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
