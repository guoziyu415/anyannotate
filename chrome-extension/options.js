"use strict";

const elements = {
  fileName: document.getElementById("file-name"),
  permission: document.getElementById("permission"),
  choose: document.getElementById("choose"),
  authorize: document.getElementById("authorize"),
  disconnect: document.getElementById("disconnect"),
  count: document.getElementById("count"),
  export: document.getElementById("export"),
  clear: document.getElementById("clear"),
  message: document.getElementById("message")
};

elements.choose.addEventListener("click", chooseFile);
elements.authorize.addEventListener("click", authorizeFile);
elements.disconnect.addEventListener("click", disconnectFile);
elements.export.addEventListener("click", exportInbox);
elements.clear.addEventListener("click", clearInbox);
const google = Object.fromEntries([
  "panel", "status", "setup", "connect", "disconnect", "controls", "link", "select", "title", "create", "selected", "document", "tab", "export"
].map((id) => [id, document.getElementById(`google-${id}`)]));
const saveDestination = document.getElementById("save-destination");
const fileFormat = document.getElementById("file-format");
const exportFormat = document.getElementById("export-format");
fileFormat.addEventListener("change", () => refresh().catch((error) => showMessage(error.message, true)));
let googleBusy = false;
let messageTimer;
google.connect.addEventListener("click", () => googleAction({ type: "GOOGLE_CONNECT" }, "Google connected. Choose or create a document."));
google.disconnect.addEventListener("click", () => {
  if (confirm("Disconnect Google? Your Google documents and local annotations will not be deleted.")) {
    googleAction({ type: "GOOGLE_DISCONNECT" }, "Google disconnected. New clips will use local saving.");
  }
});
google.select.addEventListener("click", () => googleAction({ type: "GOOGLE_SELECT", link: google.link.value }, "Document selected. Choose Google Docs in your annotation's Save to selector."));
google.create.addEventListener("click", () => googleAction({ type: "GOOGLE_CREATE", title: google.title.value }, "Document created. Choose Google Docs in your annotation's Save to selector."));
google.export.addEventListener("click", () => googleAction({ type: "GOOGLE_EXPORT" }));
saveDestination.addEventListener("change", () => {
  if (["markdown", "txt"].includes(saveDestination.value)) fileFormat.value = saveDestination.value;
  googleAction({ type: "SET_SAVE_DESTINATION", destination: saveDestination.value }, "Default updated. You can still choose a different destination in each annotation.");
});
window.addEventListener("focus", () => { if (!googleBusy) void refresh().catch((error) => showMessage(error.message, true)); });
refresh().catch((error) => showMessage(error.message, true));

async function googleAction(payload, success) {
  if (googleBusy) return;
  googleBusy = true;
  for (const button of [google.connect, google.disconnect, google.select, google.create, google.export]) button.disabled = true;
  saveDestination.disabled = true;
  showMessage(payload.type === "GOOGLE_EXPORT" ? "Appending annotations to Google Docs…" : "Working…");
  try {
    const result = await chrome.runtime.sendMessage(payload);
    if (!result?.ok) throw new Error(result?.error || "Google Docs request failed.");
    showMessage(success || `Added ${result.exported} annotations; ${result.skipped} already present.${result.basicFormattingCount ? ` ${result.basicFormattingCount} saved with basic formatting because Google rejected the styling.` : ""}`);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    googleBusy = false;
    saveDestination.disabled = false;
    google.select.disabled = false;
    google.create.disabled = false;
    await refresh().catch((error) => showMessage(error.message, true));
  }
}

async function chooseFile() {
  if (!("showSaveFilePicker" in window)) {
    showMessage("This browser cannot connect a default file. Save an annotation to Markdown or TXT to download it instead.", true);
    return;
  }
  const format = fileFormat.value;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `AnyAnnotate-Inbox.${format === "txt" ? "txt" : "md"}`,
      excludeAcceptAllOption: true,
      types: format === "txt"
        ? [{ description: "Plain text file", accept: { "text/plain": [".txt"] } }]
        : [{ description: "Markdown file", accept: { "text/markdown": [".md", ".markdown"] } }]
    });
    const allowed = format === "txt" ? /\.txt$/i : /\.(md|markdown)$/i;
    if (!allowed.test(handle.name)) throw new Error(`Choose a ${format === "txt" ? ".txt" : ".md or .markdown"} file.`);
    await ensureHeader(handle, format);
    await putHandle(handle, format);
    await chrome.runtime.sendMessage({ type: "DEFAULT_FILE_CHANGED" });
    showMessage(`Connected ${handle.name}`);
    await refresh();
  } catch (error) {
    if (error.name !== "AbortError") showMessage(error.message || "The file could not be selected", true);
  }
}

async function authorizeFile() {
  const handle = await getHandle(fileFormat.value);
  if (!handle) return;
  const permission = await handle.requestPermission({ mode: "readwrite" });
  await chrome.runtime.sendMessage({ type: "DEFAULT_FILE_CHANGED" });
  showMessage(permission === "granted" ? "File permission restored" : "File write permission was not granted", permission !== "granted");
  await refresh();
}

async function disconnectFile() {
  if (!confirm("Disconnect the default file? Existing file content and local inbox entries will not be deleted.")) return;
  await deleteHandle(fileFormat.value);
  if (fileFormat.value === "markdown") await chrome.storage.local.remove("defaultFileName");
  await chrome.runtime.sendMessage({ type: "DEFAULT_FILE_CHANGED" });
  showMessage("Default file disconnected");
  await refresh();
}

async function exportInbox() {
  const result = await chrome.runtime.sendMessage({ type: "EXPORT_INBOX", format: exportFormat.value });
  showMessage(result.ok ? `Exporting ${result.count} annotations` : result.error, !result.ok);
}

async function clearInbox() {
  const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!status.count) {
    showMessage("The local inbox is already empty");
    return;
  }
  if (!confirm(`Permanently remove ${status.count} annotations from the local inbox? Exported files and Google documents will not be changed.`)) return;
  const result = await chrome.runtime.sendMessage({ type: "CLEAR_INBOX" });
  showMessage(result.ok ? "Local inbox cleared" : result.error, !result.ok);
  await refresh();
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!status?.ok) throw new Error(status?.error || "Settings could not be loaded.");
  elements.count.textContent = String(status.count || 0);
  const file = status.files[fileFormat.value];
  elements.fileName.textContent = file.connected ? file.name : "No file connected — choose a location when saving";
  elements.choose.textContent = `Choose or Create ${fileFormat.value === "txt" ? "TXT" : "Markdown"} File…`;
  elements.permission.textContent = permissionLabel(file.permission);
  elements.permission.dataset.state = file.permission;
  elements.authorize.classList.toggle("hidden", !file.connected || file.permission === "granted");
  elements.disconnect.classList.toggle("hidden", !file.connected);
  saveDestination.value = status.saveDestination;
  const state = status.google;
  const ready = state.configured && state.connected && state.document;
  google.status.textContent = !state.configured ? "Setup required" : state.connected ? "Connected" : "Not connected";
  google.setup.classList.toggle("hidden", state.configured);
  google.connect.textContent = state.connected ? "Reconnect Google" : "Connect Google";
  google.connect.disabled = googleBusy || !state.configured;
  google.disconnect.disabled = googleBusy;
  google.disconnect.classList.toggle("hidden", !state.connected);
  google.controls.classList.toggle("hidden", !state.connected);
  google.selected.classList.toggle("hidden", !state.document);
  google.export.disabled = googleBusy || !ready || !status.count;
  if (state.document) {
    google.document.textContent = state.document.title;
    google.document.href = state.document.url;
    google.tab.textContent = state.document.tabTitle;
  } else {
    google.document.textContent = "";
    google.document.removeAttribute("href");
  }
}

function permissionLabel(permission) {
  if (permission === "granted") return "Writable";
  if (permission === "prompt") return "Permission needed";
  if (permission === "denied") return "Denied";
  return "Not configured";
}

async function ensureHeader(handle, format) {
  const file = await handle.getFile();
  if (file.size > 0) return;
  const writable = await handle.createWritable();
  try {
    await writable.write(format === "txt" ? "AnyAnnotate\n\n" : "# AnyAnnotate\n\n");
  } finally {
    await writable.close();
  }
}

function getHandle(format) { return AnyAnnotateDatabase.getFileHandle(format); }
function putHandle(handle, format) { return AnyAnnotateDatabase.putFileHandle(handle, format); }
function deleteHandle(format) { return AnyAnnotateDatabase.deleteFileHandle(format); }

function showMessage(message, isError = false) {
  clearTimeout(messageTimer);
  elements.message.textContent = message;
  elements.message.classList.remove("hidden");
  elements.message.classList.toggle("error", isError);
  messageTimer = setTimeout(() => elements.message.classList.add("hidden"), isError ? 15_000 : 6000);
}
