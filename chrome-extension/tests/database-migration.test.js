"use strict";

require("fake-indexeddb/auto");

const test = require("node:test");
const assert = require("node:assert/strict");

const LEGACY_DB_NAME = "answer-clipper-files";

function request(value) {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

async function createLegacyDatabase({ handles = {}, clips = [] }) {
  const open = indexedDB.open(LEGACY_DB_NAME, 2);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("handles");
    open.result.createObjectStore("clips", { keyPath: "id" }).createIndex("createdAt", "createdAt", { unique: false });
  };
  const database = await request(open);
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(["handles", "clips"], "readwrite");
    for (const [key, value] of Object.entries(handles)) transaction.objectStore("handles").put(value, key);
    for (const clip of clips) transaction.objectStore("clips").put(clip);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function databaseNames() {
  return (await indexedDB.databases()).map((database) => database.name).sort();
}

// Each test file runs in its own process, so the module starts before any migration.
test("data saved before the rename moves to the new database once", async () => {
  await createLegacyDatabase({
    handles: { "default-markdown": { name: "Notes.md" }, "default-txt": { name: "Notes.txt" } },
    clips: [
      { id: "older-1", quote: "First", createdAt: "2026-08-01T00:00:00Z" },
      { id: "older-2", quote: "Second", createdAt: "2026-08-02T00:00:00Z" },
    ],
  });
  const database = require("../lib/database.js");

  const [clips, markdown, txt] = await Promise.all([
    database.getClips(), database.getFileHandle(), database.getFileHandle("txt"),
  ]);
  assert.deepEqual(clips.map((clip) => clip.id).sort(), ["older-1", "older-2"]);
  assert.equal(markdown.name, "Notes.md");
  assert.equal(txt.name, "Notes.txt");
  assert.deepEqual(await databaseNames(), ["anyannotate-files"]);

  // A cleared inbox stays cleared even if an old database appears again.
  await database.clearClips();
  await createLegacyDatabase({ clips: [{ id: "older-1", quote: "First", createdAt: "2026-08-01T00:00:00Z" }] });
  delete require.cache[require.resolve("../lib/database.js")];
  const restarted = require("../lib/database.js");
  assert.equal(await restarted.countClips(), 0);
  assert.deepEqual(await databaseNames(), ["anyannotate-files"]);
});
