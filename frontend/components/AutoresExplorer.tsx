"use client";

import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { MonthGrid } from "@/components/MonthGrid";
import Link from "@/components/UfLink";
import { useUf } from "@/lib/use-uf";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { EmptyState, Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { YearSelect, stepYear, type YearSel } from "@/components/YearSelect";
import { GroupMoney, Money, MoneySum, adjust, useMoneyMode, valueIn } from "@/lib/money";
import {
  BB_CODIGO,
  CASA_LABELS,
  LOCALIDADE_LABELS,
  METRICS,
  displayName,
  formatInt,
  getAutores,
  getYears,
  ementaCase,
  formatDate,
  formatPct,
  loadBancada,
  loadLinhasAutor,
  loadProposicoes,
  loadVotacoesIndex,
  loadVotosParlamentar,
  niceName,
  resultadoClass,
  resumoVotos,
  titleCase,
  votoClass,
  yearPoints,
  FLAG,
  VOTO_LABELS,
  type Linha,
  type Metric,
  type PresencaCelula,
  type VotacaoIdx,
  type VotoLinha
} from "@/lib/static-api";

type Casa = "all" | "camara" | "senado";
const TIPO_SHORT: Record<string, string> = { FD: "Finalidade definida", TE: "Transferência especial", BC: "Bancada" };
type View = "emendas" | "votos" | "faltas";
type VoteFilter = "todos" | "sim" | "nao" | "maioria" | "partido" | "governo" | "ausencias";
const VOTE_FILTERS: Array<{ value: VoteFilter; label: string }> = [
  { value: "todos", label: "Todos os votos" },
  { value: "sim", label: "Votou sim" },
  { value: "nao", label: "Votou não" },
  { value: "maioria", label: "Contra a maioria" },
  { value: "partido", label: "Contra o partido" },
  { value: "governo", label: "Contra o governo" },
  { value: "ausencias", label: "Ausências" }
];
const CASAS: Array<{ value: Casa; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "camara", label: "Câm." },
  { value: "senado", label: "Sen." }
];

export function AutoresExplorer() {
  const UF = useUf();
  const years = getYears();
  const all = getAutores();
  const { mode, real } = useMoneyMode();
  const [casa, setCasa] = useState<Casa>("all");
  const [partido, setPartido] = useState<string>("all");
  const partidos = useMemo(() => [...new Set(all.map((autor) => autor.partido).filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [all]);
  const [metric, setMetric] = useState<Metric>("empenhado");
  const [year, setYear] = useState<YearSel>("all");
  const [selectedId, setSelectedId] = useState<string>(all[0]?.id ?? "");
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("emendas");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("todos");
  const [votos, setVotos] = useState<{ id: string; linhas: VotoLinha[] } | null>(null);
  const [indice, setIndice] = useState<Map<string, VotacaoIdx> | null>(null);
  const [props, setProps] = useState<Record<string, [string, string]>>({});
  const [presenca, setPresenca] = useState<Record<string, Record<string, PresencaCelula>> | null>(null);

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
        .filter((autor) => partido === "all" || autor.partido === partido)
        .map((autor) => ({ autor, value: valueIn(mode, autor.por_ano, autor.totais, year, metric) }))
        .filter((row) => row.value > 0 || row.autor.id === selectedId)
        .sort((a, b) => b.value - a.value),
    [all, casa, metric, mode, partido, selectedId, year]
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

  const coletivo = selected?.id === UF.bancadaId;
  useEffect(() => {
    let alive = true;
    if (!selected || coletivo) {
      return;
    }
    Promise.all([loadVotosParlamentar(selected.id), loadVotacoesIndex(), loadBancada()]).then(([rows, index, bancada]) => {
      if (alive) {
        setVotos({ id: selected.id, linhas: rows });
        setIndice((current) => current ?? new Map(index.map((item) => [item.id, item])));
        setPresenca(bancada.presenca);
      }
    });
    return () => {
      alive = false;
    };
  }, [selected, coletivo]);
  useEffect(() => {
    let alive = true;
    if (view === "votos") {
      loadProposicoes().then((data) => alive && setProps(data));
    }
    return () => {
      alive = false;
    };
  }, [view]);
  useEffect(() => {
    if (coletivo && view !== "emendas") {
      setView("emendas");
    }
  }, [coletivo, view]);

  const votosDoAutor = useMemo(() => (votos && votos.id === selected?.id ? votos.linhas : null), [selected?.id, votos]);
  const votosNoAno = useMemo(
    () => (votosDoAutor && indice ? votosDoAutor.filter(([id]) => year === "all" || indice.get(id)?.data.startsWith(String(year))) : null),
    [indice, votosDoAutor, year]
  );
  const resumo = useMemo(() => (votosNoAno ? resumoVotos(votosNoAno) : null), [votosNoAno]);
  const porMes = useMemo(() => (selected && presenca ? presenca[selected.id] ?? {} : {}), [presenca, selected]);
  const faltas = useMemo(() => {
    const total: PresencaCelula = [0, 0, 0];
    for (const [mes, cell] of Object.entries(porMes)) {
      if (year === "all" || mes.startsWith(`${year}-`)) {
        total[0] += cell[0];
        total[1] += cell[1];
        total[2] += cell[2];
      }
    }
    return total;
  }, [porMes, year]);
  const votoLinhas = useMemo(
    () =>
      (votosNoAno ?? []).filter(([, code, flags]) => {
        switch (voteFilter) {
          case "sim":
            return code === "S";
          case "nao":
            return code === "N";
          case "maioria":
            return Boolean(flags & FLAG.contraMaioria);
          case "partido":
            return Boolean(flags & FLAG.contraPartido);
          case "governo":
            return Boolean(flags & FLAG.contraGoverno);
          case "ausencias":
            return code === "F" || code === "J";
          default:
            return true;
        }
      }),
    [voteFilter, votosNoAno]
  );

  const nominalPoints = useMemo(() => (selected ? yearPoints(selected.por_ano, years) : []), [selected, years]);
  const points = useMemo(
    () => (real ? nominalPoints.map((point) => ({ ...point, empenhado: adjust(point.empenhado, point.year), pago_total: adjust(point.pago_total, point.year) })) : nominalPoints),
    [nominalPoints, real]
  );
  const visibleLinhas = useMemo(() => (linhas ?? []).filter((linha) => year === "all" || linha.a === year), [linhas, year]);
  // Tipos de emenda no ano escolhido, somados das linhas já carregadas do autor.
  const tiposNoAno = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const linha of visibleLinhas) {
      totals[linha.t] = (totals[linha.t] ?? 0) + (metric === "empenhado" ? linha.e : linha.p + linha.rp);
    }
    return totals;
  }, [metric, visibleLinhas]);

  const hotkeys = useMemo(
    () => ({
      ArrowUp: () => setSelectedId(list[(index - 1 + list.length) % list.length]?.autor.id ?? selectedId),
      ArrowDown: () => setSelectedId(list[(index + 1) % list.length]?.autor.id ?? selectedId),
      ArrowLeft: () => setYear(stepYear(years, year, -1)),
      ArrowRight: () => setYear(stepYear(years, year, 1)),
      m: () => setMetric((current) => (current === "empenhado" ? "pago_total" : "empenhado")),
      v: () => setView((current) => (coletivo ? "emendas" : current === "emendas" ? "votos" : current === "votos" ? "faltas" : "emendas")),
      c: () => setCasa((current) => CASAS[(CASAS.findIndex((item) => item.value === current) + 1) % CASAS.length].value)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coletivo, index, list, selectedId, year]
  );
  useScreenHotkeys(hotkeys);

  if (!selected) {
    return <EmptyState>SEM AUTORES</EmptyState>;
  }
  const activeTotal = year === "all" ? selected.totais : (selected.por_ano[String(year)] ?? { n: 0, empenhado: 0, pago_total: 0 });

  return (
    <Screen columns="320px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" rows="auto minmax(0, 1fr) minmax(0, 1.4fr)">
      <Panel
        title={<b>Autores</b>}
        aside={<Segmented label="Casa" value={casa} options={CASAS} onChange={setCasa} />}
        flush
        fill
        style={{ gridRow: "1 / span 3" }}
      >
        <div className="flex items-center gap-2 border-b border-line p-2">
          <select className="yearselect" aria-label="Partido" value={partido} onChange={(event) => setPartido(event.target.value)}>
            <option value="all">Todos os partidos</option>
            {partidos.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <ul className="menu" role="listbox" aria-label="Autores">
          {list.map(({ autor, value }) => (
            <li key={autor.id} role="presentation">
              <button type="button" role="option" aria-selected={autor.id === selected.id} onClick={() => setSelectedId(autor.id)}>
                <span className="whitespace-normal break-words">
                  {displayName(autor)}
                  <span className="faint ml-1.5 text-[10px] tracking-[0.08em]">{autor.partido}</span>
                </span>
                <span className="num">
                  <GroupMoney porAno={autor.por_ano} totais={autor.totais} year={year} metric={metric} />
                </span>
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
                {selected.id === UF.bancadaId
                  ? `emendas de bancada (RP 7): coletivas, propostas pela bancada federal ${UF.preposicao} ${UF.code}, sem autor individual · código SIAFI ${UF.bancadaSiafi}`
                  : [titleCase(selected.nome ?? ""), selected.partido, selected.casas.map((item) => CASA_LABELS[item] ?? item).join(" e "), selected.legislaturas.length ? `legislaturas ${selected.legislaturas.join(", ")}` : null, selected.codigos_siafi.length ? `SIAFI ${selected.codigos_siafi.join(", ")}` : null]
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
        style={{ gridColumn: "2 / span 3" }}
      >
        <div className="grid grid-cols-[250px_250px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label={year === "all" ? "Empenhado" : `Empenhado em ${year}`} value={<GroupMoney porAno={selected.por_ano} totais={selected.totais} year={year} metric="empenhado" />} />
            <Stat label="Pago, incl. restos a pagar" value={<GroupMoney porAno={selected.por_ano} totais={selected.totais} year={year} metric="pago_total" />} />
            <Stat label="Linhas de emenda" value={formatInt(activeTotal.n)} />
            {year === "all"
              ? Object.entries(selected.tipos).map(([code, value]) => <Stat key={code} label={TIPO_SHORT[code] ?? code} value={<MoneySum real={value[metric]} nominal={value[metric]} />} />)
              : Object.entries(tiposNoAno).map(([code, value]) => <Stat key={code} label={TIPO_SHORT[code] ?? code} value={<Money nominal={value} year={year} />} />)}
          </div>
          <div>
            <Stat
              label={year === "all" ? "Participação em votações" : `Participação em ${year}`}
              value={coletivo || !resumo || !resumo.votacoes ? "–" : formatPct(resumo.votou / Math.max(1, resumo.votacoes - resumo.presidindo))}
              sub={resumo && resumo.votacoes ? `de ${formatInt(resumo.votacoes)}` : undefined}
            />
            <Stat label="Com a maioria do plenário" value={coletivo || !resumo || !resumo.simOuNao ? "–" : formatPct(resumo.comMaioria / resumo.simOuNao)} />
            <Stat label="Contra o próprio partido" value={coletivo || !resumo || !resumo.partidoBase ? "–" : formatInt(resumo.contraPartido)} sub={resumo && resumo.partidoBase ? `de ${formatInt(resumo.partidoBase)}` : undefined} />
            <Stat label="Contra a orientação do governo" value={coletivo || !resumo || !resumo.governoBase ? "–" : formatInt(resumo.contraGoverno)} sub={resumo && resumo.governoBase ? `de ${formatInt(resumo.governoBase)}` : undefined} />
            <Stat
              label="Faltas em sessões"
              value={coletivo || !presenca || !faltas[2] ? "–" : `${formatInt(faltas[0])}${faltas[1] ? ` (${formatInt(faltas[1])})` : ""}`}
              sub={faltas[2] ? `de ${formatInt(faltas[2])}` : undefined}
            />
          </div>
          <YearBars points={points} metric={metric} selectedYear={year} onSelectYear={(item) => setYear(item === year ? "all" : item)} height={150} nominal={real ? Object.fromEntries(nominalPoints.map((point) => [point.year, point])) : undefined} />
        </div>
      </Panel>

      <Panel title={<b>Destinos</b>} flush fill>
        <BarList
          rows={selected.destinos
            .map((row) => ({
            key: row.id,
            label: row.nome ?? row.id,
            value: valueIn(mode, row.por_ano ?? {}, row, year, metric),
            valueNode: <GroupMoney porAno={row.por_ano ?? {}} totais={row} year={year} metric={metric} />,
            href: `/destinos?m=${row.id}`
          }))
            .filter((row) => row.value > 0)
            .sort((a, b) => b.value - a.value)}
          empty="SEM EMENDA NESTE ANO"
        />
      </Panel>
      <Panel title={<b>Funções</b>} flush fill>
        <BarList
          rows={selected.funcoes
            .map((row) => ({
            key: row.id,
            label: row.nome ?? row.id,
            value: valueIn(mode, row.por_ano ?? {}, row, year, metric),
            valueNode: <GroupMoney porAno={row.por_ano ?? {}} totais={row} year={year} metric={metric} />,
            href: `/funcoes?f=${encodeURIComponent(row.id)}`
          }))
            .filter((row) => row.value > 0)
            .sort((a, b) => b.value - a.value)}
          empty="SEM EMENDA NESTE ANO"
        />
      </Panel>
      <Panel title={<b>Favorecidos</b>} flush fill>
        <BarList
          rows={(selected.favorecidos ?? [])
            .map((row) => {
              const nominal = year === "all" ? row.valor : (row.por_ano?.[String(year)] ?? 0);
              const value = !real ? nominal : year === "all" ? Object.entries(row.por_ano ?? {}).reduce((sum, [y, v]) => sum + adjust(v, y), 0) || nominal : adjust(nominal, year);
              return {
                key: row.codigo,
                label: niceName(row.nome),
                sub: row.codigo === BB_CODIGO ? "repasse fundo a fundo via BB" : row.tipo ?? undefined,
                value,
                valueNode: <MoneySum real={value} nominal={nominal} />,
                href: `/favorecidos?f=${encodeURIComponent(row.slug)}`
              };
            })
            .filter((row) => row.value > 0)
            .sort((a, b) => b.value - a.value)}
          empty={year === "all" ? "SEM PAGAMENTO REGISTRADO" : "SEM PAGAMENTO NESTE ANO"}
        />
      </Panel>

      <Panel
        title={
          <Segmented
            label="Lista"
            value={view}
            options={[
              { value: "emendas", label: "Emendas" },
              { value: "votos", label: "Votos", disabled: coletivo },
              { value: "faltas", label: "Faltas", disabled: coletivo }
            ]}
            onChange={setView}
          />
        }
        aside={
          view === "votos" ? (
            <>
              <select className="yearselect" aria-label="Filtro de votos" value={voteFilter} onChange={(event) => setVoteFilter(event.target.value as VoteFilter)}>
                {VOTE_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="text-[10px] tracking-[0.14em] text-ash">{votosNoAno ? `${formatInt(votoLinhas.length)} votos` : "carregando"}</span>
            </>
          ) : view === "emendas" ? (
            <span className="text-[10px] tracking-[0.14em] text-ash">{linhas ? `${visibleLinhas.length} linhas` : "carregando"}</span>
          ) : null
        }
        flush
        fill
        style={{ gridColumn: "2 / span 3" }}
      >
        {view === "faltas" ? (
          <div className="p-3">
            <MonthGrid porMes={porMes} />
          </div>
        ) : view === "votos" ? (
          !votosNoAno || !indice ? (
            <EmptyState>CARREGANDO</EmptyState>
          ) : votoLinhas.length === 0 ? (
            <EmptyState>{votosDoAutor && votosDoAutor.length === 0 ? "SEM VOTAÇÃO NOMINAL NA BANCADA DESDE 2015" : "SEM VOTOS NESTE FILTRO"}</EmptyState>
          ) : (
            <table className="ruled nofx">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Casa</th>
                  <th>Proposição</th>
                  <th>Ementa</th>
                  <th>Voto</th>
                  <th>Resultado</th>
                  <th className="right">Placar</th>
                </tr>
              </thead>
              <tbody>
                {votoLinhas.map(([id, code, flags]) => {
                  const votacao = indice.get(id);
                  if (!votacao) {
                    return null;
                  }
                  const contra = flags & (FLAG.contraMaioria | FLAG.contraPartido | FLAG.contraGoverno);
                  return (
                    <tr key={id}>
                      <td className="num">{formatDate(votacao.data)}</td>
                      <td className="faint">{votacao.casa === "senado" ? "Sen." : "Câm."}</td>
                      <td className="whitespace-nowrap">
                        <Link href={`/votacoes?v=${encodeURIComponent(id)}`} className="text-ink hover:underline hover:underline-offset-4">
                          {votacao.titulo || "votação"}
                        </Link>
                      </td>
                      <td className="max-w-[420px] whitespace-normal break-words text-ash">{ementaCase(votacao.prop ? props[votacao.prop]?.[1] : "")}</td>
                      <td className={`${votoClass(code)} ${contra ? "font-medium" : ""}`}>
                        {VOTO_LABELS[code] ?? code}
                        {flags & FLAG.contraPartido ? <span className="faint"> · contra o partido</span> : null}
                        {flags & FLAG.contraGoverno ? <span className="faint"> · contra o governo</span> : null}
                      </td>
                      <td className={resultadoClass(votacao.resultado)}>{votacao.resultado ?? "–"}</td>
                      <td className="num right faint">
                        {votacao.sim}–{votacao.nao}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : linhas && visibleLinhas.length === 0 ? (
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
                  <td className="max-w-[150px] whitespace-normal break-words" title={linha.mn ?? undefined}>
                    {linha.mn ? `${linha.mn}${linha.uf && linha.uf !== UF.code ? ` (${linha.uf})` : ""}` : LOCALIDADE_LABELS[linha.loc] ?? linha.loc}
                  </td>
                  <td className="max-w-[120px] whitespace-normal break-words" title={linha.sf}>
                    {linha.f}
                  </td>
                  <td className="max-w-[380px] whitespace-normal break-words text-ash" title={linha.ac}>
                    {titleCase(linha.ac)}
                  </td>
                  <td className="num right">
                    <Money nominal={linha.e} year={linha.a} />
                  </td>
                  <td className="num right">
                    <Money nominal={linha.p + linha.rp} year={linha.a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Screen>
  );
}
