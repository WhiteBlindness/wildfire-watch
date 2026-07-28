"use client";

import { SEVERITY_COLOR } from "@/lib/wildfire/colors";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { FireSeverity } from "@/lib/wildfire/types";

const ORDER: FireSeverity[] = ["low", "moderate", "high", "extreme"];

export default function Legend() {
  const { t } = useLocale();

  return (
    <div className="pointer-events-auto rounded-xl border border-border bg-surface/90 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
        {t.legend.title}
      </p>
      <ul className="flex flex-col gap-1">
        {ORDER.map((severity) => (
          <li key={severity} className="flex items-center gap-2 text-xs text-foreground/80">
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-white/30"
              style={{ backgroundColor: SEVERITY_COLOR[severity] }}
            />
            {t.legend[severity]}
          </li>
        ))}
      </ul>
    </div>
  );
}
