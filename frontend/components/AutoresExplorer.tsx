"use client";

import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { EmptyState, Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { YearSelect, stepYear, type YearSel } from "@/components/YearSelect";
import {
  CASA_LABELS,
  LOCALIDADE_LABELS,
  METRICS,
  displayName,
  formatBRL,
  formatInt,
  getAutores,
  getRosterSemEmendas,
  getYears,
  loadLinhasAutor,
  titleCase,
  valueFor,
  yearPoints,
  type Linha,
  type Metric
} from "@/lib/static-api";

type Casa = "all" | "camara" | "senado";
const TIPO_SHORT: Record<string, string> = { FD: "Finalidade definida", TE: "Transferência especial", BC: "Bancada" };
const CASAS: Array<{ value: Casa; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "camara", label: "Câm." },
  { value: "senado", label: "Sen." }
];

export function AutoresExplorer() {
  const years = getYears();
  const all = getAutores();
  const [casa, setCasa] = useState<Casa>("all");
  const [metric, setMetric] = useState<Metric>("empenhado");
  const [year, setYear] = useState<YearSel>("all");
  const [selectedId, setSelectedId] = useState<string>(all[0]?.id ?? "");
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autor = params.get("autor");
    if (autor && all.some((item) => item.id === autor)) {
      setSelectedId(autor);
    }
    setHydrated(true);
  }, [all]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const params = new URLSearchParams();
    params.set("autor", selectedId);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [hydrated, selectedId]);

  const list = useMemo(
    () =>
      all
        .filter((autor) => casa === "all" || autor.casa === casa || autor.casas.includes(casa))
        .map((autor) => ({ autor, value: valueFor(autor.por_ano, autor.totais, year, metric) }))
        .filter((row) => row.value > 0 || row.autor.id === selectedId)
        .sort((a, b) => b.value - a.value),
    [all, casa, metric, selectedId, year]
  );
  const selected = all.find((autor) => autor.id === selectedId) ?? all[0];
  const index = Math.max(0, list.findIndex((row) => row.autor.id === selected?.id));

  useEffect(() => {
    let alive = true;
    setLinhas(null);
    if (!selected) {
      return;
    }
    loadLinhasAutor(selected.id).then((rows) => {
      if (alive) {
        setLinhas(rows);
      }
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  const points = useMemo(() => (selected ? yearPoints(selected.por_ano, years) : []), [selected, years]);
  const visibleLinhas = useMemo(() => (linhas ?? []).filter((linha) => year === "all" || linha.a === year), [linhas, year]);

  const hotkeys = useMemo(
    () => ({
      ArrowUp: () => setSelectedId(list[(index - 1 + list.length) % list.length]?.autor.id ?? selectedId),
      ArrowDown: () => setSelectedId(list[(index + 1) % list.length]?.autor.id ?? selectedId),
      ArrowLeft: () => setYear(stepYear(years, year, -1)),
      ArrowRight: () => setYear(stepYear(years, year, 1)),
      m: () => setMetric((current) => (current === "empenhado" ? "pago_total" : "empenhado")),
      c: () => setCasa((current) => CASAS[(CASAS.findIndex((item) => item.value === current) + 1) % CASAS.length].value)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, list, selectedId, year]
  );
  useScreenHotkeys(hotkeys);

  if (!selected) {
    return <EmptyState>SEM AUTORES</EmptyState>;
  }
  const activeTotal = year === "all" ? selected.totais : { ...selected.por_ano[String(year)], emendas: selected.por_ano[String(year)]?.n ?? 0 };
  const semEmendas = getRosterSemEmendas();

  return (
    <Screen columns="320px minmax(0, 1fr) minmax(0, 1fr)" rows="auto minmax(0, 1fr) minmax(0, 1.2fr)">
      <Panel
        title={<b>Autores</b>}
        aside={<Segmented label="Casa" value={casa} options={CASAS} onChange={setCasa} />}
        flush
        fill
        style={{ gridRow: "1 / span 3" }}
        foot={`${list.length} com emenda no recorte; ${semEmendas.length} da bancada sem emenda executada no período.`}
      >
        <ul className="menu" role="listbox" aria-label="Autores">
          {list.map(({ autor, value }) => (
            <li key={autor.id} role="presentation">
              <button type="button" role="option" aria-selected={autor.id === selected.id} onClick={() => setSelectedId(autor.id)}>
                <span className="truncate">
                  {displayName(autor)}
                  <span className="faint ml-1.5 text-[10px] tracking-[0.08em]">{autor.partido}</span>
                </span>
                <span className="num">{formatBRL(value)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-3">
            {selected.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.foto} alt="" className="photo" loading="lazy" referrerPolicy="no-referrer" />
            ) : null}
            <span>
              <b className="serif text-[16px]">{displayName(selected)}</b>
              <span className="mt-0.5 block text-[10.5px] tracking-[0.12em] text-ash">
                {[titleCase(selected.nome ?? ""), selected.partido, selected.casas.map((item) => CASA_LABELS[item] ?? item).join(" e "), selected.legislaturas.length ? `legislaturas ${selected.legislaturas.join(", ")}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </span>
        }
        aside={
          <>
            <YearSelect years={years} value={year} onChange={setYear} />
            <Segmented label="Métrica" value={metric} options={METRICS.map((item) => ({ value: item.key, label: item.label }))} onChange={setMetric} />
          </>
        }
        style={{ gridColumn: "2 / span 2" }}
      >
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label={year === "all" ? "Empenhado" : `Empenhado em ${year}`} value={formatBRL(activeTotal.empenhado)} />
            <Stat label="Pago, incl. restos a pagar" value={formatBRL(activeTotal.pago_total)} />
            <Stat label="Linhas de emenda" value={formatInt(activeTotal.n)} />
            {Object.entries(selected.tipos).map(([code, value]) => (
              <Stat key={code} label={TIPO_SHORT[code] ?? code} value={formatBRL(value[metric])} />
            ))}
            <Stat label="Códigos SIAFI" value={selected.codigos_siafi.join(", ") || "–"} />
          </div>
          <YearBars points={points} metric={metric} selectedYear={year} onSelectYear={(item) => setYear(item === year ? "all" : item)} height={170} />
        </div>
      </Panel>

      <Panel title={<b>Destinos</b>} flush fill>
        <BarList rows={selected.destinos.map((row) => ({ key: row.id, label: row.nome ?? row.id, value: row[metric], href: `/destinos?m=${row.id}` }))} />
      </Panel>
      <Panel title={<b>Funções</b>} flush fill>
        <BarList rows={selected.funcoes.map((row) => ({ key: row.id, label: row.nome ?? row.id, value: row[metric], href: `/funcoes?f=${encodeURIComponent(row.id)}` }))} />
      </Panel>

      <Panel title={<b>Emendas</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">{linhas ? `${visibleLinhas.length} linhas` : "carregando"}</span>} flush fill style={{ gridColumn: "2 / span 2" }}>
        {linhas && visibleLinhas.length === 0 ? (
          <EmptyState>SEM EMENDAS NESTE ANO</EmptyState>
        ) : (
          <table className="ruled">
            <thead>
              <tr>
                <th>Ano</th>
                <th>Nº</th>
                <th>Tipo</th>
                <th>Destino</th>
                <th>Função</th>
                <th>Ação</th>
                <th className="right">Empenhado</th>
                <th className="right">Pago</th>
              </tr>
            </thead>
            <tbody>
              {visibleLinhas.map((linha) => (
                <tr key={`${linha.c}-${linha.m}-${linha.ac}-${linha.e}`}>
                  <td className="num">{linha.a}</td>
                  <td className="num faint">{linha.n}</td>
                  <td className="faint">{linha.t}</td>
                  <td className="max-w-[180px] truncate" title={linha.mn ?? undefined}>
                    {linha.mn ? `${linha.mn}${linha.uf && linha.uf !== "RJ" ? ` (${linha.uf})` : ""}` : LOCALIDADE_LABELS[linha.loc] ?? linha.loc}
                  </td>
                  <td className="max-w-[140px] truncate" title={linha.sf}>
                    {linha.f}
                  </td>
                  <td className="max-w-[320px] truncate text-ash" title={linha.ac}>
                    {titleCase(linha.ac)}
                  </td>
                  <td className="num right">{formatBRL(linha.e)}</td>
                  <td className="num right">{formatBRL(linha.p + linha.rp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Screen>
  );
}
