"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { Locale } from "@/lib/i18n/types";

const OPTIONS: Locale[] = ["pt", "en"];

export default function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      role="group"
      aria-label={t.topBar.languageToggleLabel}
      className="relative flex h-11 w-24 rounded-full border border-border bg-surface-muted p-1"
    >
      <span
        className={`absolute top-1 left-1 h-9 w-11 rounded-full bg-foreground/90 transition-transform ${
          locale === "en" ? "translate-x-11" : "translate-x-0"
        }`}
      />
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={`relative z-10 flex-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
            locale === option ? "text-background" : "text-foreground/60"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
