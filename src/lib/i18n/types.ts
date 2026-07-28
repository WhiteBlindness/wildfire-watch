import type en from "./en";

export type Locale = "en" | "pt";

/** English is the canonical shape; pt.ts is typed against it so a missing or
 * mistyped key in either dictionary fails at compile time, not at runtime. */
export type Dictionary = typeof en;
