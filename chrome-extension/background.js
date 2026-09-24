"use strict";

importScripts("lib/markdown.js", "lib/database.js", "lib/google-docs.js");

const googleDocs = AnyAnnotateGoogleDocs.createClient({
  identity: chrome.identity,
  getManifest: () => chrome.runtime.getManifest(),
});

const LEGACY_INBOX_KEY = "inbox";

let mutationQueue = Promise.resolve();
let migrationPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ installedAt: new Date().toISOString() });
  await ensureLegacyInboxMigrated();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
  return true;
});

async function handleMessage(message, sender) {
  if ((message?.type?.startsWith("GOOGLE_") || message?.type === "SET_SAVE_DESTINATION") &&
      (sender?.id !== chrome.runtime.id || !sender?.url?.startsWith(chrome.runtime.getURL("")))) {
    throw new Error("Manage Google Docs from the extension settings or popup.");
  }
  switch (message?.type) {
    case "SAVE_CLIP":
      return enqueueMutation(() => saveClip(message.clip, message.destination));
    case "EXPORT_INBOX":
      await mutationQueue;
      return exportInbox(message.format);
    case "CLEAR_INBOX":
      return enqueueMutation(clearInbox);
    case "GET_STATUS":
      await mutationQueue;
      return getStatus();
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case "DEFAULT_FILE_CHANGED":
      await mutationQueue;
      await chrome.storage.local.set({ fileSettingsChangedAt: Date.now() });
      return getStatus();
    case "GOOGLE_CONNECT":
      return enqueueMutation(async () => {
        await googleDocs.connect();
        await chrome.storage.local.set({ googleConnected: true });
        return getStatus();
      });
    case "GOOGLE_DISCONNECT":
      return enqueueMutation(async () => {
        await googleDocs.disconnect();
        await chrome.storage.local.remove(["googleConnected", "googleDocument"]);
        await chrome.storage.local.set({ saveDestination: "inbox" });
        return getStatus();
      });
    case "GOOGLE_SELECT":
    case "GOOGLE_CREATE":
      return enqueueMutation(async () => {
        const document = message.type === "GOOGLE_CREATE"
          ? await googleDocs.create(message.title) : await googleDocs.select(message.link);
        await chrome.storage.local.set({ googleDocument: document, googleConnected: true });
        return getStatus();
      });
    case "GOOGLE_EXPORT":
      return enqueueMutation(exportToGoogle);
    case "SET_SAVE_DESTINATION":
      return enqueueMutation(async () => {
        if (!["markdown", "txt", "inbox", "google", "local"].includes(message.destination)) throw new Error("Invalid save destination.");
        await chrome.storage.local.set({ saveDestination: message.destination });
        return getStatus();
      });
    default:
      return { ok: false, error: "Unknown operation" };
  }
}

function enqueueMutation(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

async function saveClip(rawClip, destination = "default") {
  if (!["default", "download", "markdown", "txt", "google", "inbox"].includes(destination)) {
    throw new Error("Invalid save destination.");
  }
  const clip = AnyAnnotateMarkdown.normalizeClip(rawClip);
  await saveToLocalInbox(clip);
  const { saveDestination = "local", googleDocument, googleConnected } = await chrome.storage.local.get(["saveDestination", "googleDocument", "googleConnected"]);
  const chosen = destination === "default" ? saveDestination : destination;
  // Old open tabs can still send default/download messages during an upgrade.
  const format = chosen === "txt" ? "txt" : "markdown";
  if (!["default", "download"].includes(destination)) {
    await chrome.storage.local.set({ saveDestination: destination });
  }
  if (chosen === "inbox") return { ok: true, savedLocally: true, savedTo: "inbox" };
  if (chosen === "google") {
    try {
      if (!googleConnected || !googleDocument || !googleDocs.configured()) {
        throw new Error("Connect Google and choose a document in Settings, then retry. Your annotation is safe in the local inbox.");
      }
      const result = await googleDocs.append(googleDocument, [clip]);
      return { ok: true, savedLocally: true, savedTo: "google", documentTitle: googleDocument.title,
        ...(result.basicFormattingCount ? { message: `Saved to Google Docs: ${googleDocument.title} (basic formatting; Google rejected the styling).` } : {}) };
    } catch (error) {
      return {
        ok: true, savedLocally: true, savedTo: "inbox", googleWriteFailed: true,
        message: `Saved to the local inbox. ${friendlyError(error)}`,
      };
    }
  }

  const entry = format === "txt" ? AnyAnnotateMarkdown.formatTextEntry(clip) : AnyAnnotateMarkdown.formatEntry(clip);
  const handle = chosen === "download" ? null : await getFileHandle(format);
  if (!handle) {
    if (chosen !== "local") {
      try {
        await downloadFile(entry, createEntryFilename(clip, format), format);
        return { ok: true, savedLocally: true, savedTo: "download", format };
      } catch (error) {
        return { ok: true, savedLocally: true, savedTo: "inbox", fileWriteFailed: true,
          message: `Saved to the local inbox. The download did not start: ${friendlyError(error)}` };
      }
    }
    return {
      ok: true,
      savedLocally: true,
      savedTo: "inbox",
      needsFile: true,
      message: "Saved to the local inbox. Connect a default Markdown file for direct file saves."
    };
  }

  try {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      return {
        ok: true,
        savedLocally: true,
        savedTo: "inbox",
        needsPermission: true,
        message: `Saved to the local inbox. Reauthorize the ${format === "txt" ? "TXT" : "Markdown"} file in Settings to resume direct saves.`
      };
    }
    await appendToFile(handle, entry, format);
    return { ok: true, savedLocally: true, savedTo: "default", fileName: handle.name };
  } catch (error) {
    return {
      ok: true,
      savedLocally: true,
      savedTo: "inbox",
      fileWriteFailed: true,
      message: `Saved to the local inbox, but the default file could not be updated: ${friendlyError(error)}`
    };
  }
}

async function saveToLocalInbox(clip) {
  await ensureLegacyInboxMigrated();
  await AnyAnnotateDatabase.putClip(clip);
}

async function getStatus() {
  await ensureLegacyInboxMigrated();
  const [{ defaultFileName = "", saveDestination = "local", googleConnected = false, googleDocument = null }, handle, textHandle, count] = await Promise.all([
    chrome.storage.local.get(["defaultFileName", "saveDestination", "googleConnected", "googleDocument"]),
    AnyAnnotateDatabase.getFileHandle(),
    AnyAnnotateDatabase.getFileHandle("txt"),
    AnyAnnotateDatabase.countClips()
  ]);

  async function describe(fileHandle) {
    let permission = "none";
    if (fileHandle) {
      try { permission = await fileHandle.queryPermission({ mode: "readwrite" }); }
      catch { permission = "denied"; }
    }
    return { name: fileHandle?.name || "", connected: Boolean(fileHandle), permission };
  }
  const files = { markdown: await describe(handle), txt: await describe(textHandle) };

  return {
    ok: true,
    count,
    defaultFileName: handle?.name || defaultFileName,
    hasDefaultFile: Boolean(handle),
    filePermission: files.markdown.permission,
    files,
    saveDestination: saveDestination === "local" ? (handle ? "markdown" : "inbox") : saveDestination,
    google: { configured: googleDocs.configured(), connected: googleConnected, document: googleDocument }
  };
}

async function exportToGoogle() {
  await ensureLegacyInboxMigrated();
  const clips = await AnyAnnotateDatabase.getClips();
  if (!clips.length) throw new Error("The local inbox is empty.");
  const { googleDocument } = await chrome.storage.local.get("googleDocument");
  clips.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const result = await googleDocs.append(googleDocument, clips.map(AnyAnnotateMarkdown.normalizeClip));
  return { ok: true, ...result };
}

async function exportInbox(format = "markdown") {
  if (!["markdown", "txt"].includes(format)) throw new Error("Invalid export format.");
  await ensureLegacyInboxMigrated();
  const inbox = await AnyAnnotateDatabase.getClips();
  if (!Array.isArray(inbox) || !inbox.length) {
    return { ok: false, error: "The local inbox is empty" };
  }
  inbox.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const text = format === "txt" ? AnyAnnotateMarkdown.formatTextDocument(inbox) : AnyAnnotateMarkdown.formatDocument(inbox);
  await downloadFile(text, `AnyAnnotate-Inbox-${dateStamp()}.${format === "txt" ? "txt" : "md"}`, format);
  return { ok: true, count: inbox.length };
}

async function clearInbox() {
  await ensureLegacyInboxMigrated();
  await AnyAnnotateDatabase.clearClips();
  return { ok: true, count: 0 };
}

async function appendToFile(handle, text, format = "markdown") {
  const file = await handle.getFile();
  // Read only the final bytes: keep existing content intact and separate the
  // new note from a paragraph even when the file has no trailing newline.
  const tail = file.size ? await file.slice(Math.max(0, file.size - 4)).text() : "";
  const newline = tail.endsWith("\r\n") ? "\r\n" : "\n";
  const separator = /(?:\r\n|\n){2}$/.test(tail) ? "" : tail.endsWith("\n") ? newline : "\n\n";
  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    if (file.size === 0) {
      await writable.write(format === "txt" ? "AnyAnnotate\n\n" : "# AnyAnnotate\n\n");
    } else {
      await writable.seek(file.size);
      if (separator) await writable.write(separator);
    }
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

async function downloadFile(text, filename, format) {
  const mime = format === "txt" ? "text/plain" : "text/markdown";
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({ url, filename, saveAs: true, conflictAction: "uniquify" });
}

function createEntryFilename(clip, format = "markdown") {
  const title = (clip.annotation.split(/\r?\n/).find(Boolean) || clip.kind)
    .replace(/[\\/:*?"<>|]/g, "-")
    .slice(0, 36);
  return `AnyAnnotate-${dateStamp()}-${title}.${format === "txt" ? "txt" : "md"}`;
}

function dateStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function getFileHandle(format) {
  return AnyAnnotateDatabase.getFileHandle(format);
}

function ensureLegacyInboxMigrated() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const stored = await chrome.storage.local.get(LEGACY_INBOX_KEY);
    const legacy = stored[LEGACY_INBOX_KEY];
    if (!Array.isArray(legacy) || legacy.length === 0) return;

    await AnyAnnotateDatabase.putClips(legacy);
    await chrome.storage.local.remove(LEGACY_INBOX_KEY);
  })().catch((error) => {
    migrationPromise = null;
    throw error;
  });
  return migrationPromise;
}

function friendlyError(error) {
  if (error?.name === "NotAllowedError") return "File access was denied. Reconnect the default file.";
  if (error?.name === "QuotaExceededError") return "Local storage is full. Export and clear the inbox before saving more clips.";
  if (error?.message) return error.message;
  return "The clip could not be saved. Try again.";
}
