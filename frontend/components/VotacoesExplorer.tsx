"use client";

import Link from "@/components/UfLink";
import { useEffect, useMemo, useState } from "react";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { EmptyState, Panel, Screen, Stat } from "@/components/ui";
import { YearSelect, stepYear, type YearSel } from "@/components/YearSelect";
import {
  CASA_LABELS,
  ORIENTACAO_LABELS,
  TIPO_VOTACAO_LABELS,
  ementaCase,
  formatDate,
  formatInt,
  loadBancada,
  loadProposicoes,
  loadVotacoesAno,
  loadVotacoesIndex,
  loadVotosAno,
  resultadoClass,
  votoClass,
  type Bancada,
  type BancadaPessoa,
  type VotacaoDetalhe,
  type VotacaoIdx,
  type VotosAno
} from "@/lib/static-api";
import { bancadaCurta } from "@/lib/uf";
import { useUf } from "@/lib/use-uf";

type CasaSel = "all" | "camara" | "senado";
type TipoSel = "all" | "texto" | "destaque" | "requerimento";
const CASAS: Array<{ value: CasaSel; label: string }> = [
  { value: "all", label: "Câmara e Senado" },
  { value: "camara", label: "Câmara" },
  { value: "senado", label: "Senado" }
];
const TIPOS: Array<{ value: TipoSel; label: string }> = [
  { value: "all", label: "Todos os tipos" },
  { value: "texto", label: "Texto" },
  { value: "destaque", label: "Emendas e destaques" },
  { value: "requerimento", label: "Requerimentos" }
];
/** Colunas dos votos da bancada: sim, não, abstenção e obstrução juntos, quem não votou. */
const GRUPOS: Array<{ key: string; label: string; codes: string[] }> = [
  { key: "S", label: "Sim", codes: ["S"] },
  { key: "N", label: "Não", codes: ["N"] },
  { key: "A", label: "Abstenção", codes: ["A", "O"] },
  { key: "F", label: "Não votaram", codes: ["P", "X", "F", "J"] }
];

/** Situação de quem não votou sim ou não, curta, ao lado do nome. */
const CURTO: Record<string, string> = { A: "abstenção", O: "obstrução", P: "presidindo", X: "presente sem votar", F: "ausente", J: "ausência justificada" };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function VotacoesExplorer() {
  const UF = useUf();
  const [all, setAll] = useState<VotacaoIdx[] | null>(null);
  const [props, setProps] = useState<Record<string, [string, string]>>({});
  const [bancada, setBancada] = useState<Bancada | null>(null);
  const [year, setYear] = useState<YearSel>("all");
  const [casa, setCasa] = useState<CasaSel>("all");
  const [tipo, setTipo] = useState<TipoSel>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detalhe, setDetalhe] = useState<{ ano: string; dados: Record<string, VotacaoDetalhe>; votos: VotosAno } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadVotacoesIndex(), loadProposicoes(), loadBancada()]).then(([index, proposicoes, pessoas]) => {
      if (!alive) {
        return;
      }
      const wanted = new URLSearchParams(window.location.search).get("v");
      setAll(index);
      setProps(proposicoes);
      setBancada(pessoas);
      const first = index.find((item) => item.id === wanted) ?? index[0];
      if (first) {
        setSelectedId(first.id);
        setYear(wanted && first.id === wanted ? "all" : Number(first.data.slice(0, 4)));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (selectedId) {
      window.history.replaceState(null, "", `${window.location.pathname}?v=${encodeURIComponent(selectedId)}`);
    }
  }, [selectedId]);

  const years = useMemo(() => [...new Set((all ?? []).map((item) => Number(item.data.slice(0, 4))))].sort((a, b) => a - b), [all]);
  const list = useMemo(() => {
    const needle = normalize(query.trim());
    return (all ?? []).filter((item) => {
      if (year !== "all" && Number(item.data.slice(0, 4)) !== year) return false;
      if (casa !== "all" && item.casa !== casa) return false;
      if (tipo !== "all" && item.tipo !== tipo) return false;
      if (needle) {
        const prop = item.prop ? props[item.prop] : undefined;
        return normalize(`${item.titulo} ${prop?.[1] ?? ""}`).includes(needle);
      }
      return true;
    });
  }, [all, casa, props, query, tipo, year]);
  const selected = (all ?? []).find((item) => item.id === selectedId) ?? list[0];
  const index = Math.max(0, list.findIndex((item) => item.id === selected?.id));
  const ano = selected?.data.slice(0, 4);

  useEffect(() => {
    let alive = true;
    if (!ano) {
      return;
    }
    if (detalhe?.ano === ano) {
      return;
    }
    Promise.all([loadVotacoesAno(ano), loadVotosAno(ano)]).then(([dados, votos]) => {
      if (alive) {
        setDetalhe({ ano, dados, votos });
      }
    });
    return () => {
      alive = false;
    };
  }, [ano, detalhe?.ano]);

  const hotkeys = useMemo(
    () => ({
      ArrowUp: () => setSelectedId(list[(index - 1 + list.length) % list.length]?.id ?? selectedId),
      ArrowDown: () => setSelectedId(list[(index + 1) % list.length]?.id ?? selectedId),
      ArrowLeft: () => setYear((current) => stepYear(years, current, -1)),
      ArrowRight: () => setYear((current) => stepYear(years, current, 1)),
      c: () => setCasa((current) => CASAS[(CASAS.findIndex((item) => item.value === current) + 1) % CASAS.length].value)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, list, selectedId, years]
  );
  useScreenHotkeys(hotkeys);

  if (!all) {
    return <EmptyState>CARREGANDO</EmptyState>;
  }
  if (!selected) {
    return <EmptyState>SEM VOTAÇÕES</EmptyState>;
  }

  const info = detalhe?.ano === ano ? detalhe?.dados[selected.id] : undefined;
  const votosAno = detalhe?.ano === ano ? detalhe?.votos : undefined;
  const pessoas = new Map((bancada?.pessoas ?? []).map((item) => [item.id, item]));
  const codes = votosAno?.v[selected.id];
  const membros = votosAno?.m[selected.casa] ?? [];
  const daBancada: Array<{ pessoa: BancadaPessoa | undefined; id: string; code: string }> = codes
    ? membros.map((id, position) => ({ id, pessoa: pessoas.get(id), code: codes[position] ?? "." })).filter((item) => item.code !== ".")
    : [];
  const placarUf = { S: 0, N: 0, outros: 0 };
  for (const item of daBancada) {
    if (item.code === "S") placarUf.S += 1;
    else if (item.code === "N") placarUf.N += 1;
    else placarUf.outros += 1;
  }
  const grupos = GRUPOS.map((grupo) => ({
    ...grupo,
    ids: daBancada.filter((item) => grupo.codes.includes(item.code)).sort((a, b) => (a.pessoa?.nome ?? a.id).localeCompare(b.pessoa?.nome ?? b.id, "pt-BR"))
  }));
  const prop = selected.prop ? props[selected.prop] : undefined;
  const partidos = Object.entries(info?.pp ?? {});
  const orientacoes = info?.or ?? {};

  return (
    <Screen columns="360px minmax(0, 1fr)" rows="minmax(0, 0.85fr) minmax(0, 1.15fr)">
      <Panel title={<b>Votações</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">{formatInt(list.length)}</span>} flush fill style={{ gridRow: "1 / span 2" }}>
        <div className="grid grid-cols-2 gap-2 border-b border-line p-2">
          <input className="yearselect col-span-2" type="search" aria-label="Buscar proposição" placeholder="buscar proposição ou ementa" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className="yearselect" aria-label="Casa" value={casa} onChange={(event) => setCasa(event.target.value as CasaSel)}>
            {CASAS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <YearSelect years={years} value={year} onChange={setYear} />
          <select className="yearselect col-span-2" aria-label="Tipo" value={tipo} onChange={(event) => setTipo(event.target.value as TipoSel)}>
            {TIPOS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        {list.length === 0 ? (
          <EmptyState>SEM VOTAÇÕES NESTE RECORTE</EmptyState>
        ) : (
          <ul className="menu nofx" role="listbox" aria-label="Votações">
            {list.map((item) => (
              <li key={item.id} role="presentation">
                <button type="button" role="option" aria-selected={item.id === selected.id} onClick={() => setSelectedId(item.id)}>
                  <span className="whitespace-normal break-words">
                    {item.titulo || "sem proposição"}
                    <span className="faint ml-1.5 text-[10px] tracking-[0.08em]">
                      {formatDate(item.data)} · {item.casa === "senado" ? "Sen." : "Câm."} · {TIPO_VOTACAO_LABELS[item.tipo]?.toLowerCase() ?? item.tipo}
                    </span>
                  </span>
                  <span className="num">
                    <span className={resultadoClass(item.resultado)}>
                      {item.sim}–{item.nao}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={
          <span>
            <b>{selected.titulo || "Votação"}</b> · {formatDate(selected.data)}
            {info?.h ? ` ${info.h}` : ""} · {CASA_LABELS[selected.casa]}
          </span>
        }
        aside={
          info?.f ? (
            <a href={info.f} target="_blank" rel="noreferrer" className="btn !h-7 !px-2 text-[10px]">
              fonte
            </a>
          ) : null
        }
        fill
      >
        <div className="grid grid-cols-[minmax(0,1fr)_220px_230px] gap-6">
          <div>
            <p className="serif text-[13.5px] leading-[22px] text-ink">{ementaCase(prop?.[1]) || "Sem ementa publicada."}</p>
            {info?.ob ? <p className="mt-2 text-[11.5px] leading-5 text-sumi">{info.ob}</p> : null}
            {info?.fr && info.fr !== info.ob ? <p className="mt-1 text-[11.5px] leading-5 text-ash">{info.fr}</p> : null}
          </div>
          <div>
            <Stat label="Resultado" value={<span className={resultadoClass(selected.resultado)}>{selected.resultado ?? "sem resultado publicado"}</span>} />
            <Stat label="Sim" value={formatInt(selected.sim)} />
            <Stat label="Não" value={formatInt(selected.nao)} />
            <Stat label="Abstenção" value={formatInt(selected.abst)} />
            {selected.casa === "camara" ? <Stat label="Obstrução" value={formatInt(selected.obst)} /> : null}
          </div>
          <div>
            <Stat label="Governo orientou" value={selected.governo ? (ORIENTACAO_LABELS[selected.governo] ?? selected.governo) : "–"} />
            <Stat label={`${bancadaCurta(UF)}, sim`} value={codes ? formatInt(placarUf.S) : "–"} />
            <Stat label={`${bancadaCurta(UF)}, não`} value={codes ? formatInt(placarUf.N) : "–"} />
            <Stat label="Não votaram ou outro voto" value={codes ? formatInt(placarUf.outros) : "–"} />
          </div>
        </div>
      </Panel>

      <div className="grid min-h-0 grid-cols-[310px_minmax(0,1fr)] gap-2">
        <Panel title={<b>Por partido</b>} flush fill>
          {!info ? (
            <EmptyState>CARREGANDO</EmptyState>
          ) : (
            <table className="ruled ruled--tight">
              <colgroup>
                <col style={{ width: "38%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "22%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Partido</th>
                  <th className="right">Sim</th>
                  <th className="right">Não</th>
                  <th className="right">Abst.</th>
                  <th className="right">Orient.</th>
                </tr>
              </thead>
              <tbody>
                {partidos.map(([partido, [sim, nao, abst, obst]]) => (
                  <tr key={partido}>
                    <td className="whitespace-normal break-words text-[11px]">{partido}</td>
                    <td className="num right voto-sim">{sim || ""}</td>
                    <td className="num right voto-nao">{nao || ""}</td>
                    <td className="num right faint">{abst + obst || ""}</td>
                    <td className="right faint text-[10.5px]">{orientacoes[partido] ? ORIENTACAO_LABELS[orientacoes[partido]] : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title={<b>{bancadaCurta(UF)}</b>} flush fill>
          {!votosAno ? (
            <EmptyState>CARREGANDO</EmptyState>
          ) : daBancada.length === 0 ? (
            <EmptyState>NINGUÉM DA BANCADA NESTA VOTAÇÃO</EmptyState>
          ) : (
            <div className="votegrid grid min-h-full divide-x divide-line" style={{ gridTemplateColumns: grupos.map((grupo) => (grupo.ids.length === 0 ? "max-content" : `minmax(120px, ${Math.min(grupo.ids.length, 14)}fr)`)).join(" ") }}>
              {grupos.map((grupo) => (
                <div key={grupo.key}>
                  <div className={`sticky top-0 whitespace-nowrap border-b border-line bg-paper px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] ${votoClass(grupo.key)}`}>
                    {grupo.label} · {grupo.ids.length}
                  </div>
                  <ul className="text-[11.5px] leading-5">
                    {grupo.ids.map((item) => {
                      const nome = item.pessoa?.nome ?? item.id;
                      return (
                        <li key={item.id} className="whitespace-normal px-3">
                          {item.pessoa?.autor ? (
                            <Link href={`/autores?autor=${encodeURIComponent(item.id)}`} className="text-ink hover:underline hover:underline-offset-4">
                              {nome}
                            </Link>
                          ) : (
                            <span className="text-ink">{nome}</span>
                          )}
                          <span className="ml-1.5 text-[10px] tracking-[0.08em] text-ash">
                            {item.pessoa?.partido}
                            {grupo.key === "F" || grupo.key === "A" ? ` · ${CURTO[item.code] ?? item.code}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </Screen>
  );
}
