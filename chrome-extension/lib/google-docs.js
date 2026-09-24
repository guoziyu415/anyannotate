(function exposeGoogleDocs(root) {
  "use strict";

  const SCOPE = "https://www.googleapis.com/auth/documents";
  const API = "https://docs.googleapis.com/v1/documents";
  const MAX_BATCH_TEXT = 250_000;

  function parseDocumentLink(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch { throw new Error("Paste a Google Docs document link."); }
    const match = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match || url.username || url.password) {
      throw new Error("Use a link beginning with https://docs.google.com/document/d/.");
    }
    const tabId = url.searchParams.get("tab") || "";
    if (tabId && !/^[a-zA-Z0-9_.-]+$/.test(tabId)) throw new Error("The document tab link is invalid.");
    return { documentId: match[1], tabId };
  }

  function documentURL(documentId, tabId) {
    const url = new URL(`https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`);
    if (tabId) url.searchParams.set("tab", tabId);
    return url.href;
  }

  function getTabs(document) {
    const tabs = [];
    function visit(items) {
      for (const tab of items || []) {
        if (tab.documentTab) tabs.push(tab);
        visit(tab.childTabs);
      }
    }
    visit(document.tabs);
    return tabs;
  }

  function resolveTarget(document, requestedTab = "") {
    const tabs = getTabs(document);
    const tab = requestedTab ? tabs.find((item) => item.tabProperties.tabId === requestedTab) : tabs[0];
    if (!tab) throw new Error("The selected document tab is unavailable. Copy its current Google Docs link.");
    return {
      documentId: document.documentId,
      title: document.title || "Untitled document",
      tabId: tab.tabProperties.tabId,
      tabTitle: tab.tabProperties.title || "First tab",
      url: documentURL(document.documentId, tab.tabProperties.tabId),
    };
  }

  function formatClip(clip) {
    const formatting = root.AnyAnnotateMarkdown || (typeof require === "function" ? require("./markdown.js") : null);
    const note = formatting.getNoteContent(clip);
    // Clean before calculating UTF-16 offsets: Docs strips these characters.
    const clean = (value) => value.replace(/[\u0000-\u0008\u000C-\u001F\uE000-\uF8FF]/g, "").trim();
    let text = "";
    function add(value) {
      value = clean(value);
      if (!value) return null;
      const range = { start: text.length, end: text.length + value.length };
      text += `${value}\n`;
      return range;
    }
    const quote = add(note.quote);
    if (!quote) throw new Error("There is no readable selected text to save.");
    const annotation = add(note.annotation);
    const source = add(note.source.label);
    if (source) source.url = /^https?:\/\//.test(note.source.url) ? note.source.url : "";
    text += "\n";
    return { text, quote, annotation, source };
  }

  const MARKER_PREFIX = "anyannotate_";
  // Named ranges added before 0.6.4 used the product's previous internal name.
  // They are still recognized so retries never duplicate an earlier export.
  const LEGACY_MARKER_PREFIX = "answer_clipper_";

  async function clipHash(clipId) {
    const hash = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(clipId));
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function markerFor(clipId) {
    return `${MARKER_PREFIX}${await clipHash(clipId)}`;
  }

  async function knownMarkersFor(clipId) {
    const hash = await clipHash(clipId);
    return [`${MARKER_PREFIX}${hash}`, `${LEGACY_MARKER_PREFIX}${hash}`];
  }

  function buildAppendBatch(document, target, entries, { basicFormatting = false } = {}) {
    const tab = getTabs(document).find((item) => item.tabProperties.tabId === target.tabId);
    if (!tab) throw new Error("The selected tab was removed. Choose a document again.");
    if (!document.revisionId) throw new Error("Google did not return a document revision. Reconnect and try again.");
    const namedRanges = tab.documentTab.namedRanges || {};
    const known = new Set(Object.keys(namedRanges));
    for (const item of Object.values(namedRanges)) if (item.name) known.add(item.name);
    const pending = entries.filter((entry) => !(entry.knownMarkers || [entry.marker]).some((marker) => known.has(marker)));
    if (!pending.length) return { pending, requests: [] };
    let index = Math.max(1, ...tab.documentTab.body.content.map((element) => (element.endIndex || 1) - 1));
    const requests = [];
    let separator = index > 1 ? "\n" : "";
    for (const entry of pending) {
      const text = separator + entry.text;
      const contentIndex = index + separator.length;
      const range = { startIndex: index, endIndex: index + text.length, tabId: target.tabId };
      const contentRange = { ...range, startIndex: contentIndex };
      const absoluteRange = (part) => ({ startIndex: contentIndex + part.start, endIndex: contentIndex + part.end, tabId: target.tabId });
      const pt = (magnitude) => ({ magnitude, unit: "PT" });
      const color = (red, green = red, blue = red) => ({ color: { rgbColor: { red, green, blue } } });
      requests.push({ insertText: { text, location: { index, tabId: target.tabId } } });
      requests.push({ createNamedRange: { name: entry.marker, range } });
      if (basicFormatting) {
        index += text.length;
        separator = "";
        continue;
      }
      requests.push({ deleteParagraphBullets: { range: contentRange } });
      // Paragraph borders are whole objects, not partial field-mask resets.
      // Supply every property even when hiding an inherited border.
      const noBorder = () => ({ color: color(0), width: pt(0), padding: pt(0), dashStyle: "SOLID" });
      // Reset inherited formatting only on the newly inserted paragraphs.
      requests.push({ updateParagraphStyle: {
        range: contentRange,
        paragraphStyle: {
          namedStyleType: "NORMAL_TEXT", alignment: "START", lineSpacing: 115,
          spaceAbove: pt(0), spaceBelow: pt(8), indentStart: pt(0), indentEnd: pt(0), indentFirstLine: pt(0),
          keepWithNext: false, keepLinesTogether: false, pageBreakBefore: false,
          borderLeft: noBorder(), borderRight: noBorder(), borderTop: noBorder(),
          borderBottom: noBorder(), borderBetween: noBorder(),
        },
        fields: "namedStyleType,alignment,lineSpacing,spaceAbove,spaceBelow,indentStart,indentEnd,indentFirstLine,keepWithNext,keepLinesTogether,pageBreakBefore,borderLeft,borderRight,borderTop,borderBottom,borderBetween,shading",
      } });
      requests.push({ updateTextStyle: {
        range: contentRange,
        textStyle: { bold: false, italic: false, underline: false, strikethrough: false, fontSize: pt(11), foregroundColor: color(0.15), baselineOffset: "NORMAL" },
        fields: "bold,italic,underline,strikethrough,fontSize,foregroundColor,backgroundColor,baselineOffset,link",
      } });
      requests.push({ updateParagraphStyle: {
        range: absoluteRange(entry.quote),
        paragraphStyle: {
          indentStart: pt(12), indentFirstLine: pt(12),
          borderLeft: { color: color(0.75), width: pt(1.5), padding: pt(8), dashStyle: "SOLID" },
        }, fields: "indentStart,indentFirstLine,borderLeft",
      } });
      if (entry.source) {
        requests.push({ updateTextStyle: {
          range: absoluteRange(entry.source),
          textStyle: { fontSize: pt(9), foregroundColor: color(0.42), ...(entry.source.url ? { link: { url: entry.source.url } } : {}) },
          fields: "fontSize,foregroundColor,link",
        } });
      }
      index += text.length;
      separator = "";
    }
    return { pending, requests, writeControl: { requiredRevisionId: document.revisionId } };
  }

  function createClient({ identity, getManifest, fetch: request = (...args) => root.fetch(...args) }) {
    function configured() {
      return /^[\w-]+\.apps\.googleusercontent\.com$/.test(getManifest().oauth2?.client_id || "");
    }

    async function getToken(interactive = false) {
      if (!configured()) throw new Error("Google Docs is not configured in this build. Open Settings for setup instructions.");
      let result;
      try { result = await identity.getAuthToken({ interactive, scopes: [SCOPE], enableGranularPermissions: true }); }
      catch { throw new Error("Google connection is required. Open Settings and select Connect Google."); }
      const token = typeof result === "string" ? result : result?.token;
      if (!token || (result.grantedScopes && !result.grantedScopes.includes(SCOPE))) {
        throw new Error("Google Docs permission was not granted. Reconnect and allow document access.");
      }
      return token;
    }

    async function api(suffix = "", { method = "GET", body, refresh = true } = {}) {
      const token = await getToken();
      let response;
      try {
        response = await request(`${API}${suffix}`, {
          method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new Error("Google could not be reached. Your local notes are safe. Retry Export Inbox when online.");
      }
      if (response.status === 401 && refresh) {
        await identity.removeCachedAuthToken({ token });
        return api(suffix, { method, body, refresh: false });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiMessage = typeof data.error?.message === "string" ? data.error.message : "";
        const requestIndex = apiMessage.match(/\brequests\[(\d+)\]/)?.[1];
        const failedRequest = requestIndex === undefined ? null : body?.requests?.[Number(requestIndex)];
        const operation = failedRequest ? Object.keys(failedRequest)[0] : "";
        const apiStatus = ["INVALID_ARGUMENT", "FAILED_PRECONDITION", "INTERNAL", "UNAVAILABLE"].includes(data.error?.status) ? data.error.status : "";
        // Expose only codes and our own operation names, never the raw response,
        // which can contain document text, URLs or other private information.
        const diagnostic = [`HTTP ${response.status}`, apiStatus, operation ? `request ${requestIndex}: ${operation}` : ""].filter(Boolean).join("; ");
        let message = "Google could not complete this request. Your local notes are safe; retry from Settings.";
        if (response.status === 400) message = "Google Docs rejected the save request. Your local notes are safe.";
        if (response.status === 401) message = "Your Google connection expired. Reconnect in Settings.";
        if (response.status === 403) message = "Google denied access. Check that the Docs API is enabled and you can edit this document.";
        if (response.status === 404) message = "This Google document is missing or unavailable to the connected account.";
        if (response.status === 429) message = "Google's request limit was reached. Wait a moment, then retry Export Inbox.";
        const error = new Error(`${message} (${diagnostic})`);
        error.revisionConflict = response.status === 400 && /revision/i.test(apiMessage);
        error.formattingRejected = response.status === 400 && !error.revisionConflict &&
          ["updateParagraphStyle", "updateTextStyle", "deleteParagraphBullets"].includes(operation);
        throw error;
      }
      return data;
    }

    async function read(documentId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(documentId)) throw new Error("Invalid Google document ID.");
      return api(`/${documentId}?includeTabsContent=true`);
    }

    return {
      configured,
      async connect() { await getToken(true); },
      async disconnect() { await identity.clearAllCachedAuthTokens(); },
      async select(link) {
        const parsed = parseDocumentLink(link);
        return resolveTarget(await read(parsed.documentId), parsed.tabId);
      },
      async create(title) {
        title = String(title || "").trim().slice(0, 200);
        if (!title) throw new Error("Enter a document title.");
        const created = await api("", { method: "POST", body: { title } });
        return resolveTarget(await read(created.documentId));
      },
      async append(target, clips) {
        if (!target?.documentId || !target.tabId) throw new Error("Choose a Google document in Settings first.");
        const entries = [];
        const ids = new Set();
        for (const clip of clips) {
          if (ids.has(clip.id)) continue;
          ids.add(clip.id);
          const knownMarkers = await knownMarkersFor(clip.id);
          entries.push({ ...formatClip(clip), marker: knownMarkers[0], knownMarkers });
        }
        let exported = 0;
        let skipped = 0;
        let basicFormattingCount = 0;
        while (entries.length) {
          const chunk = [];
          let size = 0;
          while (entries.length && chunk.length < 25 && size + entries[0].text.length <= MAX_BATCH_TEXT) {
            const entry = entries.shift();
            size += entry.text.length;
            chunk.push(entry);
          }
          if (!chunk.length) throw new Error("An annotation is too large for Google Docs. Export it as Markdown instead.");
          let basicFormatting = false;
          let revisionRetries = 0;
          for (;;) {
            const document = await read(target.documentId);
            const batch = buildAppendBatch(document, target, chunk, { basicFormatting });
            try {
              if (batch.requests.length) {
                await api(`/${target.documentId}:batchUpdate`, {
                  method: "POST", body: { requests: batch.requests, writeControl: batch.writeControl },
                });
              }
              exported += batch.pending.length;
              skipped += chunk.length - batch.pending.length;
              if (basicFormatting) basicFormattingCount += batch.pending.length;
              break;
            } catch (error) {
              // Docs validates the whole batch atomically. Only an explicit 400
              // naming a formatting operation permits a single basic-text retry.
              // Reread first to retain revision guards and duplicate protection.
              // Never retry an uncertain write, permission failure or generic 400.
              if (error.formattingRejected && !basicFormatting) {
                basicFormatting = true;
                continue;
              }
              if (!error.revisionConflict || revisionRetries++ >= 2) throw error;
            }
          }
        }
        return { exported, skipped, ...(basicFormattingCount ? { basicFormattingCount } : {}) };
      },
    };
  }

  const api = { SCOPE, parseDocumentLink, resolveTarget, formatClip, markerFor, knownMarkersFor, buildAppendBatch, createClient };
  root.AnyAnnotateGoogleDocs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
