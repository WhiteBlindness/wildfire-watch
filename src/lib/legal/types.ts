import type { LegalDocumentId } from "@/lib/site";

/**
 * Inline links use a minimal `[label](href)` syntax so the copy stays plain
 * data: internal routes start with "/", everything else must be https.
 */
export type LegalBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; caption: string; head: string[]; rows: string[][] };

export interface LegalSection {
  /** Stable anchor, identical across locales so deep links survive a language switch. */
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  summary: string;
  sections: LegalSection[];
}

export interface LegalChrome {
  backToMap: string;
  navLabel: string;
  lastUpdated: string;
  onThisPage: string;
  linkLabels: Record<LegalDocumentId, string>;
}

export interface LegalContent {
  chrome: LegalChrome;
  documents: Record<LegalDocumentId, LegalDocument>;
}
