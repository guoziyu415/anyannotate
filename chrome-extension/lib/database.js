(function exposeDatabase(root) {
  "use strict";

  const DB_NAME = "anyannotate-files";
  const DB_VERSION = 2;
  const HANDLE_STORE = "handles";
  const CLIP_STORE = "clips";
  // Versions before 0.6.4 stored the same data under the product's previous
  // internal name. Its contents are copied once, then the old database is removed.
  const LEGACY_DB_NAME = "answer-clipper-files";
  const LEGACY_MIGRATION_KEY = "legacy-database-migrated";
  const MIGRATION_WAIT_MS = 5_000;
  let legacyMigration = null;

  function handleKey(format = "markdown") {
    if (!["markdown", "txt"].includes(format)) throw new Error("Invalid file format.");
    return format === "txt" ? "default-txt" : "default-markdown";
  }

  async function openDatabase() {
    await migrateLegacyDatabaseOnce();
    return openCurrentDatabase();
  }

  function migrateLegacyDatabaseOnce() {
    if (!legacyMigration) {
      let timer;
      const migration = migrateLegacyDatabase().catch((error) => {
        // Never block saving because of the migration. The old database is only
        // removed after a successful copy, so the next start retries.
        legacyMigration = null;
        if (root.console) root.console.warn("AnyAnnotate could not migrate older local data.", error);
      }).finally(() => clearTimeout(timer));
      // Copies only add missing entries, so a slow migration may finish in the
      // background instead of delaying the user's save.
      legacyMigration = Promise.race([migration, new Promise((resolve) => { timer = setTimeout(resolve, MIGRATION_WAIT_MS); })]);
    }
    return legacyMigration;
  }

  async function migrateLegacyDatabase() {
    if (typeof root.indexedDB.databases !== "function") return;
    const databases = await root.indexedDB.databases();
    if (!databases.some((database) => database.name === LEGACY_DB_NAME)) return;

    const legacy = await readLegacyDatabase();
    if (!legacy) return;
    const database = await openCurrentDatabase();
    try {
      await new Promise((resolve, reject) => {
        let transaction;
        try {
          transaction = database.transaction([HANDLE_STORE, CLIP_STORE], "readwrite");
        } catch (error) {
          reject(error);
          return;
        }
        const handles = transaction.objectStore(HANDLE_STORE);
        const clips = transaction.objectStore(CLIP_STORE);
        // The marker is written in the same transaction as the copied data, so a
        // later retry can never restore clips the user has cleared since.
        const marker = handles.get(LEGACY_MIGRATION_KEY);
        marker.onsuccess = () => {
          if (marker.result) return;
          for (const [key, value] of legacy.handles) {
            const existing = handles.getKey(key);
            existing.onsuccess = () => { if (existing.result === undefined) handles.put(value, key); };
          }
          for (const clip of legacy.clips) {
            if (typeof clip?.id !== "string" && typeof clip?.id !== "number") continue;
            const existing = clips.getKey(clip.id);
            existing.onsuccess = () => { if (existing.result === undefined) clips.put(clip); };
          }
          handles.put(true, LEGACY_MIGRATION_KEY);
        };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    await deleteLegacyDatabase();
  }

  // Resolves null when the old database no longer exists, for example because
  // another extension page finished the migration first.
  function readLegacyDatabase() {
    return new Promise((resolve, reject) => {
      let missing = false;
      const request = root.indexedDB.open(LEGACY_DB_NAME);
      request.onupgradeneeded = () => {
        missing = true;
        request.transaction.abort();
      };
      request.onerror = () => (missing ? resolve(null) : reject(request.error));
      request.onsuccess = () => {
        const database = request.result;
        const names = [HANDLE_STORE, CLIP_STORE].filter((name) => database.objectStoreNames.contains(name));
        const result = { handles: [], clips: [] };
        if (!names.length) {
          database.close();
          resolve(result);
          return;
        }
        let transaction;
        try {
          transaction = database.transaction(names, "readonly");
        } catch (error) {
          database.close();
          reject(error);
          return;
        }
        if (names.includes(HANDLE_STORE)) {
          const cursor = transaction.objectStore(HANDLE_STORE).openCursor();
          cursor.onsuccess = () => {
            if (!cursor.result) return;
            result.handles.push([cursor.result.key, cursor.result.value]);
            cursor.result.continue();
          };
        }
        if (names.includes(CLIP_STORE)) {
          const clips = transaction.objectStore(CLIP_STORE).getAll();
          clips.onsuccess = () => { result.clips = clips.result; };
        }
        transaction.oncomplete = () => { database.close(); resolve(result); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  }

  function deleteLegacyDatabase() {
    return new Promise((resolve) => {
      const request = root.indexedDB.deleteDatabase(LEGACY_DB_NAME);
      request.onsuccess = () => resolve();
      // The copy is already committed. A failed or blocked delete is retried on
      // the next start and must not delay saving.
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  function openCurrentDatabase() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(HANDLE_STORE)) {
          database.createObjectStore(HANDLE_STORE);
        }
        if (!database.objectStoreNames.contains(CLIP_STORE)) {
          const clips = database.createObjectStore(CLIP_STORE, { keyPath: "id" });
          clips.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runRequest(storeName, mode, operation) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        let result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  function putClip(clip) {
    return runRequest(CLIP_STORE, "readwrite", (store) => store.put(clip));
  }

  async function putClips(clips) {
    if (!Array.isArray(clips) || clips.length === 0) return;
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(CLIP_STORE, "readwrite");
        const store = transaction.objectStore(CLIP_STORE);
        for (const clip of clips) store.put(clip);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  function getClips() {
    return runRequest(CLIP_STORE, "readonly", (store) => store.getAll());
  }

  function countClips() {
    return runRequest(CLIP_STORE, "readonly", (store) => store.count());
  }

  function clearClips() {
    return runRequest(CLIP_STORE, "readwrite", (store) => store.clear());
  }

  function getFileHandle(format) {
    return runRequest(HANDLE_STORE, "readonly", (store) => store.get(handleKey(format)));
  }

  function putFileHandle(handle, format) {
    return runRequest(HANDLE_STORE, "readwrite", (store) => store.put(handle, handleKey(format)));
  }

  function deleteFileHandle(format) {
    return runRequest(HANDLE_STORE, "readwrite", (store) => store.delete(handleKey(format)));
  }

  const api = {
    clearClips,
    countClips,
    deleteFileHandle,
    getClips,
    getFileHandle,
    putClip,
    putClips,
    putFileHandle,
  };
  root.AnyAnnotateDatabase = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
