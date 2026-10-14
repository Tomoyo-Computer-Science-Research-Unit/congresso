"use client";

import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { EmptyState, Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { CASA_LABELS, METRICS, formatBRL, formatInt, getFuncoes, getYears, niceName, valueFor, yearPoints, type Metric } from "@/lib/static-api";

export function FuncoesExplorer() {
  const years = getYears();
  const all = getFuncoes();
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

  const list = useMemo(() => all.map((funcao) => ({ funcao, value: valueFor(funcao.por_ano, funcao.totais, "all", metric) })).sort((a, b) => b.value - a.value), [all, metric]);
  const selected = all.find((item) => item.nome === selectedName) ?? all[0];
  const index = Math.max(0, list.findIndex((row) => row.funcao.nome === selected?.nome));
  const points = useMemo(() => (selected ? yearPoints(selected.por_ano, years) : []), [selected, years]);

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
  const share = selected.totais[metric] / Math.max(1, list.reduce((sum, row) => sum + row.value, 0));

  return (
    <Screen columns="320px minmax(0, 1fr) minmax(0, 1fr)" rows="auto minmax(0, 1fr)">
      <Panel title={<b>Funções</b>} aside={<Segmented label="Métrica" value={metric} options={METRICS.map((item) => ({ value: item.key, label: item.label }))} onChange={setMetric} />} flush fill style={{ gridRow: "1 / span 2" }}>
        <ul className="menu" role="listbox" aria-label="Funções">
          {list.map(({ funcao, value }) => (
            <li key={funcao.nome} role="presentation">
              <button type="button" role="option" aria-selected={funcao.nome === selected.nome} onClick={() => setSelectedName(funcao.nome)}>
                <span className="truncate">{funcao.nome}</span>
                <span className="num">{formatBRL(value)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={<b>{selected.nome}</b>} style={{ gridColumn: "2 / span 2" }}>
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label="Empenhado" value={formatBRL(selected.totais.empenhado)} />
            <Stat label="Pago, incl. restos a pagar" value={formatBRL(selected.totais.pago_total)} />
            <Stat label="Linhas de emenda" value={formatInt(selected.totais.n)} />
            <Stat label="Parte do total da bancada" value={`${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(share * 100)}%`} />
          </div>
          <YearBars points={points} metric={metric} height={170} />
        </div>
      </Panel>

      <Panel title={<b>Autores</b>} flush fill>
        <BarList
          rows={selected.autores.map((row) => ({
            key: row.id,
            label: niceName(row.nome ?? row.id),
            sub: [row.partido, CASA_LABELS[row.casa ?? ""] ?? row.casa].filter(Boolean).join(" · "),
            value: row[metric],
            href: `/autores?autor=${encodeURIComponent(row.id)}`
          }))}
        />
      </Panel>
      <Panel title={<b>Destinos</b>} flush fill>
        <BarList rows={selected.destinos.map((row) => ({ key: row.id, label: row.nome ?? row.id, value: row[metric], href: `/destinos?m=${row.id}` }))} />
      </Panel>
    </Screen>
  );
}
