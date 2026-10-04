"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";

interface MapUnavailableNoticeProps {
  /** False when no detections have loaded: the notice then makes no claim about them. */
  hasData: boolean;
  /** Opens the panel; the link also moves focus to it. */
  onShowList: () => void;
}

/**
 * Shown in the map area when this browser or device cannot draw the map
 * (MapLibre 6 needs WebGL2). It is about the map renderer, not the wildfire
 * data: when detections are loaded, it points to them in the panel; when none
 * are, the feed error says so and this notice makes no claim about them.
 * HomeClient announces it through a live region, so it is not one itself.
 */
export default function MapUnavailableNotice({ hasData, onShowList }: MapUnavailableNoticeProps) {
  const { t } = useLocale();

  return (
    <section
      aria-labelledby="map-unavailable-title"
      data-testid="map-unavailable"
      className="pointer-events-auto w-full max-w-[28rem] rounded-2xl border border-neutral-200 bg-white/95 p-4 text-neutral-900 shadow-[0_18px_56px_rgba(0,0,0,0.24)] backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100"
    >
      <h2 id="map-unavailable-title" className="text-sm font-semibold">{t.map.unavailableTitle}</h2>
      <p className="mt-1 text-xs leading-5 text-neutral-700 dark:text-neutral-300">
        {t.map.unavailableDescription}
        {hasData && <> {t.map.unavailableDataNote}</>}
      </p>
      <p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t.map.unavailableHint}</p>
      {hasData && (
        <a
          href="#mission-control-panel-content"
          onClick={onShowList}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:focus-visible:ring-offset-neutral-900"
        >
          {t.map.unavailableShowList}
        </a>
      )}
    </section>
  );
}
