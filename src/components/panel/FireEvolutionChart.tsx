"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FireEvolutionPoint } from "@/lib/wildfire/types";
import { formatThousands } from "@/lib/wildfire/format";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface FireEvolutionChartProps {
  data: FireEvolutionPoint[];
}

const TIME_LOCALE: Record<"en" | "pt", string> = { en: "en-GB", pt: "pt-PT" };

export default function FireEvolutionChart({ data }: FireEvolutionChartProps) {
  const { locale, t } = useLocale();

  function formatHour(iso: string): string {
    return new Date(iso).toLocaleTimeString(TIME_LOCALE[locale], { hour: "2-digit", minute: "2-digit" });
  }

  const chartData = data.map((point) => ({ ...point, label: formatHour(point.timestamp) }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(label) => `${t.chart.timeLabel}: ${label}`}
            formatter={(value, name) => {
              const num = Number(value);
              return [
                name === "areaHectares" ? `${formatThousands(num)} ha` : `${formatThousands(num)} ${t.chart.personnelLabel.toLowerCase()}`,
                name === "areaHectares" ? t.fireDetail.areaLabel : t.chart.personnelLabel,
              ];
            }}
          />
          <Area type="monotone" dataKey="areaHectares" stroke="#ef4444" fill="url(#areaFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
