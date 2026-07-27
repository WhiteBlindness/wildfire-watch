"use client";

import type { WildfireEvent } from "@/lib/wildfire/types";
import { SEVERITY_LABEL_PT, STATUS_LABEL_PT } from "@/lib/wildfire/colors";
import FireEvolutionChart from "./FireEvolutionChart";
import AdSlot from "@/components/ui/AdSlot";

interface FireDetailsPanelProps {
  event: WildfireEvent | null;
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_BADGE_CLASS: Record<WildfireEvent["status"], string> = {
  active: "bg-red-500/15 text-red-400 ring-1 ring-red-500/40",
  contained: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40",
  extinguished: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40",
};

export default function FireDetailsPanel({ event, onClose }: FireDetailsPanelProps) {
  const open = event !== null;

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-20 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border/60 bg-surface/75 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-full md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-2xl md:border-t-0 md:border-l ${
        open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-x-full"
      }`}
      aria-hidden={!open}
    >
      {event && (
        <div className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{event.name}</h2>
              <p className="text-sm text-foreground/60">
                {event.region}, {event.country}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar painel"
              className="rounded-full border border-border p-1.5 text-foreground/60 hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className={`rounded-full px-2.5 py-1 ${STATUS_BADGE_CLASS[event.status]}`}>
              {STATUS_LABEL_PT[event.status]}
            </span>
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-foreground/70 ring-1 ring-border">
              Severidade: {SEVERITY_LABEL_PT[event.severity]}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Área ardida" value={`${event.areaHectares.toLocaleString("pt-PT")} ha`} />
            <Stat label="Início" value={formatDateTime(event.startedAt)} />
            <Stat
              label={event.status === "active" ? "Contenção prevista" : "Contido em"}
              value={
                event.status === "active"
                  ? event.estimatedContainmentAt
                    ? formatDateTime(event.estimatedContainmentAt)
                    : "—"
                  : event.containedAt
                    ? formatDateTime(event.containedAt)
                    : "—"
              }
            />
            <Stat label="Vento" value={`${event.wind.speedKmh} km/h, ${event.wind.directionDeg}°`} />
          </dl>

          <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Meios no terreno
            </h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Bombeiros" value={event.forces.firefighters.toLocaleString("pt-PT")} />
              <Stat label="Veículos" value={event.forces.vehicles.toLocaleString("pt-PT")} />
              <Stat label="Aviões" value={String(event.forces.aircraft.planes)} />
              <Stat label="Helicópteros" value={String(event.forces.aircraft.helicopters)} />
            </dl>
          </div>

          {event.internationalAid.requested && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-400">
                {event.internationalAid.active ? "Ajuda internacional ativa" : "Ajuda internacional solicitada"}
              </p>
              {event.internationalAid.countries.length > 0 && (
                <p className="mt-1 text-foreground/70">{event.internationalAid.countries.join(", ")}</p>
              )}
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Evolução da área ardida
            </h3>
            <FireEvolutionChart data={event.evolution} />
          </div>

          <div className="mt-auto pt-2">
            <AdSlot variant="panel-rectangle" />
          </div>
        </div>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
