import type { FireSeverity } from "./types";

// Purely visual — locale-independent. Status/severity display labels live in
// the i18n dictionaries (src/lib/i18n), not here.
export const SEVERITY_COLOR: Record<FireSeverity, string> = {
  low: "#f5c451",
  moderate: "#f59e0b",
  high: "#ef4444",
  extreme: "#b91c1c",
};
