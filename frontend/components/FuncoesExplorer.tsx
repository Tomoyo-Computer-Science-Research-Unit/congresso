"use client";

import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { EmptyState, Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { GroupMoney, adjust, useMoneyMode, valueIn } from "@/lib/money";
import { CASA_LABELS, METRICS, formatInt, getFuncoes, getYears, niceName, yearPoints, type Metric } from "@/lib/static-api";

export function FuncoesExplorer() {
  const years = getYears();
  const all = getFuncoes();
  const { mode, real } = useMoneyMode();
  const [metric, setMetric] = useState<Metric>("empenhado");
  const [selectedName, setSelectedName] = useState(all[0]?.nome ?? "");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("f");
    if (name && all.some((item) => item.nome === name)) {
      setSelectedName(name);
    }
    setHydrated(true);
  }, [all]);
  useEffect(() => {
    if (hydrated) {
      window.history.replaceState(null, "", `${window.location.pathname}?f=${encodeURIComponent(selectedName)}`);
    }
  }, [hydrated, selectedName]);

  const list = useMemo(() => all.map((funcao) => ({ funcao, value: valueIn(mode, funcao.por_ano, funcao.totais, "all", metric) })).sort((a, b) => b.value - a.value), [all, metric, mode]);
  const selected = all.find((item) => item.nome === selectedName) ?? all[0];
  const index = Math.max(0, list.findIndex((row) => row.funcao.nome === selected?.nome));
  const nominalPoints = useMemo(() => (selected ? yearPoints(selected.por_ano, years) : []), [selected, years]);
  const points = useMemo(
    () => (real ? nominalPoints.map((point) => ({ ...point, empenhado: adjust(point.empenhado, point.year), pago_total: adjust(point.pago_total, point.year) })) : nominalPoints),
    [nominalPoints, real]
  );

  const hotkeys = useMemo(
    () => ({
      ArrowUp: () => setSelectedName(list[(index - 1 + list.length) % list.length]?.funcao.nome ?? selectedName),
      ArrowDown: () => setSelectedName(list[(index + 1) % list.length]?.funcao.nome ?? selectedName),
      m: () => setMetric((current) => (current === "empenhado" ? "pago_total" : "empenhado"))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, list, selectedName]
  );
  useScreenHotkeys(hotkeys);

  if (!selected) {
    return <EmptyState>SEM FUNÇÕES</EmptyState>;
  }
  const selectedValue = valueIn(mode, selected.por_ano, selected.totais, "all", metric);
  const share = selectedValue / Math.max(1, list.reduce((sum, row) => sum + row.value, 0));

  return (
    <Screen columns="320px minmax(0, 1fr) minmax(0, 1fr)" rows="auto minmax(0, 1fr)">
      <Panel title={<b>Funções</b>} aside={<Segmented label="Métrica" value={metric} options={METRICS.map((item) => ({ value: item.key, label: item.label }))} onChange={setMetric} />} flush fill style={{ gridRow: "1 / span 2" }}>
        <ul className="menu" role="listbox" aria-label="Funções">
          {list.map(({ funcao }) => (
            <li key={funcao.nome} role="presentation">
              <button type="button" role="option" aria-selected={funcao.nome === selected.nome} onClick={() => setSelectedName(funcao.nome)}>
                <span className="truncate">{funcao.nome}</span>
                <span className="num">
                  <GroupMoney porAno={funcao.por_ano} totais={funcao.totais} year="all" metric={metric} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={<b>{selected.nome}</b>} style={{ gridColumn: "2 / span 2" }}>
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label="Empenhado" value={<GroupMoney porAno={selected.por_ano} totais={selected.totais} year="all" metric="empenhado" />} />
            <Stat label="Pago, incl. restos a pagar" value={<GroupMoney porAno={selected.por_ano} totais={selected.totais} year="all" metric="pago_total" />} />
            <Stat label="Linhas de emenda" value={formatInt(selected.totais.n)} />
            <Stat label="Parte do total da bancada" value={`${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(share * 100)}%`} />
          </div>
          <YearBars points={points} metric={metric} height={170} nominal={real ? Object.fromEntries(nominalPoints.map((point) => [point.year, point])) : undefined} />
        </div>
      </Panel>

      <Panel title={<b>Autores</b>} flush fill>
        <BarList
          rows={selected.autores.map((row) => ({
            key: row.id,
            label: niceName(row.nome ?? row.id),
            sub: [row.partido, CASA_LABELS[row.casa ?? ""] ?? row.casa].filter(Boolean).join(" · "),
            value: valueIn(mode, row.por_ano ?? {}, row, "all", metric),
            valueNode: <GroupMoney porAno={row.por_ano ?? {}} totais={row} year="all" metric={metric} />,
            href: `/autores?autor=${encodeURIComponent(row.id)}`
          }))}
        />
      </Panel>
      <Panel title={<b>Destinos</b>} flush fill>
        <BarList
          rows={selected.destinos.map((row) => ({
            key: row.id,
            label: row.nome ?? row.id,
            value: valueIn(mode, row.por_ano ?? {}, row, "all", metric),
            valueNode: <GroupMoney porAno={row.por_ano ?? {}} totais={row} year="all" metric={metric} />,
            href: `/destinos?m=${row.id}`
          }))}
        />
      </Panel>
    </Screen>
  );
}
