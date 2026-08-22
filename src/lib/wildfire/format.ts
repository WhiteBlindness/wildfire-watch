// Manual thousands grouping with a non-breaking space, per PT-PT numeric
// convention — not `toLocaleString("pt-PT")`, whose grouping character
// varies by ICU/Node version (period in some builds, space in others).
const THOUSANDS_SEPARATOR = " ";

export function formatThousands(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
  return sign + grouped;
}

export type ConfidenceLevel = "low" | "nominal" | "high";

/**
 * VIIRS confidence is a categorical field — the FIRMS CSV reports it as
 * l/n/h and firms-csv.ts maps those onto 30/65/90. Rendering it as a precise
 * percentage ("65%") is manufactured precision that the raw sensor never
 * carried. This collapses the stored number back onto the three real levels so
 * the UI can show a named class instead. Thresholds bracket the three canonical
 * values (30, 65, 90) while still classing any genuinely numeric source feed.
 */
export function confidenceLevel(pct: number): ConfidenceLevel {
  if (pct < 50) return "low";
  if (pct < 80) return "nominal";
  return "high";
}
