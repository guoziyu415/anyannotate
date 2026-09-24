(function anyAnnotateContentScript() {
  "use strict";

  if (window.top !== window || document.getElementById("anyannotate-root")) return;

  const host = document.createElement("div");
  host.id = "anyannotate-root";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; }
      button, textarea, input, select { font: inherit; }
      .hidden { display: none !important; }
      #bubble {
        position: fixed; z-index: 2; border: 1px solid rgba(127,127,127,.25); border-radius: 999px;
        padding: 7px 12px; color: #fff; background: #18181b; box-shadow: 0 8px 28px rgba(0,0,0,.22);
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer;
      }
      #bubble:hover { background: #27272a; transform: translateY(-1px); }
      #overlay {
        position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; padding: 20px;
        background: rgba(0,0,0,.42); backdrop-filter: blur(2px);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #dialog {
        width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px)); overflow: auto;
        border-radius: 16px; padding: 20px; color: #18181b; background: #fff;
        box-shadow: 0 24px 80px rgba(0,0,0,.32);
      }
      h2 { margin: 0 0 14px; font-size: 18px; }
      label { display: block; margin: 12px 0 6px; font-weight: 650; }
      #quote { max-height: 132px; overflow: auto; white-space: pre-wrap; border-radius: 10px; padding: 10px 12px; background: #f4f4f5; color: #3f3f46; }
      textarea { width: 100%; min-height: 110px; resize: vertical; border: 1px solid #d4d4d8; border-radius: 10px; padding: 10px; color: #18181b; background: #fff; outline: none; }
      textarea:focus, input:focus, select:focus { border-color: #71717a; box-shadow: 0 0 0 3px rgba(113,113,122,.13); }
      .row { display: grid; grid-template-columns: 145px 1fr; gap: 10px; }
      details { margin-top: 12px; }
      summary { color: #71717a; cursor: pointer; font-size: 12px; }
      .metadata-hint { color: #71717a; font-size: 12px; margin: 8px 0 0; }
      input, select { width: 100%; height: 38px; border: 1px solid #d4d4d8; border-radius: 9px; padding: 0 9px; color: #18181b; background: #fff; outline: none; }
      #destination { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #f4f4f5; }
      #destination-text { min-width: 0; flex: 1; color: #52525b; font-size: 12px; }
      .link-button { border: 0; padding: 3px; color: #2563eb; background: transparent; cursor: pointer; font-weight: 600; }
      #error { margin-top: 10px; color: #b91c1c; font-size: 13px; }
      .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      .button { border: 1px solid #d4d4d8; border-radius: 9px; padding: 8px 12px; color: #27272a; background: #fff; cursor: pointer; font-weight: 600; }
      .button:hover { background: #f4f4f5; }
      .primary { border-color: #18181b; color: #fff; background: #18181b; }
      .primary:hover { background: #27272a; }
      .button:disabled { opacity: .55; cursor: wait; }
      #toast { position: fixed; left: 50%; bottom: 28px; z-index: 5; transform: translateX(-50%); max-width: min(520px, calc(100vw - 32px)); border-radius: 10px; padding: 10px 14px; color: #fff; background: #18181b; box-shadow: 0 10px 36px rgba(0,0,0,.3); font: 13px/1.4 -apple-system, sans-serif; }
      @media (prefers-color-scheme: dark) {
        #dialog { color: #f4f4f5; background: #18181b; }
        #quote, #destination { color: #d4d4d8; background: #27272a; }
        #destination-text { color: #d4d4d8; }
        textarea, input, select { border-color: #52525b; color: #f4f4f5; background: #27272a; }
        .button { border-color: #52525b; color: #f4f4f5; background: #27272a; }
        .primary { border-color: #f4f4f5; color: #18181b; background: #f4f4f5; }
      }
    </style>
    <button id="bubble" class="hidden" type="button" aria-label="Annotate selected text">Annotate</button>
    <div id="overlay" class="hidden">
      <section id="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">Add Annotation</h2>
        <label>Selected Text</label>
        <div id="quote"></div>
        <label for="annotation">Annotation</label>
        <textarea id="annotation" placeholder="Write a thought, question, or follow-up note…"></textarea>
        <details id="more-options">
          <summary>More options</summary>
          <div class="row">
            <div>
              <label for="kind">Category</label>
              <select id="kind">
                <option>Thought</option><option>Question</option><option>Verify</option><option>Highlight</option>
              </select>
            </div>
            <div>
              <label for="tags">Tags</label>
              <input id="tags" placeholder="reading, ideas" />
            </div>
          </div>
          <p class="metadata-hint">Category and tags stay in your local inbox, not in the exported note.</p>
        </details>
        <label for="save-destination">Save to</label>
        <select id="save-destination" aria-describedby="destination-text">
          <option value="markdown">Markdown (.md)</option>
          <option value="txt">Plain text (.txt)</option>
          <option value="google">Google Docs</option>
          <option value="inbox">Local inbox (export later)</option>
        </select>
        <div id="destination">
          <span id="destination-text">Loading save settings…</span>
          <button id="configure" class="link-button" type="button">Settings</button>
        </div>
        <div id="error" class="hidden" role="alert"></div>
        <div class="actions">
          <button id="cancel" class="button" type="button">Cancel</button>
          <button id="save" class="button primary" type="button">Save</button>
        </div>
      </section>
    </div>
    <div id="toast" class="hidden" role="status"></div>
  `;

  const ui = Object.fromEntries([
    "bubble", "overlay", "quote", "annotation", "kind", "tags", "destination-text",
    "configure", "error", "cancel", "save-destination", "more-options", "save", "toast"
  ].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), root.getElementById(id)]));

  let captured = null;
  let toastTimer = null;
  let destinationStatus = null;
  let saving = false;
  let destinationChosen = false;
  let dialogVersion = 0;

  document.addEventListener("mouseup", () => setTimeout(updateSelection, 10), true);
  document.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift") setTimeout(updateSelection, 10);
  }, true);
  document.addEventListener("mousedown", (event) => {
    if (!event.composedPath().includes(host)) hideBubble();
  }, true);
  window.addEventListener("scroll", hideBubble, { passive: true, capture: true });
  window.addEventListener("resize", hideBubble, { passive: true });

  ui.bubble.addEventListener("click", openDialog);
  ui.cancel.addEventListener("click", closeDialog);
  ui.overlay.addEventListener("mousedown", (event) => {
    if (event.target === ui.overlay) closeDialog();
  });
  ui.configure.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
  });
  ui.save.addEventListener("click", submit);
  ui.saveDestination.addEventListener("change", () => {
    destinationChosen = true;
    setError("");
    renderDestination();
  });
  window.addEventListener("focus", () => {
    if (!ui.overlay.classList.contains("hidden") && !saving) void refreshDestination();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !ui.overlay.classList.contains("hidden") && !saving) void refreshDestination();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && !ui.overlay.classList.contains("hidden") && !saving &&
        ["googleConnected", "googleDocument", "fileSettingsChangedAt"].some((key) => key in changes)) {
      void refreshDestination();
    }
  });
  ui.annotation.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !ui.overlay.classList.contains("hidden")) closeDialog();
  }, true);

  function updateSelection() {
    if (!ui.overlay.classList.contains("hidden")) return;
    const selection = window.getSelection();
    let focusedElement = document.activeElement;
    while (focusedElement?.shadowRoot?.activeElement) focusedElement = focusedElement.shadowRoot.activeElement;
    if (document.designMode === "on" ||
        isEditingOrInternal(focusedElement) ||
        isEditingOrInternal(selection?.anchorNode) ||
        isEditingOrInternal(selection?.focusNode)) {
      captured = null;
      hideBubble();
      return;
    }
    const text = selection?.toString().trim() || "";
    if (!text || text.length > 50_000 || selection.rangeCount === 0) {
      hideBubble();
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = lastUsefulRect(range);
    if (!rect || (!rect.width && !rect.height)) {
      hideBubble();
      return;
    }

    captured = {
      id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join(""),
      quote: text,
      pageTitle: document.title.trim() || location.hostname || "Local document",
      pageUrl: location.href,
      createdAt: new Date().toISOString()
    };
    positionBubble(rect);
  }

  function isEditingOrInternal(node) {
    let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (element) {
      if (element === host || element.isContentEditable ||
          element.closest('input, textarea, select, [role="textbox"], [role="searchbox"]')) return true;
      element = element.getRootNode()?.host;
    }
    return false;
  }

  function lastUsefulRect(range) {
    const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
    return rects.at(-1) || range.getBoundingClientRect();
  }

  function positionBubble(rect) {
    ui.bubble.classList.remove("hidden");
    const bubbleRect = ui.bubble.getBoundingClientRect();
    const width = bubbleRect.width || 78;
    const height = bubbleRect.height || 34;
    const left = Math.min(Math.max(8, rect.right + 8), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    const top = below + height < window.innerHeight ? below : Math.max(8, rect.top - height - 8);
    ui.bubble.style.left = `${left}px`;
    ui.bubble.style.top = `${top}px`;
  }

  function hideBubble() {
    ui.bubble.classList.add("hidden");
  }

  async function openDialog() {
    if (!captured) return;
    hideBubble();
    ui.quote.textContent = captured.quote;
    ui.annotation.value = "";
    ui.tags.value = "";
    ui.kind.value = "Thought";
    ui.moreOptions.open = false;
    dialogVersion++;
    destinationStatus = null;
    destinationChosen = false;
    ui.saveDestination.disabled = true;
    ui.save.disabled = true;
    ui.destinationText.textContent = "Loading save settings…";
    setError("");
    ui.overlay.classList.remove("hidden");
    ui.annotation.focus();
    await refreshDestination();
  }

  function closeDialog() {
    if (saving) return;
    ui.overlay.classList.add("hidden");
    dialogVersion++;
  }

  async function refreshDestination() {
    const version = dialogVersion;
    try {
      const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (version !== dialogVersion) return;
      if (!status?.ok) throw new Error(status?.error || "Save settings could not be loaded. Reopen this dialog to retry.");
      destinationStatus = status;
      if (!destinationChosen) {
        ui.saveDestination.value = ["google", "markdown", "txt", "inbox"].includes(status.saveDestination) ? status.saveDestination : "inbox";
      }
      renderDestination();
    } catch (error) {
      if (version !== dialogVersion) return;
      ui.destinationText.textContent = "Save settings could not be loaded";
      setError(error.message || "Reload this page and try again.");
    }
  }

  function renderDestination() {
    if (!destinationStatus) return;
    const choice = ui.saveDestination.value;
    const google = destinationStatus.google;
    let ready = true;
    ui.configure.textContent = "Settings";
    if (choice === "google") {
      ready = Boolean(google?.configured && google.connected && google.document);
      ui.destinationText.textContent = ready
        ? `Append to ${google.document.title}. A local backup is kept.`
        : "Connect Google and choose or create a document in Settings. Your draft stays here.";
      ui.configure.textContent = ready ? "Change document" : "Set up Google Docs";
    } else if (choice === "inbox") {
      ui.destinationText.textContent = "Collect this annotation locally. Export your inbox when you are ready.";
    } else {
      const file = destinationStatus.files?.[choice];
      ui.destinationText.textContent = file?.connected
        ? file.permission === "granted" ? `Append to ${file.name}. A local backup is kept.` : `Reconnect ${file.name} in Settings. Your draft stays here.`
        : "Choose a filename and location when you save. A local backup is kept.";
      ui.configure.textContent = file?.connected ? "Change file" : "Set default file";
      ready = !file?.connected || file.permission === "granted";
    }
    ui.save.disabled = saving || !ready;
    ui.saveDestination.disabled = saving;
  }

  async function submit() {
    if (!captured || ui.save.disabled) return;
    const destination = ui.saveDestination.value;
    setBusy(true);
    setError("");
    try {
      const result = await chrome.runtime.sendMessage({
        type: "SAVE_CLIP",
        destination,
        clip: {
          ...captured,
          annotation: ui.annotation.value,
          kind: ui.kind.value,
          tags: ui.tags.value
        }
      });
      if (!result?.ok) throw new Error(result?.error || "Save failed");
      if (result.googleWriteFailed || result.fileWriteFailed || result.needsPermission) {
        setError(result.message || "Your annotation is safe in the local inbox. Please retry or choose another destination.");
        return;
      }
      setBusy(false);
      closeDialog();
      if (result.savedTo === "google") {
        showToast(result.message || `Saved to Google Docs: ${result.documentTitle}`);
      } else if (result.savedTo === "default") {
        showToast(`Saved to ${result.fileName}`);
      } else if (result.savedTo === "download") {
        showToast(`${result.format === "txt" ? "TXT" : "Markdown"} download started. A backup is saved in your local inbox.`);
      } else {
        showToast(result.message || "Saved to the local inbox");
      }
    } catch (error) {
      setError(error.message || "Save failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy) {
    saving = busy;
    ui.cancel.disabled = busy;
    ui.configure.disabled = busy;
    ui.save.textContent = busy ? "Saving…" : "Save";
    renderDestination();
  }

  function setError(message) {
    ui.error.textContent = message;
    ui.error.classList.toggle("hidden", !message);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 3200);
  }
})();
