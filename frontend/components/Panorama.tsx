"use client";

import { useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { YearSelect, stepYear, type YearSel } from "@/components/YearSelect";
import {
  CASA_LABELS,
  METRICS,
  TIPO_LABELS,
  displayName,
  formatBRL,
  formatInt,
  getAutores,
  getByTipo,
  getByTipoYear,
  getByYear,
  getDestinos,
  getFuncoes,
  getOutrosDestinos,
  getTotals,
  getYears,
  valueFor,
  type Brief,
  type Metric
} from "@/lib/static-api";

export function Panorama() {
  const years = getYears();
  const porAno = getByYear();
  const [year, setYear] = useState<YearSel>("all");
  const [metric, setMetric] = useState<Metric>("empenhado");

  const points = useMemo(() => years.map((item) => ({ year: item, ...porAno[String(item)] })), [porAno, years]);
  const totals = year === "all" ? getTotals() : porAno[String(year)];
  const tipos: Record<string, Brief> =
    year === "all" ? getByTipo() : Object.fromEntries(Object.entries(getByTipoYear()).flatMap(([code, byYear]) => (byYear[String(year)] ? [[code, byYear[String(year)]]] : [])));

  const autores = useMemo(
    () =>
      getAutores()
        .map((autor) => ({ autor, value: valueFor(autor.por_ano, autor.totais, year, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 24),
    [metric, year]
  );
  const destinos = useMemo(
    () =>
      getDestinos()
        .map((destino) => ({ destino, value: valueFor(destino.por_ano, destino.totais, year, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [metric, year]
  );
  const funcoes = useMemo(
    () =>
      getFuncoes()
        .map((funcao) => ({ funcao, value: valueFor(funcao.por_ano, funcao.totais, year, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [metric, year]
  );
  const outros = getOutrosDestinos();
  const yearLabel = year === "all" ? `${years[0]}–${years[years.length - 1]}` : String(year);
  const metricLabel = METRICS.find((item) => item.key === metric)?.label ?? "";

  const hotkeys = useMemo(
    () => ({
      ArrowLeft: () => setYear(stepYear(years, year, -1)),
      ArrowRight: () => setYear(stepYear(years, year, 1)),
      m: () => setMetric((current) => (current === "empenhado" ? "pago_total" : "empenhado"))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year]
  );
  useScreenHotkeys(hotkeys);

  return (
    <Screen columns="minmax(0, 1fr) minmax(0, 1fr) 360px" rows="auto minmax(0, 1fr)">
      <Panel
        title={
          <span>
            <b>Bancada do RJ</b> · {yearLabel}
          </span>
        }
        aside={
          <>
            <YearSelect years={years} value={year} onChange={setYear} />
            <Segmented label="Métrica" value={metric} options={METRICS.map((item) => ({ value: item.key, label: item.label }))} onChange={setMetric} />
          </>
        }
        style={{ gridColumn: "1 / span 2" }}
      >
        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label="Empenhado" value={formatBRL(totals.empenhado)} />
            <Stat label="Pago, incl. restos a pagar" value={formatBRL(totals.pago_total)} />
            <Stat label="Linhas de emenda" value={formatInt(totals.n)} />
            <Stat label="Autores com emenda" value={formatInt(autores.length >= 24 ? getAutores().filter((autor) => valueFor(autor.por_ano, autor.totais, year, "empenhado") > 0).length : autores.length)} />
            {Object.entries(tipos).map(([code, value]) => (
              <Stat key={code} label={TIPO_LABELS[code] ?? code} value={formatBRL(value[metric])} />
            ))}
          </div>
          <YearBars points={points} metric={metric} selectedYear={year} onSelectYear={(item) => setYear(item === year ? "all" : item)} height={196} />
        </div>
      </Panel>

      <Panel title={<b>Autores</b>} flush fill style={{ gridColumn: "3", gridRow: "1 / span 2" }}>
        <BarList
          rows={autores.map(({ autor, value }) => ({
            key: autor.id,
            label: displayName(autor),
            sub: [autor.partido, CASA_LABELS[autor.casa ?? ""] ?? autor.casa].filter(Boolean).join(" · "),
            value,
            href: `/autores?autor=${encodeURIComponent(autor.id)}`
          }))}
        />
      </Panel>

      <Panel title={<b>Funções</b>} flush fill>
        <BarList
          rows={funcoes.map(({ funcao, value }) => ({ key: funcao.nome, label: funcao.nome, value, href: `/funcoes?f=${encodeURIComponent(funcao.nome)}` }))}
        />
      </Panel>

      <Panel
        title={<b>Municípios de destino</b>}
        flush
        fill
        foot={
          <span>
            Fora de município: estado {formatBRL(outros.uf?.[metric] ?? 0)}, múltiplos {formatBRL(outros.multiplo?.[metric] ?? 0)}, outros estados{" "}
            {formatBRL(outros.outras_ufs?.[metric] ?? 0)} ({metricLabel.toLowerCase()}, todo o período).
          </span>
        }
      >
        <BarList
          rows={destinos.map(({ destino, value }) => ({ key: destino.ibge, label: destino.nome, value, href: `/destinos?m=${destino.ibge}` }))}
        />
      </Panel>
    </Screen>
  );
}
