import type { FireSeverity, FireStatus } from "./types";

export const SEVERITY_COLOR: Record<FireSeverity, string> = {
  low: "#f5c451",
  moderate: "#f59e0b",
  high: "#ef4444",
  extreme: "#b91c1c",
};

export const STATUS_LABEL_PT: Record<FireStatus, string> = {
  active: "Ativo",
  contained: "Dominado",
  extinguished: "Extinto",
};

export const SEVERITY_LABEL_PT: Record<FireSeverity, string> = {
  low: "Baixa",
  moderate: "Moderada",
  high: "Elevada",
  extreme: "Extrema",
};
