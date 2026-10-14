"""Aggregate 'EmendasParlamentares_PorFavorecido.csv' for the amendments kept in the snapshot.

``collect`` streams the zip member once, keeps only rows whose amendment code is in ``autor_by_codigo``
and returns (favorecidos, recebimentos, stats). ``autor_by_codigo`` is built from the main file, so the
author id is the snapshot's (roster id or 'bancada-<uf>'), never re-matched from this file's name column.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .parsers.favorecidos import FavorecidoRow, iter_zip_member


@dataclass(slots=True)
class FavorecidoAgg:
    codigo: str
    nomes: Counter[str] = field(default_factory=Counter)
    natureza_juridica: str = "Sem informação"
    tipo: str = "Sem informação"
    uf: str | None = None
    municipio: str | None = None
    total: float = 0.0
    por_ano: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    por_autor: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    emendas: set[str] = field(default_factory=set)

    def add(self, r: FavorecidoRow, autor_id: str) -> None:
        self.nomes[r.favorecido] += 1
        if self.natureza_juridica == "Sem informação":
            self.natureza_juridica = r.natureza_juridica
        if self.tipo == "Sem informação":
            self.tipo = r.tipo
        self.uf = self.uf or r.uf
        self.municipio = self.municipio or r.municipio
        self.total += r.valor
        self.por_ano[str(r.ano)] += r.valor
        self.por_autor[autor_id] += r.valor
        self.emendas.add(r.codigo_emenda)

    def json(self) -> dict[str, Any]:
        return {
            "codigo": self.codigo,
            "nome": self.nomes.most_common(1)[0][0],
            "natureza_juridica": self.natureza_juridica,
            "tipo": self.tipo,
            "uf": self.uf,
            "municipio": self.municipio,
            "total_recebido": round(self.total, 2),
            "por_ano": {k: round(v, 2) for k, v in sorted(self.por_ano.items())},
            "por_autor": {k: round(v, 2) for k, v in sorted(self.por_autor.items(), key=lambda kv: -kv[1])},
            "n_emendas": len(self.emendas),
        }


def collect(rows: Iterable[FavorecidoRow], autor_by_codigo: dict[str, str], bancada_codigo: str = "7120",
            bancada_id: str = "bancada-rj") -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    aggs: dict[str, FavorecidoAgg] = {}
    recebimentos: list[dict[str, Any]] = []
    por_tipo: dict[str, float] = defaultdict(float)
    por_natureza: dict[str, float] = defaultdict(float)
    por_ano: dict[str, float] = defaultdict(float)
    n_por_tipo: Counter[str] = Counter()
    emendas_vistas: set[str] = set()
    autor_divergente = 0
    meses: set[str] = set()
    for r in rows:
        autor_id = autor_by_codigo[r.codigo_emenda]
        agg = aggs.get(r.favorecido_codigo)
        if agg is None:
            agg = aggs[r.favorecido_codigo] = FavorecidoAgg(r.favorecido_codigo)
        agg.add(r, autor_id)
        recebimentos.append({"codigo_emenda": r.codigo_emenda, "autor_id": autor_id, "ano_mes": r.ano_mes_iso,
                             "favorecido_codigo": r.favorecido_codigo, "valor": r.valor})
        por_tipo[r.tipo] += r.valor
        n_por_tipo[r.tipo] += 1
        por_natureza[r.natureza_juridica] += r.valor
        por_ano[str(r.ano)] += r.valor
        emendas_vistas.add(r.codigo_emenda)
        meses.add(r.ano_mes)
        if r.autor_codigo and r.autor_codigo != bancada_codigo and autor_id == bancada_id:
            autor_divergente += 1
    favorecidos = sorted((a.json() for a in aggs.values()), key=lambda f: -f["total_recebido"])
    stats = {
        "rows": len(recebimentos),
        "favorecidos": len(aggs),
        "emendas_com_favorecido": len(emendas_vistas),
        "emendas_sem_favorecido": len(set(autor_by_codigo) - emendas_vistas),
        "total_recebido": round(sum(por_ano.values()), 2),
        "por_ano": {k: round(v, 2) for k, v in sorted(por_ano.items())},
        "por_tipo": {k: {"n": n_por_tipo[k], "valor": round(v, 2)} for k, v in sorted(por_tipo.items(), key=lambda kv: -kv[1])},
        "por_natureza": {k: round(v, 2) for k, v in sorted(por_natureza.items(), key=lambda kv: -kv[1])},
        "ano_mes_min": min(meses) if meses else None,
        "ano_mes_max": max(meses) if meses else None,
        "autor_divergente": autor_divergente,
    }
    return favorecidos, recebimentos, stats


def collect_from_zip(zip_path: Path, autor_by_codigo: dict[str, str], bancada_codigo: str = "7120",
                     bancada_id: str = "bancada-rj") -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return collect(iter_zip_member(zip_path, keep=set(autor_by_codigo)), autor_by_codigo, bancada_codigo, bancada_id)
