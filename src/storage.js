(function exposeLeakStorage(root) {
  const DB_NAME = "leaksok-intelligence";
  const STORE_NAME = "profiles";
  const VERSION = 1;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error("IndexedDB saknas"));
        return;
      }
      const request = root.indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error("Kunde inte öppna lokal lagring"));
    });
  }

  async function withStore(mode, action) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        let result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { /* onabort is the authoritative failure. */ };
        transaction.oncomplete = () => { database.close(); resolve(result); };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error || request.error || new Error("Lagringen avbröts"));
        };
        transaction.onerror = () => { /* Wait for abort; never report a saved snapshot early. */ };
      } catch (error) {
        database.close();
        reject(error);
      }
    });
  }

  let writes = Promise.resolve();
  function write(action) {
    const next = writes.catch(() => {}).then(action);
    writes = next;
    return next;
  }

  root.LeakStorage = {
    available: Boolean(root.indexedDB),
    load(profileId) {
      return writes.catch(() => {}).then(() => withStore("readonly", (store) => store.get(profileId)));
    },
    save(profileId, snapshot) {
      const copy = structuredClone(snapshot);
      return write(() => withStore("readwrite", (store) => store.put(copy, profileId)));
    },
    clear(profileId) {
      return write(() => withStore("readwrite", (store) => store.delete(profileId)));
    },
  };
}(typeof window !== "undefined" ? window : globalThis));
