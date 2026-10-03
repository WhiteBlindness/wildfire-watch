import type { RadiativeIntensityBand } from "./types";

// Purely visual and locale-independent. Band labels live in the i18n
// dictionaries; band thresholds live in firms-dataset.ts.
export const INTENSITY_BAND_COLOR: Record<RadiativeIntensityBand, string> = {
  low: "#f5c451",
  moderate: "#f59e0b",
  high: "#ef4444",
  very_high: "#b91c1c",
};
