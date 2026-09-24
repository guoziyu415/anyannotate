import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportDraft, renderMarkdown, renderText } from "../server/formats.js";
import { DraftStore } from "../server/store.js";

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anyannotate-test-"));
  const file = path.join(directory, "draft.json");
  return {
    file,
    store: new DraftStore(file),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

test("stores, updates, reorders, and deletes clips", () => {
  const { store, cleanup } = temporaryStore();
  try {
    store.append({ id: "one", quote: "First", annotation: "Note", tags: ["#mcp", "mcp"] });
    store.append({ id: "two", quote: "Second" });
    store.append({ id: "two", quote: "Duplicate retry" });

    let draft = store.read();
    assert.equal(draft.clips.length, 2);
    assert.deepEqual(draft.clips[0].tags, ["mcp"]);

    draft = store.update("one", { annotation: "Updated", source: "ChatGPT" });
    assert.equal(draft.clips[0].annotation, "Updated");
    assert.equal(draft.clips[0].source, "ChatGPT");

    draft = store.move("two", 0);
    assert.deepEqual(draft.clips.map((clip) => clip.id), ["two", "one"]);

    draft = store.remove("two");
    assert.deepEqual(draft.clips.map((clip) => clip.id), ["one"]);
    assert.ok(draft.stateVersion >= 4);
  } finally {
    cleanup();
  }
});

test("exports Markdown and text with annotations", () => {
  const { store, cleanup } = temporaryStore();
  try {
    store.setTitle("My / Notes");
    const draft = store.append({
      id: "one",
      quote: "Line one\nLine two",
      annotation: "Keep this",
      tags: ["useful"],
      source: "ChatGPT",
    });

    const markdown = renderMarkdown(draft);
    assert.match(markdown, /^# My \/ Notes/m);
    assert.match(markdown, /> Line one\n> Line two/);
    assert.match(markdown, /\*\*Annotation:\*\* Keep this/);
    assert.match(renderText(draft), /Annotation: Keep this/);
    assert.equal(exportDraft(draft, "md").filename, "My - Notes.md");
    assert.equal(exportDraft(draft, "txt").mimeType, "text/plain;charset=utf-8");
  } finally {
    cleanup();
  }
});

test("clear keeps the draft usable", () => {
  const { store, cleanup } = temporaryStore();
  try {
    store.append({ quote: "Temporary" });
    const draft = store.clear();
    assert.equal(draft.clips.length, 0);
    assert.equal(store.read().clips.length, 0);
  } finally {
    cleanup();
  }
});

test("does not overwrite an unreadable draft", () => {
  const { file, store, cleanup } = temporaryStore();
  try {
    fs.writeFileSync(file, "{not valid json", "utf8");
    assert.throws(() => store.read(), /left unchanged/);
    assert.equal(fs.readFileSync(file, "utf8"), "{not valid json");
  } finally {
    cleanup();
  }
});
