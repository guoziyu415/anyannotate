export interface Clip {
  id: string;
  quote: string;
  annotation: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftState {
  draftId: "default";
  title: string;
  clips: Clip[];
  stateVersion: number;
  updatedAt: string;
}

export interface ClipInput {
  id?: string;
  quote: string;
  annotation?: string;
  tags?: string[];
  source?: string;
}

export interface ClipChanges {
  quote?: string;
  annotation?: string;
  tags?: string[];
  source?: string;
}

export type ExportFormat = "md" | "txt";

export interface ExportResult {
  filename: string;
  mimeType: string;
  content: string;
}
