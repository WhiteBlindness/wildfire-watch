import ThemeToggle from "@/components/ui/ThemeToggle";
import LanguageToggle from "@/components/ui/LanguageToggle";

export default function TopBar() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between p-3 md:p-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface/90 px-4 py-2 shadow-lg backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <h1 className="text-sm font-semibold tracking-tight text-foreground">
          Wildfire<span className="text-red-500">Watch</span>
        </h1>
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
