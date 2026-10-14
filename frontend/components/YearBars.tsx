"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBRL, type Metric } from "@/lib/static-api";

export type YearPoint = { year: number; empenhado: number; pago_total: number; n?: number };

type Props = {
  points: YearPoint[];
  metric: Metric;
  selectedYear?: number | "all";
  onSelectYear?: (year: number) => void;
  height?: number;
};

/** Eixo curto para o Y: 1,2 bi · 240 mi · 80 mil. */
function shortBRL(value: number): string {
  return formatBRL(value).replace("R$ ", "");
}

/** Barras por ano orçamentário: a métrica ativa em tinta, a outra atrás, apagada. */
export function YearBars({ points, metric, selectedYear = "all", onSelectYear, height }: Props) {
  const other: Metric = metric === "empenhado" ? "pago_total" : "empenhado";
  if (!points.some((point) => point.empenhado > 0 || point.pago_total > 0)) {
    return (
      <div className="chart-fill grid place-items-center text-[11px] tracking-[0.18em] text-ash" style={{ height }}>
        SEM EMENDAS NESTE RECORTE
      </div>
    );
  }
  return (
    <div className="chart chart-fill" style={height ? { height, flex: "none" } : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={1}>
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="year" tickMargin={8} interval={height !== undefined && height < 170 ? 1 : 0} />
          <YAxis width={54} tickFormatter={shortBRL} tickMargin={6} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "var(--line)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) {
                return null;
              }
              const point = payload[0].payload as YearPoint;
              return (
                <div className="chart-tooltip">
                  <strong>{point.year}</strong>
                  <div className="row">
                    <span>Empenhado</span>
                    <span>{formatBRL(point.empenhado)}</span>
                  </div>
                  <div className="row">
                    <span>Pago</span>
                    <span>{formatBRL(point.pago_total)}</span>
                  </div>
                  {point.n !== undefined ? (
                    <div className="row">
                      <span>Linhas</span>
                      <span>{point.n}</span>
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
          <Bar dataKey={other} isAnimationActive={false} maxBarSize={22} onClick={(data) => onSelectYear?.((data as unknown as YearPoint).year)}>
            {points.map((point) => (
              <Cell key={point.year} fill="var(--ink)" fillOpacity={0.18} className={onSelectYear ? "cursor-pointer" : undefined} />
            ))}
          </Bar>
          <Bar dataKey={metric} isAnimationActive={false} maxBarSize={22} onClick={(data) => onSelectYear?.((data as unknown as YearPoint).year)}>
            {points.map((point) => (
              <Cell
                key={point.year}
                fill="var(--ink)"
                fillOpacity={selectedYear === "all" || selectedYear === point.year ? 0.92 : 0.35}
                className={onSelectYear ? "cursor-pointer" : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
