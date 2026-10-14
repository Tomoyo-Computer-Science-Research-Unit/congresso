"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { EmptyState, Panel, Screen, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { Money, MoneySum, adjust, useMoneyMode } from "@/lib/money";
import {
  BB_CODIGO,
  displayName,
  formatInt,
  getAutor,
  getAutores,
  getFavorecidos,
  getYears,
  loadRecebimentos,
  niceName,
  type Favorecido,
  type Recebimento
} from "@/lib/static-api";

type Grupo = "todos" | "publico" | "terceiro" | "empresa" | "outros";
const GRUPOS: Array<{ value: Grupo; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "publico", label: "Poder público" },
  { value: "terceiro", label: "Associações" },
  { value: "empresa", label: "Empresas" },
  { value: "outros", label: "Outros" }
];

/** Agrupa a natureza jurídica do Portal em quatro famílias legíveis. */
export function grupoDe(favorecido: Favorecido): Grupo {
  const natureza = (favorecido.natureza_juridica ?? "").toLowerCase();
  if (favorecido.codigo === BB_CODIGO) {
    return "publico";
  }
  if (/fundo|munic[ií]pio|estado|órgão|orgao|autarquia|funda[çc][ãa]o p[úu]blica|empresa p[úu]blica|unidade gestora|consórcio|consorcio/.test(natureza)) {
    return "publico";
  }
  if (/associa[çc][ãa]o|funda[çc][ãa]o privada|organiza[çc][ãa]o religiosa|organiza[çc][ãa]o social|servi[çc]o social/.test(natureza)) {
    return "terceiro";
  }
  if (/sociedade|empres[áa]rio|ltda|s\.a\.|eireli|cooperativa|economia mista/.test(natureza)) {
    return "empresa";
  }
  return "outros";
}

function realTotal(favorecido: Favorecido): number {
  return Object.entries(favorecido.por_ano).reduce((sum, [year, value]) => sum + adjust(value, year), 0);
}

export function FavorecidosExplorer() {
  const all = getFavorecidos();
  const years = getYears();
  const { real } = useMoneyMode();
  const autores = useMemo(() => new Map(getAutores().map((autor) => [autor.id, autor])), []);
  const [grupo, setGrupo] = useState<Grupo>("todos");
  const [selectedSlug, setSelectedSlug] = useState(all[0]?.slug ?? "");
  const [rows, setRows] = useState<Recebimento[] | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("f");
    if (slug && all.some((item) => item.slug === slug)) {
      setSelectedSlug(slug);
    }
    setHydrated(true);
  }, [all]);
  useEffect(() => {
    if (hydrated) {
      window.history.replaceState(null, "", `${window.location.pathname}?f=${encodeURIComponent(selectedSlug)}`);
    }
  }, [hydrated, selectedSlug]);

  const list = useMemo(
    () =>
      all
        .filter((item) => grupo === "todos" || grupoDe(item) === grupo || item.slug === selectedSlug)
        .map((item) => ({ item, value: real ? realTotal(item) : item.total }))
        .sort((a, b) => b.value - a.value),
    [all, grupo, real, selectedSlug]
  );
  const selected = all.find((item) => item.slug === selectedSlug) ?? all[0];
  const index = Math.max(0, list.findIndex((row) => row.item.slug === selected?.slug));

  useEffect(() => {
    let alive = true;
    setRows(null);
    if (!selected) {
      return;
    }
    loadRecebimentos(selected.slug).then((data) => {
      if (alive) {
        setRows(data);
      }
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  const points = useMemo(() => {
    if (!selected) {
      return [];
    }
    const allYears = [...new Set([...years, ...Object.keys(selected.por_ano).map(Number)])].sort();
    return allYears.map((year) => {
      const nominal = selected.por_ano[String(year)] ?? 0;
      const value = real ? adjust(nominal, year) : nominal;
      return { year, empenhado: value, pago_total: value, n: 0 };
    });
  }, [real, selected, years]);
  const nominalByYear = useMemo(() => (selected ? Object.fromEntries(Object.entries(selected.por_ano).map(([year, value]) => [Number(year), { empenhado: value, pago_total: value }])) : {}), [selected]);
  const porAutor = useMemo(() => {
    const totals = new Map<string, { nominal: number; real: number }>();
    for (const row of rows ?? []) {
      const year = Number(row.am.slice(0, 4));
      const current = totals.get(row.au) ?? { nominal: 0, real: 0 };
      current.nominal += row.v;
      current.real += adjust(row.v, year);
      totals.set(row.au, current);
    }
    return [...totals.entries()].sort((a, b) => (real ? b[1].real - a[1].real : b[1].nominal - a[1].nominal)).slice(0, 10);
  }, [real, rows]);

  const hotkeys = useMemo(
    () => ({
      ArrowUp: () => setSelectedSlug(list[(index - 1 + list.length) % list.length]?.item.slug ?? selectedSlug),
      ArrowDown: () => setSelectedSlug(list[(index + 1) % list.length]?.item.slug ?? selectedSlug),
      g: () => setGrupo((current) => GRUPOS[(GRUPOS.findIndex((item) => item.value === current) + 1) % GRUPOS.length].value)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, list, selectedSlug]
  );
  useScreenHotkeys(hotkeys);

  if (!selected) {
    return <EmptyState>SEM FAVORECIDOS</EmptyState>;
  }
  const anos = Object.keys(selected.por_ano).map(Number);

  return (
    <Screen columns="360px minmax(0, 1fr) minmax(0, 1fr)" rows="auto minmax(0, 1fr) minmax(0, 1.2fr)">
      <Panel
        title={<b>Favorecidos</b>}
        aside={
          <select className="yearselect" aria-label="Grupo" value={grupo} onChange={(event) => setGrupo(event.target.value as Grupo)}>
            {GRUPOS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        }
        flush
        fill
        style={{ gridRow: "1 / span 3" }}
      >
        <ul className="menu" role="listbox" aria-label="Favorecidos">
          {list.map(({ item, value }) => (
            <li key={item.slug} role="presentation">
              <button type="button" role="option" aria-selected={item.slug === selected.slug} onClick={() => setSelectedSlug(item.slug)}>
                <span className="whitespace-normal break-words">
                  {niceName(item.nome)}
                  <span className="faint ml-1.5 text-[10px] tracking-[0.08em]">{item.municipio ? niceName(item.municipio) : item.uf}</span>
                </span>
                <span className="num">
                  <MoneySum real={value} nominal={item.total} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title={
          <span>
            <b className="serif text-[16px]">{niceName(selected.nome)}</b>
            <span className="mt-0.5 block text-[10.5px] tracking-[0.12em] text-ash">
              {[selected.natureza_juridica, selected.tipo, [selected.municipio ? niceName(selected.municipio) : null, selected.uf].filter(Boolean).join(", "), selected.codigo.length === 14 ? `CNPJ ${selected.codigo}` : selected.codigo]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        }
        style={{ gridColumn: "2 / span 2" }}
      >
        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6">
          <div>
            <Stat label="Recebido" value={<MoneySum real={realTotal(selected)} nominal={selected.total} />} />
            <Stat label="Autores das emendas" value={formatInt(selected.n_autores)} />
            <Stat label="Emendas" value={formatInt(selected.n_emendas)} />
            <Stat label="Anos com pagamento" value={anos.length ? `${Math.min(...anos)}–${Math.max(...anos)}` : "–"} />
          </div>
          <YearBars points={points} metric="pago_total" single labels={{ pago_total: "Recebido" }} height={170} nominal={real ? nominalByYear : undefined} />
        </div>
      </Panel>

      <Panel title={<b>Por autor</b>} flush fill style={{ gridColumn: "2 / span 2" }}>
        {!rows ? (
          <EmptyState>CARREGANDO</EmptyState>
        ) : (
          <BarList
            rows={porAutor.map(([autorId, value]) => {
              const autor = autores.get(autorId);
              return {
                key: autorId,
                label: autor ? displayName(autor) : autorId,
                sub: autor ? [autor.partido, autor.casa].filter(Boolean).join(" · ") : undefined,
                value: real ? value.real : value.nominal,
                valueNode: <MoneySum real={value.real} nominal={value.nominal} />,
                href: `/autores?autor=${encodeURIComponent(autorId)}`
              };
            })}
            empty="SEM DETALHE PARA ESTE FAVORECIDO"
          />
        )}
      </Panel>

      <Panel title={<b>Pagamentos</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">{rows ? `${formatInt(rows.length)} linhas` : ""}</span>} flush fill style={{ gridColumn: "2 / span 2" }}>
        {!rows ? (
          <EmptyState>CARREGANDO</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>SEM DETALHE PARA ESTE FAVORECIDO</EmptyState>
        ) : (
          <table className="ruled">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Emenda</th>
                <th>Autor</th>
                <th>Município da emenda</th>
                <th className="right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((row, position) => {
                const autor = getAutor(row.au);
                return (
                  <tr key={`${row.c}-${row.am}-${position}`}>
                    <td className="num">{`${row.am.slice(5, 7)}/${row.am.slice(0, 4)}`}</td>
                    <td className="num faint">{row.c}</td>
                    <td className="max-w-[220px] whitespace-normal break-words">
                      <Link href={`/autores?autor=${encodeURIComponent(row.au)}`} className="text-ink hover:underline hover:underline-offset-4">
                        {autor ? displayName(autor) : row.au}
                      </Link>
                    </td>
                    <td className="faint">{row.mn ?? "–"}</td>
                    <td className="num right">
                      <Money nominal={row.v} year={Number(row.am.slice(0, 4))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </Screen>
  );
}
