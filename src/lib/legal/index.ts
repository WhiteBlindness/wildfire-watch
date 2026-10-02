import type { Locale } from "@/lib/i18n/types";
import en from "./en";
import pt from "./pt";
import type { LegalContent } from "./types";

const legalContent: Record<Locale, LegalContent> = { en, pt };

export function getLegalContent(locale: Locale): LegalContent {
  return legalContent[locale];
}

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; external: boolean };

const INLINE_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits `[label](href)` markup into renderable segments. Only same-site paths
 * and https URLs become links, so copy can never smuggle in another scheme. */
export function parseInlineLinks(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_LINK)) {
    const [whole, label, href] = match;
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });

    const internal = href.startsWith("/") && !href.startsWith("//");
    const external = href.startsWith("https://");
    segments.push(internal || external
      ? { kind: "link", text: label, href, external }
      : { kind: "text", text: label });
    cursor = start + whole.length;
  }

  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

export type { LegalBlock, LegalContent, LegalDocument, LegalSection } from "./types";
