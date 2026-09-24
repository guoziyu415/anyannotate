(function exposeMarkdown(root) {
  "use strict";

  const KINDS = new Set(["Thought", "Question", "Verify", "Highlight"]);
  const LEGACY_KINDS = new Map([
    ["\u60F3\u6CD5", "Thought"],
    ["\u95EE\u9898", "Question"],
    ["\u5F85\u9A8C\u8BC1", "Verify"],
    ["\u91CD\u70B9", "Highlight"]
  ]);

  function normalizeClip(input) {
    if (!input || typeof input !== "object") {
      throw new TypeError("The annotation is invalid");
    }

    const quote = cleanText(input.quote, 50_000);
    if (!quote) {
      throw new TypeError("There is no selected text to save");
    }

    return {
      id: typeof input.id === "string" && input.id ? input.id : createId(),
      quote,
      annotation: cleanText(input.annotation, 20_000),
      kind: KINDS.has(input.kind) ? input.kind : LEGACY_KINDS.get(input.kind) || "Thought",
      tags: normalizeTags(input.tags),
      pageTitle: cleanText(input.pageTitle, 500),
      pageUrl: normalizeUrl(input.pageUrl),
      createdAt: normalizeDate(input.createdAt)
    };
  }

  function formatEntry(rawClip) {
    const note = getNoteContent(rawClip);
    const quote = note.quote
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");

    const lines = [quote, ""];
    if (note.annotation) lines.push(note.annotation, "");
    if (note.source.label) {
      const label = escapeLinkLabel(note.source.label);
      const url = note.source.url.replace(/[<>\\]/g, (value) => encodeURIComponent(value));
      lines.push(note.source.url ? `[${label}](<${url}>)` : label, "");
    }
    lines.push("---", "", "");
    return lines.join("\n");
  }

  function formatDocument(clips) {
    const entries = Array.isArray(clips) ? clips.map(formatEntry).join("") : "";
    return `# AnyAnnotate\n\n${entries}`;
  }

  function formatTextEntry(rawClip) {
    const note = getNoteContent(rawClip);
    const lines = [`“${note.quote}”`, ""];
    if (note.annotation) lines.push(note.annotation, "");
    // TXT cannot hide a hyperlink behind a label. Keep only its short title;
    // the complete source URL remains in the local inbox.
    if (note.source.label) lines.push(`— ${note.source.label}`, "");
    lines.push("--------------------", "", "");
    return lines.join("\n");
  }

  function formatTextDocument(clips) {
    return `AnyAnnotate\n\n${Array.isArray(clips) ? clips.map(formatTextEntry).join("") : ""}`;
  }

  function getNoteContent(rawClip) {
    const clip = normalizeClip(rawClip);
    let label = clip.pageTitle.replace(/\s+/g, " ").trim();
    if (!label || /^(?:https?|file):\/\//i.test(label)) {
      const url = clip.pageUrl ? new URL(clip.pageUrl) : null;
      label = url?.protocol === "file:" ? "Local document" : url?.hostname || "";
    }
    const characters = Array.from(label);
    if (characters.length > 80) label = `${characters.slice(0, 79).join("")}…`;
    return {
      quote: clip.quote.replace(/\r\n?/g, "\n"),
      annotation: clip.annotation.replace(/\r\n?/g, "\n"),
      source: { label, url: clip.pageUrl },
    };
  }

  function escapeLinkLabel(value) {
    return value.replace(/[\\\[\]*_`<>]/g, "\\$&");
  }

  function normalizeTags(tags) {
    const values = Array.isArray(tags)
      ? tags
      : typeof tags === "string"
        ? tags.split(/[,\uFF0C\s]+/)
        : [];

    return [...new Set(values
      .map((tag) => cleanText(tag, 100).replace(/^#+/, ""))
      .filter(Boolean)
      .map((tag) => `#${tag}`))]
      .slice(0, 30);
  }

  function cleanText(value, maxLength) {
    if (typeof value !== "string") return "";
    return value.replace(/\u0000/g, "").trim().slice(0, maxLength);
  }

  function normalizeUrl(value) {
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value);
      if (!["http:", "https:", "file:"].includes(url.protocol)) return "";
      url.username = "";
      url.password = "";
      return url.href;
    } catch {
      return "";
    }
  }

  function normalizeDate(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const api = { formatDocument, formatEntry, formatTextDocument, formatTextEntry, getNoteContent, normalizeClip, normalizeTags };
  root.AnyAnnotateMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
