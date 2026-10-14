"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { formatBRL } from "@/lib/static-api";

import type { ReactNode } from "react";

export type BarRow = { key: string; label: string; sub?: string; value: number; valueNode?: ReactNode; href?: string; selected?: boolean; onClick?: () => void };

/** Lista ordenada com uma barra proporcional sob cada rótulo; valor em R$ à direita. */
export function BarList({ rows, max, empty = "SEM EMENDAS" }: { rows: BarRow[]; max?: number; empty?: string }) {
  if (rows.length === 0) {
    return <EmptyState>{empty}</EmptyState>;
  }
  const top = max ?? Math.max(...rows.map((row) => row.value), 1);
  return (
    <ol className="barlist">
      {rows.map((row, index) => {
        const inner = (
          <>
            <span className="barlist__rank num">{index + 1}</span>
            <span className="barlist__label">
              <span className="whitespace-normal break-words">{row.label}</span>
              {row.sub ? <span className="barlist__sub whitespace-normal break-words">{row.sub}</span> : null}
              <span className="barlist__bar" style={{ width: `${Math.max(1, (row.value / top) * 100)}%` }} aria-hidden="true" />
            </span>
            <span className="barlist__value num">{row.valueNode ?? formatBRL(row.value)}</span>
          </>
        );
        const className = `barlist__row ${row.selected ? "is-selected" : ""}`;
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className={className}>
                {inner}
              </Link>
            ) : row.onClick ? (
              <button type="button" className={className} onClick={row.onClick} aria-pressed={row.selected}>
                {inner}
              </button>
            ) : (
              <span className={className}>{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
