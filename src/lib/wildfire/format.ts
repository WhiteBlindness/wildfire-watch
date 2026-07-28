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
