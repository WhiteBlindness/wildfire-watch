"use client";

import { RotateCw } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export type MapLoadingStateMode = "loading" | "error";

interface MapLoadingStateProps {
  mode?: MapLoadingStateMode;
  onRetry?: () => void;
  className?: string;
  announce?: boolean;
}

/** Branded fallback used both while the map chunk loads and while its data is pending. */
export default function MapLoadingState({
  mode = "loading",
  onRetry,
  className,
  announce = true,
}: MapLoadingStateProps) {
  const { t } = useLocale();
  const isError = mode === "error";

  if (isError) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="map-load-error"
        className={`pointer-events-auto absolute left-1/2 top-24 z-40 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-neutral-200 bg-white/90 p-4 text-neutral-900 shadow-[0_18px_56px_rgba(0,0,0,0.24)] backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-100 ${className ?? ""}`}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_14px_rgba(239,68,68,0.75)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t.map.errorTitle}</p>
            <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t.map.errorDescription}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-500/15 px-3 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-500/35 transition-colors hover:bg-red-500/25 dark:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              >
                <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t.map.retryLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-busy={announce ? "true" : undefined}
      aria-hidden={announce ? undefined : true}
      data-testid="map-loading-state"
      className={`pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-white dark:bg-neutral-900 ${className ?? ""}`}
    >
      <div className="flex flex-col items-center px-6 text-center">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-neutral-900 dark:text-neutral-100">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.75)]" />
          Wildfire<span className="text-red-400">Watch</span>
        </div>
        <div aria-hidden="true" className="mt-7 h-10 w-10 rounded-full border-2 border-neutral-300 border-t-red-500 motion-safe:animate-spin motion-reduce:animate-none dark:border-neutral-700 dark:border-t-red-400" />
        <p className="mt-4 text-sm font-medium text-neutral-700 dark:text-neutral-300">{t.map.loadingLabel}</p>
      </div>
    </div>
  );
}
