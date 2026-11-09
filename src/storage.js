/* Local profile storage in IndexedDB.
   Key `<profile>` holds the full snapshot { files, labels, tripList, savedAt }
   (unchanged format). Key `<profile>::state` holds only { labels, tripList,
   savedAt } so manual decisions and comments are saved without rewriting every
   imported export. On load the newer labels/tripList win. */
(function exposeLeakStorage(root) {
  const DB_NAME = "leaksok-intelligence";
  const STORE_NAME = "profiles";
  const VERSION = 1;
  const stateKey = (profileId) => `${profileId}::state`;
  const dailyKey = (profileId) => `${profileId}::daily-ai`;

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
      const newer = side && (!main || time(side) >= time(main)) ? side : main;
      return {
        files: main?.files || [],
        labels: newer?.labels || main?.labels || {},
        tripList: newer?.tripList || main?.tripList || [],
        savedAt: newer?.savedAt || main?.savedAt,
      };
    },
    // Full snapshot including imported files (after import or clearing files).
    saveAll(profileId, snapshot) {
      const at = new Date().toISOString();
      const full = structuredClone({ ...snapshot, savedAt: at });
      const small = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: at });
      return queue(() => transact("readwrite", (store) => { store.put(full, profileId); store.put(small, stateKey(profileId)); }));
    },
    // Labels, comments and work list only.
    saveState(profileId, snapshot) {
      const small = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: new Date().toISOString() });
      return queue(() => transact("readwrite", (store) => { store.put(small, stateKey(profileId)); }));
    },
    // Backwards compatible alias used by older tests/tools.
    save(profileId, snapshot) { return this.saveAll(profileId, snapshot); },
    clear(profileId) {
      return queue(() => transact("readwrite", (store) => { store.delete(profileId); store.delete(stateKey(profileId)); store.delete(dailyKey(profileId)); }));
    },
  };
}(typeof window !== "undefined" ? window : globalThis));

