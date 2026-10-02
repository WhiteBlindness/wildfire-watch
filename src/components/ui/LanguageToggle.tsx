"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { Locale } from "@/lib/i18n/types";

const OPTIONS: Locale[] = ["pt", "en"];
const OPTION_LANG: Record<Locale, string> = { pt: "pt-PT", en: "en" };

export default function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      role="group"
      aria-label={t.topBar.languageToggleLabel}
      className="relative flex h-11 w-24 rounded-full border border-border bg-surface-muted p-1"
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1 top-1/2 h-9 w-11 -translate-y-1/2 rounded-full bg-foreground/90 transition-transform ${
          locale === "en" ? "translate-x-11" : "translate-x-0"
        }`}
      />
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          lang={OPTION_LANG[option]}
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={`relative z-10 flex flex-1 items-center justify-center rounded-full p-0 text-xs font-semibold uppercase leading-none tracking-wide transition-colors ${
            locale === option ? "text-background" : "text-foreground/70"
          }`}
        >
          {option}
          {/* The visible code stays in the accessible name (WCAG 2.5.3); the
              full language name is spoken in its own language. */}
          <span className="sr-only"> {t.topBar.languageNames[option]}</span>
        </button>
      ))}
    </div>
  );
}
