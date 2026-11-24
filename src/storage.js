/* Local profile storage in IndexedDB.
   Key `<profile>` holds { labels, tripList, savedAt, fileKeys } and each
   imported export is stored under its own key `<profile>::file::<id>`. A year
   of daily exports is far larger than the largest single value a browser
   accepts (Chrome: about 133 MB), so the history must never be one value.
   Older profiles with `files` inside `<profile>` still load and are converted
   on the next save. Key `<profile>::state` holds only { labels, tripList,
   savedAt } so manual decisions and comments are saved without rewriting the
   history. On load the newer labels/tripList win. */
(function exposeLeakStorage(root) {
  const DB_NAME = "leaksok-intelligence";
  const STORE_NAME = "profiles";
  const VERSION = 1;
  const stateKey = (profileId) => `${profileId}::state`;
  const dailyKey = (profileId) => `${profileId}::daily-ai`;
  const fileKey = (profileId, file) => {
    const at = file?.exportDate instanceof Date ? file.exportDate.toISOString() : String(file?.exportDate ?? "");
    // revision ökar när en redan importerad export kompletteras med nya fält.
    return `${profileId}::file::${file?.name ?? ""}|${at}|${Array.isArray(file?.rows) ? file.rows.length : 0}|r${file?.revision || 0}`;
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error("IndexedDB saknas")); return; }
      const request = root.indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error("Kunde inte öppna lokal lagring"));
    });
  }

  // One transaction per call: either every put succeeds or none is reported saved.
  async function transact(mode, work) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      const results = {};
      try {
        transaction = database.transaction(STORE_NAME, mode);
        work(transaction.objectStore(STORE_NAME), results);
        transaction.oncomplete = () => { database.close(); resolve(results); };
        transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Lagringen avbröts")); };
        transaction.onerror = () => { /* onabort follows */ };
      } catch (error) {
        database.close();
        reject(error);
      }
    });
  }

  let writes = Promise.resolve();
  function queue(action) {
    const next = writes.catch(() => {}).then(action);
    writes = next;
    return next;
  }
  const time = (snapshot) => Date.parse(snapshot?.savedAt || "") || (snapshot?.savedAt instanceof Date ? snapshot.savedAt.getTime() : 0);

  // Reserve and finish in read/write transactions. Two tabs sharing a local
  // profile cannot both start today's automatic review.
  function updateDaily(profileId, change) {
    return queue(async () => {
      const { outcome } = await transact("readwrite", (store, out) => {
        store.get(dailyKey(profileId)).onsuccess = event => {
          const record = event.target.result || {};
          const next = change(record);
          out.outcome = next;
          if (next.record !== record) store.put(next.record, dailyKey(profileId));
        };
      });
      return outcome;
    });
  }

  root.LeakStorage = {
    available: Boolean(root.indexedDB),
    async loadDailyReview(profileId) {
      await writes.catch(() => {});
      const { record } = await transact("readonly", (store, out) => {
        store.get(dailyKey(profileId)).onsuccess = e => { out.record = e.target.result; };
      });
      return record || {};
    },
    async setDailyAuto(profileId, auto) {
      return (await updateDaily(profileId, record => ({ record: { ...record, auto: !!auto } }))).record;
    },
    reserveDailyReview(profileId, run, retry = false) {
      return updateDaily(profileId, record => {
        const { report, attempt } = record;
        if (report?.exportKey === run.exportKey) return { kind: "cached", record };
        if (attempt?.status === "running" && run.startedAt - attempt.startedAt < 150000) return { kind: "running", record };
        if (report?.day === run.day && report.result) return { kind: "done", record };
        if (attempt?.day === run.day && attempt.status !== "done" && !retry) return { kind: "retry", record };
        return { kind: "start", record: { ...record, attempt: { ...run, status: "running" } } };
      });
    },
    async finishDailyReview(profileId, runId, report, message = "") {
      return (await updateDaily(profileId, record => {
        if (record.attempt?.id !== runId) return { record };
        return { record: { ...record, ...(report ? { report } : {}), attempt: {
          ...record.attempt, status: report ? "done" : "failed", message,
        } } };
      })).record;
    },
    async resetDailyReview(profileId) {
      return (await updateDaily(profileId, record => ({ record: { auto: !!record.auto } }))).record;
    },
    async loadImportSource(profileId) {
      await writes.catch(() => {});
      const { source } = await transact("readonly", (store, out) => {
        store.get(`${profileId}::import-source`).onsuccess = (e) => { out.source = e.target.result; };
      });
      return source || null;
    },
    saveImportSource(profileId, source) {
      return queue(() => transact("readwrite", (store) => store.put(source, `${profileId}::import-source`)));
    },
    clearImportSource(profileId) {
      return queue(() => transact("readwrite", (store) => store.delete(`${profileId}::import-source`)));
    },
    async load(profileId) {
      await writes.catch(() => {});
      const { main, side } = await transact("readonly", (store, out) => {
        store.get(profileId).onsuccess = (e) => { out.main = e.target.result; };
        store.get(stateKey(profileId)).onsuccess = (e) => { out.side = e.target.result; };
      });
      if (!main && !side) return null;
      let files = main?.files || [];
      if (Array.isArray(main?.fileKeys) && main.fileKeys.length) {
        const { stored } = await transact("readonly", (store, out) => {
          out.stored = new Array(main.fileKeys.length);
          main.fileKeys.forEach((key, i) => { store.get(key).onsuccess = (e) => { out.stored[i] = e.target.result; }; });
        });
        const missing = stored.filter((file) => !file).length;
        if (missing) throw new Error(`${missing} sparade exporter saknas i den lokala lagringen. Importera dem igen eller återställ en säkerhetskopia.`);
        files = stored;
      }
      const newer = side && (!main || time(side) >= time(main)) ? side : main;
      return {
        files,
        labels: newer?.labels || main?.labels || {},
        tripList: newer?.tripList || main?.tripList || [],
        savedAt: newer?.savedAt || main?.savedAt,
      };
    },
    // Full snapshot including imported files (after import or clearing files).
    saveAll(profileId, snapshot) {
      const at = new Date().toISOString();
      const files = snapshot.files || [];
      const keys = files.map((file) => fileKey(profileId, file));
      const head = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: at, fileKeys: keys });
      const small = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: at });
      return queue(async () => {
        const { previous } = await transact("readonly", (store, out) => {
          store.get(profileId).onsuccess = (e) => { out.previous = e.target.result; };
        });
        const had = new Set(Array.isArray(previous?.fileKeys) ? previous.fileKeys : []);
        const keep = new Set(keys);
        // Only new exports are written; unchanged exports are already stored.
        // Everything lands in one transaction, so a failure saves nothing.
        return transact("readwrite", (store) => {
          files.forEach((file, i) => { if (!had.has(keys[i])) store.put(structuredClone(file), keys[i]); });
          for (const key of had) if (!keep.has(key)) store.delete(key);
          store.put(head, profileId);
          store.put(small, stateKey(profileId));
        });
      });
    },
    // Labels, comments and work list only.
    saveState(profileId, snapshot) {
      const small = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: new Date().toISOString() });
      return queue(() => transact("readwrite", (store) => { store.put(small, stateKey(profileId)); }));
    },
    // Backwards compatible alias used by older tests/tools.
    save(profileId, snapshot) { return this.saveAll(profileId, snapshot); },
    clear(profileId) {
      return queue(async () => {
        const { previous } = await transact("readonly", (store, out) => {
          store.get(profileId).onsuccess = (e) => { out.previous = e.target.result; };
        });
        return transact("readwrite", (store) => {
          for (const key of Array.isArray(previous?.fileKeys) ? previous.fileKeys : []) store.delete(key);
          store.delete(profileId); store.delete(stateKey(profileId)); store.delete(dailyKey(profileId));
        });
      });
    },
  };
}(typeof window !== "undefined" ? window : globalThis));

