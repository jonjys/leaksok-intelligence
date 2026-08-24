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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Kunde inte öppna lokal lagring"));
    });
  }

  async function withStore(mode, action) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Lagringen misslyckades"));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("Lagringen misslyckades"));
      };
    });
  }

  root.LeakStorage = {
    available: Boolean(root.indexedDB),
    load(profileId) {
      return withStore("readonly", (store) => store.get(profileId));
    },
    save(profileId, snapshot) {
      return withStore("readwrite", (store) => store.put(snapshot, profileId));
    },
    clear(profileId) {
      return withStore("readwrite", (store) => store.delete(profileId));
    },
  };
}(typeof window !== "undefined" ? window : globalThis));
