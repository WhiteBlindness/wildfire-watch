import ThemeToggle from "@/components/ui/ThemeToggle";
import LanguageToggle from "@/components/ui/LanguageToggle";
import BasemapToggle, { type BasemapMode } from "@/components/ui/BasemapToggle";

export default function TopBar({ basemapMode, onBasemapChange }: { basemapMode: BasemapMode; onBasemapChange: (mode: BasemapMode) => void }) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between p-3 md:p-4">
      <div className="mission-brand-chip pointer-events-auto flex h-11 w-11 items-center justify-center gap-2 rounded-full border border-border bg-surface/90 shadow-lg backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <h1 className="mission-brand-label sr-only text-sm font-semibold tracking-tight text-foreground">
          Wildfire<span className="text-red-500">Watch</span>
        </h1>
      </div>
      <div className="mission-top-controls pointer-events-auto flex items-center gap-2">
        <BasemapToggle mode={basemapMode} onChange={onBasemapChange} />
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
