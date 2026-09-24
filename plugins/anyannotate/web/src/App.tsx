import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useRef, useState } from "react";

interface Clip {
  id: string;
  quote: string;
  annotation: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface DraftState {
  draftId: "default";
  title: string;
  clips: Clip[];
  stateVersion: number;
  updatedAt: string;
}

interface ExportResult {
  filename: string;
  mimeType: string;
  content: string;
}

type Status = "connecting" | "ready" | "saving" | "saved" | "error";
const IS_STANDALONE_PREVIEW = window.parent === window;

function splitTags(value: string): string[] {
  return value.split(/[，,\s]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean);
}

function downloadFile(result: ExportResult): void {
  const url = URL.createObjectURL(new Blob([result.content], { type: result.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getDraft(result: unknown): DraftState | null {
  const structured = (result as { structuredContent?: { draft?: DraftState } })?.structuredContent;
  return structured?.draft ?? null;
}

function ClipCard({
  clip,
  index,
  count,
  onSave,
  onMove,
  onDelete,
}: {
  clip: Clip;
  index: number;
  count: number;
  onSave: (id: string, changes: Partial<Clip>) => Promise<void>;
  onMove: (id: string, toIndex: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [quote, setQuote] = useState(clip.quote);
  const [annotation, setAnnotation] = useState(clip.annotation);
  const [tags, setTags] = useState(clip.tags.join(" "));
  const [source, setSource] = useState(clip.source);

  useEffect(() => {
    setQuote(clip.quote);
    setAnnotation(clip.annotation);
    setTags(clip.tags.join(" "));
    setSource(clip.source);
  }, [clip]);

  const save = () => onSave(clip.id, { quote, annotation, tags: splitTags(tags), source });

  return (
    <article className="clip-card">
      <div className="clip-number">{String(index + 1).padStart(2, "0")}</div>
      <div className="clip-body">
        <label className="field-label" htmlFor={`quote-${clip.id}`}>Excerpt</label>
        <textarea
          id={`quote-${clip.id}`}
          className="quote-input"
          value={quote}
          onChange={(event) => setQuote(event.target.value)}
          onBlur={() => { void save(); }}
          maxLength={50_000}
          rows={3}
        />
        <label className="field-label annotation-label" htmlFor={`note-${clip.id}`}>My Annotation</label>
        <textarea
          id={`note-${clip.id}`}
          value={annotation}
          onChange={(event) => setAnnotation(event.target.value)}
          onBlur={() => { void save(); }}
          maxLength={20_000}
          placeholder="Add a question, interpretation, or next step…"
          rows={2}
        />
        <div className="metadata-row">
          <input
            aria-label="Tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            onBlur={() => { void save(); }}
            maxLength={3_000}
            placeholder="Tags separated by spaces"
          />
          <input
            aria-label="Source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            onBlur={() => { void save(); }}
            maxLength={1_000}
            placeholder="Source (optional)"
          />
        </div>
      </div>
      <div className="clip-actions" aria-label="Excerpt actions">
        <button className="icon-button" disabled={index === 0} onClick={() => onMove(clip.id, index - 1)} aria-label="Move up">↑</button>
        <button className="icon-button" disabled={index === count - 1} onClick={() => onMove(clip.id, index + 1)} aria-label="Move down">↓</button>
        <button className="icon-button danger" onClick={() => onDelete(clip.id)} aria-label="Delete">×</button>
      </div>
    </article>
  );
}

export default function App() {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [quote, setQuote] = useState("");
  const [annotation, setAnnotation] = useState("");
  const [tags, setTags] = useState("");
  const [source, setSource] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const hostApp = useRef<McpApp | null>(null);

  const acceptDraft = useCallback((next: DraftState | null) => {
    if (!next) return;
    setDraft(next);
    setStatus("saved");
    window.setTimeout(() => setStatus("ready"), 700);
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "AnyAnnotate", version: "0.2.0" },
    capabilities: {},
    onAppCreated: (createdApp: McpApp) => {
      createdApp.ontoolresult = (result) => acceptDraft(getDraft(result));
      if (!IS_STANDALONE_PREVIEW) hostApp.current = createdApp;
    },
  });

  useEffect(() => {
    if (app && !IS_STANDALONE_PREVIEW) hostApp.current = app;
  }, [app]);

  const restCall = useCallback(async (name: string, args: Record<string, unknown>) => {
    const routes: Record<string, { method: string; path: string; body?: unknown }> = {
      draft_get: { method: "GET", path: "/api/draft" },
      draft_set_title: { method: "PATCH", path: "/api/draft", body: args },
      draft_append: { method: "POST", path: "/api/clips", body: args },
      draft_update: { method: "PATCH", path: `/api/clips/${encodeURIComponent(String(args.id))}`, body: args },
      draft_delete: { method: "DELETE", path: `/api/clips/${encodeURIComponent(String(args.id))}` },
      draft_move: { method: "POST", path: `/api/clips/${encodeURIComponent(String(args.id))}/move`, body: args },
      draft_clear: { method: "DELETE", path: "/api/draft" },
    };
    const route = routes[name];
    const response = await fetch(route.path, {
      method: route.method,
      headers: route.body ? { "Content-Type": "application/json" } : undefined,
      body: route.body ? JSON.stringify(route.body) : undefined,
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "Request failed");
    return (await response.json()) as { draft: DraftState };
  }, []);

  const call = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
    setStatus("saving");
    setErrorMessage("");
    try {
      if (!IS_STANDALONE_PREVIEW && hostApp.current) {
        const result = await hostApp.current.callServerTool({ name, arguments: args });
        if (result.isError) throw new Error("Save failed. Try again.");
        acceptDraft(getDraft(result));
        return result;
      }
      const result = await restCall(name, args);
      acceptDraft(result.draft);
      return result;
    } catch (callError) {
      setStatus("error");
      setErrorMessage(callError instanceof Error ? callError.message : "The operation failed");
      return null;
    }
  }, [acceptDraft, restCall]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!draft && (IS_STANDALONE_PREVIEW || !hostApp.current)) {
        void call("draft_get").catch(() => undefined);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [call, draft]);

  const addClip = async () => {
    if (!quote.trim()) return;
    const result = await call("draft_append", {
      id: crypto.randomUUID(),
      quote,
      annotation,
      tags: splitTags(tags),
      source,
    });
    if (!result) return;
    setQuote("");
    setAnnotation("");
    setTags("");
    setSource("");
  };

  const exportFile = async (format: "md" | "txt") => {
    try {
      if (IS_STANDALONE_PREVIEW || !hostApp.current) {
        window.location.href = `/api/export/${format}`;
        return;
      }
      setStatus("saving");
      const result = await hostApp.current.callServerTool({ name: "draft_export", arguments: { format } });
      const exported = (result.structuredContent as unknown as { export?: ExportResult })?.export;
      if (!exported) throw new Error("No export file was returned.");
      downloadFile(exported);
      setStatus("saved");
    } catch (exportError) {
      setStatus("error");
      setErrorMessage(exportError instanceof Error ? exportError.message : "Export failed");
    }
  };

  if (!draft) {
    return (
      <main className="workspace loading-state">
        <div className="brand-mark">A</div>
        <p>{error ? "Switching to the local preview…" : "Opening the clipping workspace…"}</p>
        {status === "error" && <p className="error-message">{errorMessage}</p>}
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <div className="eyebrow">ANYANNOTATE</div>
          <input
            className="title-input"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onBlur={() => void call("draft_set_title", { title: draft.title })}
            aria-label="Export title"
            maxLength={200}
          />
        </div>
        <div className="header-meta">
          <span>{draft.clips.length} {draft.clips.length === 1 ? "excerpt" : "excerpts"}</span>
          <span className={`save-status ${status}`}>{status === "saving" ? "Saving" : status === "error" ? "Error" : "Autosaved"}</span>
        </div>
      </header>

      <section className="composer">
        <textarea value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Paste or type an answer excerpt to keep…" maxLength={50_000} rows={3} />
        <textarea value={annotation} onChange={(event) => setAnnotation(event.target.value)} placeholder="Add an annotation (optional)" maxLength={20_000} rows={2} />
        <div className="composer-footer">
          <div className="compact-fields">
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags" aria-label="New excerpt tags" maxLength={3_000} />
            <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Source" aria-label="New excerpt source" maxLength={1_000} />
          </div>
          <button className="primary-button" disabled={!quote.trim() || status === "saving"} onClick={() => void addClip()}>Add to Draft</button>
        </div>
      </section>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <section className="clip-list" aria-label="Saved excerpts">
        {draft.clips.length === 0 ? (
          <div className="empty-state">
            <div className="empty-glyph">“</div>
            <p>No excerpts yet</p>
            <span>Add the first useful answer excerpt above.</span>
          </div>
        ) : draft.clips.map((clip, index) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            index={index}
            count={draft.clips.length}
            onSave={(id, changes) => call("draft_update", { id, ...changes }).then(() => undefined)}
            onMove={(id, toIndex) => call("draft_move", { id, toIndex }).then(() => undefined)}
            onDelete={(id) => call("draft_delete", { id }).then(() => undefined)}
          />
        ))}
      </section>

      <footer className="workspace-footer">
        <div className="export-actions">
          <span>Export</span>
          <button onClick={() => void exportFile("md")}>Markdown</button>
          <button onClick={() => void exportFile("txt")}>TXT</button>
        </div>
        {draft.clips.length > 0 && (
          clearArmed ? (
            <div className="clear-confirm">
              <button onClick={() => setClearArmed(false)}>Cancel</button>
              <button className="danger-text" onClick={() => { void call("draft_clear"); setClearArmed(false); }}>Confirm Clear</button>
            </div>
          ) : <button className="quiet-button" onClick={() => setClearArmed(true)}>Clear Draft</button>
        )}
      </footer>
    </main>
  );
}
