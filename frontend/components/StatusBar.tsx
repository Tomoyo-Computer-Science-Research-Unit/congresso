"use client";

import { usePathname } from "next/navigation";

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
  "/metodologia": []
};

export function StatusBar({ latestLabel }: { latestLabel: string }) {
  const pathname = usePathname();
  const base = pathname.replace(/\/+$/, "") || "/";
  const hints = HINTS[base] ?? [];

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
          <span className="kbd">1–5</span>telas
        </span>
        <span>
          <span className="kbd">t</span>tema
        </span>
        <span>
          <span className="kbd">f</span>efeitos
        </span>
      </span>
      <span className="num">{latestLabel}</span>
    </footer>
  );
}
