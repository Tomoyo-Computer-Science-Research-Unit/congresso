"use client";

import Link from "@/components/UfLink";
import { useEffect, useMemo, useState } from "react";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { MONTHS, cellTitle, shade } from "@/components/MonthGrid";
import { EmptyState, Panel, Screen } from "@/components/ui";
import { CASA_LABELS, formatInt, loadBancada, type Bancada, type PresencaCelula } from "@/lib/static-api";
import { doEstado } from "@/lib/uf";
import { useUf } from "@/lib/use-uf";

type Sort = "faltas" | "taxa" | "nome";
type CasaSel = "all" | "camara" | "senado";
type YearSel = number | "all";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function sum(cells: Array<PresencaCelula | null>): PresencaCelula {
  return cells.reduce<PresencaCelula>((acc, cell) => (cell ? [acc[0] + cell[0], acc[1] + cell[1], acc[2] + cell[2]] : acc), [0, 0, 0]);
}

/** Faltas em sessões de plenário da bancada da UF: por mês num ano, ou por ano no período todo. */
export function PresencaScreen() {
  const UF = useUf();
  const [bancada, setBancada] = useState<Bancada | null>(null);
  const [year, setYear] = useState<YearSel>("all");
  const [sort, setSort] = useState<Sort>("faltas");
  const [partido, setPartido] = useState("all");
  const [casa, setCasa] = useState<CasaSel>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    loadBancada().then((data) => {
      if (alive) {
        setBancada(data);
        const meses = Object.values(data.presenca).flatMap((porMes) => Object.keys(porMes));
        const last = meses.sort().at(-1);
        if (last) {
          setYear(Number(last.slice(0, 4)));
        }
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const porMes of Object.values(bancada?.presenca ?? {})) {
      for (const mes of Object.keys(porMes)) {
        set.add(Number(mes.slice(0, 4)));
      }
    }
    return [...set].sort((a, b) => b - a);
  }, [bancada]);
  const pessoas = useMemo(() => bancada?.pessoas ?? [], [bancada]);
  const partidos = useMemo(() => [...new Set(pessoas.map((item) => item.partido).filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [pessoas]);
  const columns = year === "all" ? [...years].sort((a, b) => a - b).map(String) : MONTHS;

  const rows = useMemo(() => {
    const needle = normalize(query.trim());
    return pessoas
      .filter((pessoa) => partido === "all" || pessoa.partido === partido)
      .filter((pessoa) => casa === "all" || pessoa.casas.includes(casa))
      .filter((pessoa) => !needle || normalize(pessoa.nome).includes(needle))
      .map((pessoa) => {
        const porMes = bancada?.presenca[pessoa.id] ?? {};
        const cells: Array<PresencaCelula | null> =
          year === "all"
            ? columns.map((ano) => {
                const doAno = Object.entries(porMes).filter(([mes]) => mes.startsWith(`${ano}-`));
                return doAno.length ? sum(doAno.map(([, cell]) => cell)) : null;
              })
            : MONTHS.map((_, index) => porMes[`${year}-${String(index + 1).padStart(2, "0")}`] ?? null);
        const total = sum(cells);
        return { pessoa, cells, total, taxa: total[2] ? total[0] / total[2] : 0 };
      })
      .filter((row) => row.total[2] > 0)
      .sort((a, b) =>
        sort === "nome"
          ? a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR")
          : sort === "taxa"
            ? b.taxa - a.taxa || b.total[0] - a.total[0]
            : b.total[0] - a.total[0] || b.taxa - a.taxa || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR")
      );
  }, [bancada, casa, columns, partido, pessoas, query, sort, year]);

  const hotkeys = useMemo(
    () => ({
      ArrowLeft: () => setYear((current) => stepYear(years, current, 1)),
      ArrowRight: () => setYear((current) => stepYear(years, current, -1)),
      c: () => setCasa((current) => (current === "all" ? "camara" : current === "camara" ? "senado" : "all")),
      o: () => setSort((current) => (current === "faltas" ? "taxa" : current === "taxa" ? "nome" : "faltas"))
    }),
    [years]
  );
  useScreenHotkeys(hotkeys);

  if (!bancada) {
    return <EmptyState>CARREGANDO</EmptyState>;
  }

  return (
    <Screen columns="minmax(0, 1fr)" rows="minmax(0, 1fr)">
      <Panel
        title={
          <span>
            <b>Faltas em plenário</b> · bancada {doEstado(UF)} · {year === "all" ? `${years[years.length - 1]}–${years[0]}` : year}
          </span>
        }
        aside={
          <>
            <input className="yearselect w-[180px]" type="search" aria-label="Buscar parlamentar" placeholder="buscar nome" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="yearselect" aria-label="Casa" value={casa} onChange={(event) => setCasa(event.target.value as CasaSel)}>
              <option value="all">Câmara e Senado</option>
              <option value="camara">Câmara</option>
              <option value="senado">Senado</option>
            </select>
            <select className="yearselect" aria-label="Partido" value={partido} onChange={(event) => setPartido(event.target.value)}>
              <option value="all">Partidos</option>
              {partidos.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select className="yearselect" aria-label="Ano" value={year === "all" ? "all" : String(year)} onChange={(event) => setYear(event.target.value === "all" ? "all" : Number(event.target.value))}>
              <option value="all">Por ano</option>
              {years.map((item) => (
                <option key={item} value={String(item)}>
                  {item}
                </option>
              ))}
            </select>
            <select className="yearselect" aria-label="Ordem" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="faltas">Por faltas</option>
              <option value="taxa">Por faltas a cada sessão</option>
              <option value="nome">Por nome</option>
            </select>
          </>
        }
        flush
        fill
      >
        {rows.length === 0 ? (
          <EmptyState>SEM SESSÃO NESTE RECORTE</EmptyState>
        ) : (
          <table className="ruled nofx">
            <thead>
              <tr>
                <th>Parlamentar</th>
                <th>Partido</th>
                <th>Casa</th>
                {columns.map((column) => (
                  <th key={column} className="right">
                    {column}
                  </th>
                ))}
                <th className="right">Faltas</th>
                <th className="right">Sessões</th>
                <th className="right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.pessoa.id}>
                  <td className="max-w-[220px] whitespace-normal break-words">
                    {row.pessoa.autor ? (
                      <Link href={`/autores?autor=${encodeURIComponent(row.pessoa.id)}`} className="text-ink hover:underline hover:underline-offset-4">
                        {row.pessoa.nome}
                      </Link>
                    ) : (
                      <span className="text-ink">{row.pessoa.nome}</span>
                    )}
                  </td>
                  <td className="faint">{row.pessoa.partido}</td>
                  <td className="faint">{row.pessoa.casas.map((item) => CASA_LABELS[item]?.slice(0, 3)).join(", ")}</td>
                  {row.cells.map((cell, index) => (
                    <td key={index} className={`num right ${cell === null ? "faint" : ""}`} style={shade(cell)} title={cellTitle(String(columns[index]), cell)}>
                      {cell === null ? "·" : cell[0] || cell[1] ? `${cell[0]}${cell[1] ? ` (${cell[1]})` : ""}` : ""}
                    </td>
                  ))}
                  <td className="num right">
                    {formatInt(row.total[0])}
                    {row.total[1] ? <span className="faint"> ({formatInt(row.total[1])})</span> : null}
                  </td>
                  <td className="num right faint">{formatInt(row.total[2])}</td>
                  <td className="num right faint">{Math.round(row.taxa * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Screen>
  );
}

function stepYear(years: number[], current: YearSel, step: number): YearSel {
  const options: YearSel[] = ["all", ...years];
  const index = options.indexOf(current);
  return options[(index + step + options.length) % options.length];
}
