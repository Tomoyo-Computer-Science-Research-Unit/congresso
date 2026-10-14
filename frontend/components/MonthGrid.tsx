"use client";

import type { PresencaCelula } from "@/lib/static-api";

export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Fundo de uma célula de faltas: escurece com a fração de sessões perdidas. */
export function shade(cell: PresencaCelula | null | undefined): React.CSSProperties | undefined {
  if (!cell || !cell[0] || !cell[2]) {
    return undefined;
  }
  const share = Math.min(1, cell[0] / cell[2]);
  const pct = Math.round(10 + share * 55);
  return { background: `color-mix(in srgb, var(--ink) ${pct}%, transparent)`, color: pct > 38 ? "var(--paper)" : undefined };
}

export function cellTitle(label: string, cell: PresencaCelula | null | undefined): string {
  if (!cell) {
    return `${label}: sem sessão em exercício`;
  }
  return `${label}: ${cell[0]} faltas${cell[1] ? `, ${cell[1]} ausências justificadas` : ""}, ${cell[2]} sessões`;
}

/** Anos nas linhas, meses nas colunas; o número é o total de faltas no mês. */
export function MonthGrid({ porMes, years }: { porMes: Record<string, PresencaCelula>; years?: string[] }) {
  const rows = years ?? [...new Set(Object.keys(porMes).map((key) => key.slice(0, 4)))].sort((a, b) => Number(b) - Number(a));
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-[11px] tracking-[0.18em] text-ash">SEM SESSÃO EM EXERCÍCIO</p>;
  }
  return (
    <div className="monthgrid" role="table" aria-label="Faltas por mês">
      <span className="head" />
      {MONTHS.map((month) => (
        <span key={month} className="head">
          {month}
        </span>
      ))}
      <span className="head">total</span>
      {rows.map((year) => {
        let total = 0;
        let justificadas = 0;
        const cells = MONTHS.map((month, index) => {
          const cell = porMes[`${year}-${String(index + 1).padStart(2, "0")}`];
          if (!cell) {
            return (
              <span key={index} className="empty" title={cellTitle(`${month} ${year}`, null)}>
                ·
              </span>
            );
          }
          total += cell[0];
          justificadas += cell[1];
          return (
            <span key={index} style={shade(cell)} title={cellTitle(`${month} ${year}`, cell)}>
              {cell[0] || cell[1] ? `${cell[0]}${cell[1] ? ` (${cell[1]})` : ""}` : ""}
            </span>
          );
        });
        return [
          <span key={`${year}-h`} className="head num">
            {year}
          </span>,
          ...cells,
          <span key={`${year}-t`} className="num" title={justificadas ? `${justificadas} ausências justificadas` : undefined}>
            {total}
            {justificadas ? ` (${justificadas})` : ""}
          </span>
        ];
      })}
    </div>
  );
}
