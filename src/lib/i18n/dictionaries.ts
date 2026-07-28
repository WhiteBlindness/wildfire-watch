import en from "./en";
import pt from "./pt";
import type { Dictionary, Locale } from "./types";

export const DEFAULT_LOCALE: Locale = "pt";

const dictionaries: Record<Locale, Dictionary> = { en, pt };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Replaces `{name}` placeholders — the only interpolation this app needs. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

export type { Dictionary, Locale };
