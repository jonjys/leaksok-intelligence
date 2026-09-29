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
