"use client";

import { usePathname } from "next/navigation";
import { baseMonthLabel, useMoneyMode } from "@/lib/money";
import { getMeta } from "@/lib/static-api";
import { screenFromPath } from "@/lib/uf";

const HINTS: Record<string, Array<[string, string]>> = {
  "/": [
    ["←→", "ano"],
    ["m", "métrica"]
  ],
  "/autores": [
    ["↑↓", "autor"],
    ["←→", "ano"],
    ["m", "métrica"],
    ["c", "casa"]
  ],
  "/destinos": [
    ["↑↓", "município"],
    ["←→", "ano"],
    ["m", "métrica"],
    ["esc", "voltar"]
  ],
  "/funcoes": [
    ["↑↓", "função"],
    ["m", "métrica"]
  ],
  "/favorecidos": [
    ["↑↓", "favorecido"],
    ["g", "grupo"]
  ],
  "/metodologia": [],
  "/status": []
};

export function StatusBar() {
  const pathname = usePathname();
  const base = screenFromPath(pathname);
  const meta = getMeta();
  const dataDate = meta.snapshot_generated_at ? new Date(meta.snapshot_generated_at) : new Date(meta.generated_at);
  const latestLabel = `Portal da Transparência · ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(dataDate)}`;
  const hints = HINTS[base] ?? [];
  const { real } = useMoneyMode();

  return (
    <footer className="statusbar">
      <span className="flex items-center gap-4">
        {hints.map(([key, label]) => (
          <span key={key}>
            <span className="kbd">{key}</span>
            {label}
          </span>
        ))}
        <span>
          <span className="kbd">n</span>
          {real ? "nominal" : `R$ de ${baseMonthLabel()}`}
        </span>
        <span>
          <span className="kbd">1–6</span>telas
        </span>
        <span>
          <span className="kbd">t</span>tema
        </span>
        <span>
          <span className="kbd">f</span>efeitos
        </span>
      </span>
      <span className="num">
        {real ? `R$ de ${baseMonthLabel()} · ` : "R$ nominais · "}
        {latestLabel}
      </span>
    </footer>
  );
}
