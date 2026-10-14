"use client";

import { useEffect, useState } from "react";
import { EmptyState, Panel, Screen, Stat } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatInt, type Source } from "@/lib/static-api";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Run = { at: string; result: string; detail?: string | null; key?: string | null; duration_s?: number };
type Remote = { status: number | null; last_modified?: string | null; size_bytes?: number | null; error?: string };
type Status = {
  written_at: string | null;
  snapshot: { generated_at: string | null; latest_year: number | null; ipca_base: string | null } | null;
  last_run: Run | null;
  last_published: Run | null;
  runs: Run[];
  sources: Array<Source & { remote?: Remote }>;
  stats: Record<string, number | null>;
};

function mb(value?: number | null): string {
  return value ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB` : "–";
}

/** Última rodada no servidor, último build, arquivo do Portal e as rodadas recentes; lê o status.json escrito pelo build. */
export function StatusScreen({ generatedAt, latestYear, sources }: { generatedAt: string; latestYear: number; sources: Source[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE_PATH}/status.json`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: Status) => {
        if (alive) {
          setStatus(data);
        }
      })
      .catch(() => {
        if (alive) {
          setUnavailable(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const files = status?.sources.length ? status.sources : sources;
  const zip = files.find((source) => source.url.endsWith(".zip")) as (Source & { remote?: Remote }) | undefined;
  const lastRun = status?.last_run ?? null;
  const published = status?.last_published ?? null;

  return (
    <Screen columns="minmax(0, 1fr) 360px" rows="auto minmax(0, 1fr)">
      <Panel title={<b>Atualização</b>}>
        <div className="grid grid-cols-4 gap-x-6">
          <Stat label="Última checagem" value={lastRun ? formatDateTime(lastRun.at) : "–"} sub={lastRun ? (lastRun.detail ? `${lastRun.result} (${lastRun.detail})` : lastRun.result) : unavailable ? "status indisponível" : undefined} />
          <Stat label="Último build" value={published ? formatDateTime(published.at) : formatDateTime(generatedAt)} sub={published?.key ? `commit ${published.key.split(" ")[0]}` : undefined} />
          <Stat label="Orçamentos até" value={String(status?.snapshot?.latest_year ?? latestYear)} sub={status?.snapshot?.ipca_base ? `IPCA de ${status.snapshot.ipca_base.slice(5, 7)}/${status.snapshot.ipca_base.slice(0, 4)}` : undefined} />
          <Stat label="Próxima checagem" value="06:53" sub="todo dia, horário de Brasília" />
        </div>
      </Panel>

      <Panel title={<b>Rodadas</b>} flush fill style={{ gridRow: "1 / span 2" }}>
        {status && status.runs.length > 0 ? (
          <table className="ruled">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Resultado</th>
                <th className="right">Duração</th>
              </tr>
            </thead>
            <tbody>
              {status.runs.map((run) => (
                <tr key={run.at}>
                  <td className="num">{formatDateTime(run.at)}</td>
                  <td className={run.result === "publicado" ? "" : run.result === "sem mudança" ? "faint" : "worse"}>{run.detail ? `${run.result} (${run.detail})` : run.result}</td>
                  <td className="num right faint">{run.duration_s !== undefined ? `${run.duration_s} s` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>{unavailable ? "STATUS.JSON INDISPONÍVEL" : "SEM RODADAS REGISTRADAS"}</EmptyState>
        )}
      </Panel>

      <Panel title={<b>Arquivo do Portal da Transparência</b>} flush fill>
        <table className="ruled">
          <tbody>
            <tr>
              <td>Arquivo</td>
              <td className="right">
                {zip ? (
                  <a href={zip.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-fog underline-offset-4 hover:decoration-ink">
                    EmendasParlamentares.zip
                  </a>
                ) : (
                  "–"
                )}
              </td>
            </tr>
            <tr>
              <td>Modificado no servidor da CGU</td>
              <td className="num right">{zip?.remote?.last_modified ? formatDateTime(new Date(zip.remote.last_modified).toISOString()) : zip?.remote?.error ? "sem resposta" : "–"}</td>
            </tr>
            <tr>
              <td>Lido por último</td>
              <td className="num right">{zip?.accessed_at ? formatDateTime(zip.accessed_at) : "–"}</td>
            </tr>
            <tr>
              <td>Tamanho (lá / aqui)</td>
              <td className="num right">
                {mb(zip?.remote?.size_bytes)} / {mb(zip?.size_bytes)}
              </td>
            </tr>
            <tr>
              <td>SHA-256</td>
              <td className="right font-mono text-[10.5px] text-ash">{zip?.checksum ? zip.checksum.replace("sha256:", "").slice(0, 24) : "–"}</td>
            </tr>
            <tr>
              <td>Linhas no arquivo / da bancada</td>
              <td className="num right">
                {formatInt(status?.stats?.rows_total ?? null)} / {formatInt(status?.stats?.rows_rj ?? null)}
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </Screen>
  );
}
