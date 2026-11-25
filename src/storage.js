/* Local profile storage in IndexedDB.
   Key `<profile>` holds { labels, tripList, savedAt, fileKeys } and each
   imported export is stored under its own key `<profile>::file::<id>`. A year
   of daily exports is far larger than the largest single value a browser
   accepts (Chrome: about 133 MB), so the history must never be one value.
   Older profiles with `files` inside `<profile>` still load and are converted
   on the next save. Key `<profile>::state` holds only { labels, tripList,
   savedAt } so manual decisions and comments are saved without rewriting the
   history. On load the newer labels/tripList win.

   An export's key is name|date|rows|revision. Two exports that share all four
   (the same day's file exported again with other readings, or a backup copy
   with other metadata) are told apart by a hash of their rows, so neither
   can overwrite the other. Every history save reads the previous head and
   writes in ONE read/write transaction: IndexedDB runs those one at a time,
   so another tab cannot delete an export between the read and the write. */
(function exposeLeakStorage(root) {
  const DB_NAME = "leaksok-intelligence";
  const STORE_NAME = "profiles";
  const VERSION = 1;
  const stateKey = (profileId) => `${profileId}::state`;
  const dailyKey = (profileId) => `${profileId}::daily-ai`;
  const baseKey = (profileId, file) => {
    const at = file?.exportDate instanceof Date ? file.exportDate.toISOString() : String(file?.exportDate ?? "");
    // revision ökar när en redan importerad export kompletteras med nya fält.
    return `${profileId}::file::${file?.name ?? ""}|${at}|${Array.isArray(file?.rows) ? file.rows.length : 0}|r${file?.revision || 0}`;
  };
  // cyrb53 over the rows. Only computed for exports whose base key is shared.
  function contentHash(file) {
    const text = JSON.stringify(file?.rows ?? null) || "";
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  // One distinct key per export, in the order of `files`.
  function fileKeys(profileId, files) {
    const base = files.map((file) => baseKey(profileId, file));
    const shared = new Map();
    for (const key of base) shared.set(key, (shared.get(key) || 0) + 1);
    const used = new Set();
    return base.map((key, i) => {
      const wanted = shared.get(key) > 1 ? `${key}|h${contentHash(files[i])}` : key;
      let next = wanted;
      for (let n = 2; used.has(next); n++) next = `${wanted}#${n}`;
      used.add(next);
      return next;
    });
  }

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
  // `work` may call fail(error) from a request callback to abort the whole call.
  async function transact(mode, work) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      const results = {};
      const fail = (error) => {
        results.error = error;
        try { transaction.abort(); } catch { /* already finished */ }
      };
      try {
        transaction = database.transaction(STORE_NAME, mode);
        work(transaction.objectStore(STORE_NAME), results, fail);
        transaction.oncomplete = () => { database.close(); resolve(results); };
        transaction.onabort = () => { database.close(); reject(results.error || transaction.error || new Error("Lagringen avbröts")); };
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
    // Never refuses to open a profile: decisions and the work list must stay
    // reachable even if some stored exports are gone. `missing` counts them.
    async load(profileId) {
      await writes.catch(() => {});
      // Head and exports in ONE transaction: a save from another tab cannot
      // land in between and make an export look missing.
      const { main, side, stored = [] } = await transact("readonly", (store, out) => {
        store.get(profileId).onsuccess = (e) => {
          out.main = e.target.result;
          if (!Array.isArray(out.main?.fileKeys)) return;
          // A head saved by an earlier version could list the same key twice.
          const keys = [...new Set(out.main.fileKeys)];
          out.stored = new Array(keys.length);
          keys.forEach((key, i) => { store.get(key).onsuccess = (ev) => { out.stored[i] = ev.target.result; }; });
        };
        store.get(stateKey(profileId)).onsuccess = (e) => { out.side = e.target.result; };
      });
      if (!main && !side) return null;
      let files = main?.files || [], missing = 0;
      if (Array.isArray(main?.fileKeys) && main.fileKeys.length) {
        missing = stored.filter((file) => !file).length;
        files = stored.filter(Boolean);
      }
      const newer = side && (!main || time(side) >= time(main)) ? side : main;
      return {
        files,
        missing,
        labels: newer?.labels || main?.labels || {},
        tripList: newer?.tripList || main?.tripList || [],
        savedAt: newer?.savedAt || main?.savedAt,
      };
    },
    // Full snapshot including imported files (after import or clearing files).
    saveAll(profileId, snapshot) {
      const at = new Date().toISOString();
      const files = snapshot.files || [];
      const keys = fileKeys(profileId, files);
      const head = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: at, fileKeys: keys });
      const small = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: at });
      return queue(() => transact("readwrite", (store, out, fail) => {
        // Read the previous head inside the write transaction. Only exports
        // that are not stored yet are written; a key that is already listed
        // holds exactly this content, because the key includes its revision
        // and, when needed, a hash of its rows.
        store.get(profileId).onsuccess = (e) => {
          try {
            const previous = e.target.result;
            const had = new Set(Array.isArray(previous?.fileKeys) ? previous.fileKeys : []);
            const keep = new Set(keys);
            files.forEach((file, i) => {
              if (!had.has(keys[i])) { store.put(structuredClone(file), keys[i]); return; }
              // Listed before, but is the record really there? An export that
              // went missing and is imported or restored again must be written.
              store.count(keys[i]).onsuccess = (ev) => {
                try { if (!ev.target.result) store.put(structuredClone(file), keys[i]); } catch (error) { fail(error); }
              };
            });
            for (const key of had) if (!keep.has(key)) store.delete(key);
            store.put(head, profileId);
            store.put(small, stateKey(profileId));
          } catch (error) { fail(error); }
        };
      }));
    },
    // Labels, comments and work list only.
    saveState(profileId, snapshot) {
      const small = structuredClone({ labels: snapshot.labels, tripList: snapshot.tripList, savedAt: new Date().toISOString() });
      return queue(() => transact("readwrite", (store) => { store.put(small, stateKey(profileId)); }));
    },
    // Backwards compatible alias used by older tests/tools.
    save(profileId, snapshot) { return this.saveAll(profileId, snapshot); },
    clear(profileId) {
      return queue(() => transact("readwrite", (store) => {
        store.get(profileId).onsuccess = (e) => {
          const previous = e.target.result;
          for (const key of Array.isArray(previous?.fileKeys) ? previous.fileKeys : []) store.delete(key);
          store.delete(profileId); store.delete(stateKey(profileId)); store.delete(dailyKey(profileId));
        };
      }));
    },
    // Exposed for tests.
    fileKeys,
  };
}(typeof window !== "undefined" ? window : globalThis));

