"use client";

// Placeholder ad units sized to standard AdSense slots. Swap the placeholder
// <div> for the real <ins class="adsbygoogle"> + <Script> tags once an
// AdSense account/slot IDs exist — the surrounding layout already reserves
// the right footprint so nothing reflows when ads go live.

import { useLocale } from "@/lib/i18n/LocaleProvider";

type AdSlotVariant = "sidebar-banner" | "panel-rectangle" | "mobile-leaderboard";

const DIMENSIONS: Record<AdSlotVariant, { width: number; height: number; label: string }> = {
  "sidebar-banner": { width: 300, height: 100, label: "300×100" },
  "panel-rectangle": { width: 300, height: 250, label: "300×250" },
  "mobile-leaderboard": { width: 320, height: 50, label: "320×50" },
};

interface AdSlotProps {
  variant: AdSlotVariant;
  className?: string;
}

export default function AdSlot({ variant, className }: AdSlotProps) {
  const { t } = useLocale();
  const { width, height, label } = DIMENSIONS[variant];
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted/60 text-[10px] uppercase tracking-wide text-foreground/50 ${className ?? ""}`}
      style={{ width: "100%", maxWidth: width, height, margin: "0 auto" }}
      data-ad-slot={variant}
      aria-label={t.ad.ariaLabel}
    >
      {t.ad.label} · {label}
    </div>
  );
}
