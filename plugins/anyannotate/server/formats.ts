import type { DraftState, ExportFormat, ExportResult } from "./types.js";

function cleanFilename(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "AnyAnnotate";
}

function quoteMarkdown(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function renderMarkdown(draft: DraftState): string {
  const sections = draft.clips.map((clip, index) => {
    const details = [
      clip.annotation ? `**Annotation:** ${clip.annotation}` : "",
      clip.tags.length > 0 ? `**Tags:** ${clip.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}` : "",
      clip.source ? `**Source:** ${clip.source}` : "",
      `**Time:** ${clip.createdAt}`,
    ].filter(Boolean);

    return [`## ${index + 1}`, quoteMarkdown(clip.quote), ...details].join("\n\n");
  });

  return [`# ${draft.title}`, ...sections].join("\n\n").trimEnd() + "\n";
}

export function renderText(draft: DraftState): string {
  const sections = draft.clips.map((clip, index) => {
    const lines = [`${index + 1}. ${clip.quote}`];
    if (clip.annotation) lines.push(`Annotation: ${clip.annotation}`);
    if (clip.tags.length > 0) lines.push(`Tags: ${clip.tags.join(", ")}`);
    if (clip.source) lines.push(`Source: ${clip.source}`);
    lines.push(`Time: ${clip.createdAt}`);
    return lines.join("\n");
  });

  return [draft.title, ...sections].join("\n\n").trimEnd() + "\n";
}

export function exportDraft(draft: DraftState, format: ExportFormat): ExportResult {
  const base = cleanFilename(draft.title);
  if (format === "txt") {
    return {
      filename: `${base}.txt`,
      mimeType: "text/plain;charset=utf-8",
      content: renderText(draft),
    };
  }
  return {
    filename: `${base}.md`,
    mimeType: "text/markdown;charset=utf-8",
    content: renderMarkdown(draft),
  };
}
