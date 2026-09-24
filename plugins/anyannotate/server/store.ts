import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Clip, ClipChanges, ClipInput, DraftState } from "./types.js";

const DEFAULT_TITLE = "AnyAnnotate";

function now(): string {
  return new Date().toISOString();
}

function emptyDraft(): DraftState {
  return {
    draftId: "default",
    title: DEFAULT_TITLE,
    clips: [],
    stateVersion: 0,
    updatedAt: now(),
  };
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
}

export class DraftStore {
  constructor(private readonly filePath: string) {}

  read(): DraftState {
    if (!fs.existsSync(this.filePath)) return emptyDraft();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as DraftState;
      return {
        ...emptyDraft(),
        ...parsed,
        draftId: "default",
        clips: Array.isArray(parsed.clips) ? parsed.clips : [],
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown parse error";
      throw new Error(`The draft file could not be read. It was left unchanged. ${reason}`);
    }
  }

  setTitle(title: string): DraftState {
    return this.mutate((draft) => {
      draft.title = title.trim() || DEFAULT_TITLE;
    });
  }

  append(input: ClipInput): DraftState {
    if (!input.quote.trim()) throw new Error("The excerpt cannot be empty.");
    return this.mutate((draft) => {
      if (input.id && draft.clips.some((clip) => clip.id === input.id)) return;
      const timestamp = now();
      draft.clips.push({
        id: input.id ?? randomUUID(),
        quote: input.quote.trim(),
        annotation: input.annotation?.trim() ?? "",
        tags: normalizeTags(input.tags),
        source: input.source?.trim() ?? "",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  }

  update(id: string, changes: ClipChanges): DraftState {
    return this.mutate((draft) => {
      const clip = this.requireClip(draft, id);
      if (changes.quote !== undefined) {
        if (!changes.quote.trim()) throw new Error("The excerpt cannot be empty.");
        clip.quote = changes.quote.trim();
      }
      if (changes.annotation !== undefined) clip.annotation = changes.annotation.trim();
      if (changes.tags !== undefined) clip.tags = normalizeTags(changes.tags);
      if (changes.source !== undefined) clip.source = changes.source.trim();
      clip.updatedAt = now();
    });
  }

  remove(id: string): DraftState {
    return this.mutate((draft) => {
      const index = draft.clips.findIndex((clip) => clip.id === id);
      if (index === -1) throw new Error("The excerpt could not be found.");
      draft.clips.splice(index, 1);
    });
  }

  move(id: string, toIndex: number): DraftState {
    return this.mutate((draft) => {
      const fromIndex = draft.clips.findIndex((clip) => clip.id === id);
      if (fromIndex === -1) throw new Error("The excerpt could not be found.");
      const boundedIndex = Math.max(0, Math.min(toIndex, draft.clips.length - 1));
      const [clip] = draft.clips.splice(fromIndex, 1);
      draft.clips.splice(boundedIndex, 0, clip);
    });
  }

  clear(): DraftState {
    return this.mutate((draft) => {
      draft.clips = [];
    });
  }

  private requireClip(draft: DraftState, id: string): Clip {
    const clip = draft.clips.find((candidate) => candidate.id === id);
    if (!clip) throw new Error("The excerpt could not be found.");
    return clip;
  }

  private mutate(change: (draft: DraftState) => void): DraftState {
    const draft = this.read();
    const previous = JSON.stringify(draft.clips);
    const previousTitle = draft.title;
    change(draft);
    if (previous === JSON.stringify(draft.clips) && previousTitle === draft.title) return draft;
    draft.stateVersion += 1;
    draft.updatedAt = now();
    this.write(draft);
    return draft;
  }

  private write(draft: DraftState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }
}
