"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { loadCore, setCore, type Core } from "@/lib/static-api";
import { useUf } from "@/lib/use-uf";

/**
 * Carrega o núcleo de dados da UF da página e só então renderiza a tela. As telas leem o núcleo
 * pelos getters de lib/static-api, de forma síncrona; trocar de UF remonta a tela (key).
 */
export function DataGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const uf = useUf();
  const [loaded, setLoaded] = useState<{ code: string; core: Core } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadCore(uf)
      .then((core) => {
        if (alive) {
          setLoaded({ code: uf.code, core });
        }
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      alive = false;
    };
  }, [uf]);

  if (!loaded || loaded.code !== uf.code) {
    return (
      <>
        {fallback ?? (
          <div className="grid h-full place-items-center text-[11px] tracking-[0.22em] text-ash">{error ? `DADOS INDISPONÍVEIS · ${error}` : "CARREGANDO"}</div>
        )}
      </>
    );
  }
  setCore(uf, loaded.core);
  return <Fragment key={uf.code}>{children}</Fragment>;
}
