"use client";

import { useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { BANCADA_CURTA } from "@/lib/uf";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { YearSelect, stepYear, type YearSel } from "@/components/YearSelect";
import { GroupMoney, MoneySum, adjust, useMoneyMode, valueIn } from "@/lib/money";
import {
  BB_CODIGO,
  CASA_LABELS,
  METRICS,
  TIPO_LABELS,
  displayName,
  formatInt,
  getAutores,
  getByTipo,
  getByTipoYear,
  getByYear,
  getDestinos,
  getFavorecidos,
  getFuncoes,
  getTotals,
  getYears,
  niceName,
  valueFor,
  yearPoints,
  type Brief,
  type Metric
} from "@/lib/static-api";

export function Panorama() {
  const years = getYears();
  const porAno = getByYear();
  const { mode, real } = useMoneyMode();
  const [year, setYear] = useState<YearSel>("all");
  const [metric, setMetric] = useState<Metric>("empenhado");

  const nominalPoints = useMemo(() => yearPoints(porAno, years), [porAno, years]);
  const points = useMemo(
    () => (real ? nominalPoints.map((point) => ({ ...point, empenhado: adjust(point.empenhado, point.year), pago_total: adjust(point.pago_total, point.year) })) : nominalPoints),
    [nominalPoints, real]
  );
  const nominalByYear = useMemo(() => Object.fromEntries(nominalPoints.map((point) => [point.year, point])), [nominalPoints]);
  const totals = year === "all" ? getTotals() : porAno[String(year)];
  const tipoAnos = getByTipoYear();
  const tipos: Record<string, Brief> =
    year === "all" ? getByTipo() : Object.fromEntries(Object.entries(tipoAnos).flatMap(([code, byYear]) => (byYear[String(year)] ? [[code, byYear[String(year)]]] : [])));

  const autores = useMemo(
    () =>
      getAutores()
        .map((autor) => ({ autor, value: valueIn(mode, autor.por_ano, autor.totais, year, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 24),
    [metric, mode, year]
  );
  const destinos = useMemo(
    () =>
      getDestinos()
        .map((destino) => ({ destino, value: valueIn(mode, destino.por_ano, destino.totais, year, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [metric, mode, year]
  );
  const funcoes = useMemo(
    () =>
      getFuncoes()
        .map((funcao) => ({ funcao, value: valueIn(mode, funcao.por_ano, funcao.totais, year, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [metric, mode, year]
  );
  const favorecidos = useMemo(
    () =>
      getFavorecidos()
        .map((favorecido) => {
          const nominal = year === "all" ? favorecido.total : (favorecido.por_ano[String(year)] ?? 0);
          const value = !real ? nominal : year === "all" ? Object.entries(favorecido.por_ano).reduce((sum, [y, v]) => sum + adjust(v, y), 0) : adjust(nominal, year);
          return { favorecido, value, nominal };
        })
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [real, year]
  );
  const yearLabel = year === "all" ? `${years[0]}–${years[years.length - 1]}` : String(year);
  const autoresComEmenda = getAutores().filter((autor) => valueFor(autor.por_ano, autor.totais, year, "empenhado") > 0).length;

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
            <b>{BANCADA_CURTA}</b> · {yearLabel}
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
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label="Empenhado" value={<GroupMoney porAno={porAno} totais={totals} year={year} metric="empenhado" />} />
            <Stat label="Pago, incl. restos a pagar" value={<GroupMoney porAno={porAno} totais={totals} year={year} metric="pago_total" />} />
            <Stat label="Linhas de emenda" value={formatInt(totals.n)} />
            <Stat label="Autores com emenda" value={formatInt(autoresComEmenda)} />
          </div>
          <YearBars points={points} metric={metric} selectedYear={year} onSelectYear={(item) => setYear(item === year ? "all" : item)} height={150} nominal={real ? nominalByYear : undefined} />
        </div>
      </Panel>

      <div className="grid min-h-0 grid-rows-2 gap-2" style={{ gridColumn: "3", gridRow: "1 / span 2" }}>
        <Panel title={<b>Autores</b>} flush fill>
          <BarList
            rows={autores.map(({ autor, value }) => ({
              key: autor.id,
              label: displayName(autor),
              sub: [autor.partido, CASA_LABELS[autor.casa ?? ""] ?? autor.casa].filter(Boolean).join(" · "),
              value,
              valueNode: <GroupMoney porAno={autor.por_ano} totais={autor.totais} year={year} metric={metric} />,
              href: `/autores?autor=${encodeURIComponent(autor.id)}`
            }))}
          />
        </Panel>
        <Panel title={<b>Favorecidos</b>} flush fill>
          <BarList
            rows={favorecidos.map(({ favorecido, value, nominal }) => ({
              key: favorecido.codigo,
              label: niceName(favorecido.nome),
              sub: favorecido.codigo === BB_CODIGO ? "repasse fundo a fundo via BB" : [favorecido.natureza_juridica, favorecido.municipio ? niceName(favorecido.municipio) : null].filter(Boolean).join(" · "),
              value,
              valueNode: <MoneySum real={value} nominal={nominal} />,
              href: `/favorecidos?f=${encodeURIComponent(favorecido.slug)}`
            }))}
          />
        </Panel>
      </div>

      <Panel title={<b>Funções</b>} flush fill>
        <BarList
          rows={funcoes.map(({ funcao, value }) => ({
            key: funcao.nome,
            label: funcao.nome,
            value,
            valueNode: <GroupMoney porAno={funcao.por_ano} totais={funcao.totais} year={year} metric={metric} />,
            href: `/funcoes?f=${encodeURIComponent(funcao.nome)}`
          }))}
        />
      </Panel>

      <Panel
        title={<b>Municípios de destino</b>}
        flush
        fill
      >
        <BarList
          rows={destinos.map(({ destino, value }) => ({
            key: destino.ibge,
            label: destino.nome,
            value,
            valueNode: <GroupMoney porAno={destino.por_ano} totais={destino.totais} year={year} metric={metric} />,
            href: `/destinos?m=${destino.ibge}`
          }))}
        />
      </Panel>
    </Screen>
  );
}
