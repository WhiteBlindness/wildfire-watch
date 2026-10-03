import type { Locale } from "./types";

// Number grouping and the decimal mark are applied by hand, not with
// `toLocaleString("pt-PT")`, because the grouping character varies between
// ICU builds (a period in some, a space in others). Dates use Intl: en-GB and
// pt-PT both order day first, so every date reads DD/MM/YYYY.

const THOUSANDS_SEPARATOR = " ";
const DECIMAL_MARK: Record<Locale, string> = { en: ".", pt: "," };

export function intlLocale(locale: Locale): string {
  return locale === "pt" ? "pt-PT" : "en-GB";
}

/** Fixed decimals, a non-breaking space between thousands and the locale's decimal mark. */
export function formatDecimal(value: number, locale: Locale, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [integer, fraction] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
  return `${sign}${grouped}${fraction ? `${DECIMAL_MARK[locale]}${fraction}` : ""}`;
}

/** Up to one decimal for small values, whole numbers from 10 upward. */
export function formatCompactDecimal(value: number, locale: Locale): string {
  return formatDecimal(value, locale, Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0);
}

/** DD/MM/YYYY, HH:MM in the visitor's time zone. */
export function formatDateTime(iso: string, locale: Locale): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

/** DD/MM/YYYY, HH:MM in UTC, for satellite acquisition times. */
export function formatUtcDateTime(iso: string, locale: Locale): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

/** DD/MM, HH:MM UTC, for compact status lines. */
export function formatShortUtcTime(iso: string, locale: Locale): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(parsed));
}

/** "<prefix> 12 minutes ago" up to two hours, then whole hours. */
export function formatRelative(iso: string, now: number, locale: Locale, prefix: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "always" });
  return elapsedMinutes < 120
    ? `${prefix} ${formatter.format(-elapsedMinutes, "minute")}`
    : `${prefix} ${formatter.format(-Math.floor(elapsedMinutes / 60), "hour")}`;
}
