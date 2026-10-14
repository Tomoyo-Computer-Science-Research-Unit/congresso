"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatBRL, getIpca, type Brief, type Metric, type Totais } from "@/lib/static-api";

/**
 * Dinheiro no padrão do gwern.net: o valor ajustado pela inflação é o texto principal e o nominal,
 * com o ano, fica empilhado em corpo menor ao lado. A tecla N troca para nominal puro nesta visita.
 * Fatores do IPCA (média do ano -> mês-base) vêm do snapshot.
 */

export type MoneyMode = "real" | "nominal";
const STORAGE_KEY = "em-money";
/** Abaixo disto a diferença some no arredondamento e o subscrito só atrapalha. */
const MIN_RATIO_TO_SHOW = 1.02;

const MoneyContext = createContext<{ mode: MoneyMode; toggle: () => void }>({ mode: "real", toggle: () => undefined });

export function MoneyProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<MoneyMode>("real");
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "nominal") {
        setMode("nominal");
      }
    } catch {
      // sem storage: fica no padrão
    }
  }, []);
  const toggle = useCallback(() => {
    setMode((current) => {
      const next: MoneyMode = current === "real" ? "nominal" : "real";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignora
      }
      return next;
    });
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) {
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

export function useMoneyMode(): { mode: MoneyMode; toggle: () => void; real: boolean } {
  const context = useContext(MoneyContext);
  return { ...context, real: context.mode === "real" };
}

export function factor(year: number | string): number {
  return getIpca().factors[String(year)] ?? 1;
}

export function adjust(nominal: number, year: number | string): number {
  return nominal * factor(year);
}

/** Soma de uma série anual já ajustada ano a ano; é o "total em reais de hoje". */
export function realSum(porAno: Record<string, Brief>, metric: Metric): number {
  return Object.entries(porAno).reduce((sum, [year, brief]) => sum + (brief?.[metric] ?? 0) * factor(year), 0);
}

/** Valor de um grupo num ano ou no período, nominal ou real conforme o modo. */
export function valueIn(mode: MoneyMode, porAno: Record<string, Brief>, totais: Brief | Totais, year: number | "all", metric: Metric): number {
  if (year === "all") {
    return mode === "real" ? realSum(porAno, metric) : totais[metric];
  }
  const nominal = porAno[String(year)]?.[metric] ?? 0;
  return mode === "real" ? adjust(nominal, year) : nominal;
}

export function baseMonthLabel(): string {
  const [year, month] = getIpca().base_month.split("-");
  return `${month}/${year}`;
}

/**
 * R$ no padrão gwern: ajustado em primeiro plano; nominal e ano empilhados ao lado. Para somas de
 * vários anos, `year="all"` e o subscrito diz "nominal". No modo nominal mostra só o nominal.
 */
export function Money({ nominal, year, digits, className = "" }: { nominal: number | null | undefined; year: number | string | "all"; digits?: number; className?: string }) {
  const { real } = useMoneyMode();
  if (nominal === null || nominal === undefined || !Number.isFinite(nominal)) {
    return <span className={className}>–</span>;
  }
  if (!real) {
    return <span className={className}>{formatBRL(nominal, digits)}</span>;
  }
  const adjusted = year === "all" ? NaN : adjust(nominal, year);
  if (year === "all" || !Number.isFinite(adjusted)) {
    return <span className={className}>{formatBRL(nominal, digits)}</span>;
  }
  if (nominal === 0 || adjusted / nominal < MIN_RATIO_TO_SHOW) {
    return <span className={className}>{formatBRL(adjusted, digits)}</span>;
  }
  return (
    <span className={`money ${className}`} title={`IPCA: R$ ${formatBRL(nominal, digits).replace("R$ ", "")} nominais em ${year} valem ${formatBRL(adjusted, digits)} em ${baseMonthLabel()}`}>
      {formatBRL(adjusted, digits)}
      <span className="subsup" aria-hidden="true">
        <sup>{formatBRL(nominal, digits).replace("R$ ", "")}</sup>
        <sub>{year}</sub>
      </span>
    </span>
  );
}

/** Soma de vários anos: ajustado em primeiro plano, nominal empilhado com a palavra "nominal". */
export function MoneySum({ real: realValue, nominal, digits, className = "" }: { real: number; nominal: number; digits?: number; className?: string }) {
  const { real } = useMoneyMode();
  if (!real) {
    return <span className={className}>{formatBRL(nominal, digits)}</span>;
  }
  if (nominal === 0 || realValue / nominal < MIN_RATIO_TO_SHOW) {
    return <span className={className}>{formatBRL(realValue, digits)}</span>;
  }
  return (
    <span className={`money ${className}`} title={`IPCA: R$ ${formatBRL(nominal, digits).replace("R$ ", "")} nominais valem ${formatBRL(realValue, digits)} em ${baseMonthLabel()}`}>
      {formatBRL(realValue, digits)}
      <span className="subsup" aria-hidden="true">
        <sup>{formatBRL(nominal, digits).replace("R$ ", "")}</sup>
        <sub>nominal</sub>
      </span>
    </span>
  );
}

/** Conveniência para grupos com série anual: escolhe Money ou MoneySum conforme o recorte. */
export function GroupMoney({ porAno, totais, year, metric, digits }: { porAno: Record<string, Brief>; totais: Brief | Totais; year: number | "all"; metric: Metric; digits?: number }) {
  if (year === "all") {
    return <MoneySum real={realSum(porAno, metric)} nominal={totais[metric]} digits={digits} />;
  }
  return <Money nominal={porAno[String(year)]?.[metric] ?? 0} year={year} digits={digits} />;
}
