"""Run the whole ETL and write data/snapshot.json.

    python -m app.etl.export_snapshot                    # RJ, uses cached downloads when present
    python -m app.etl.export_snapshot --refresh          # re-download the Portal zip
    python -m app.etl.export_snapshot --uf SP            # São Paulo -> data/snapshot-sp.json

The Portal zip is national: one download serves every UF. Run the first UF with --refresh and
the others without it so the same file is read again instead of fetched twice.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import config
from ..favorecidos import collect_from_zip
from ..http import fetch_file, sha256_of
from ..parsers.favorecidos import MEMBER as FAVORECIDOS_MEMBER
from ..match import Matcher
from ..parsers.emendas import EmendaRow, iter_zip_member
from ..roster import build_roster

def _agg_key(d: dict[str, Any], *keys: str) -> dict[str, Any]:
    for k in keys:
        d = d.setdefault(k, {})
    return d


def _add(bucket: dict[str, Any], r: EmendaRow) -> None:
    bucket["n"] = bucket.get("n", 0) + 1
    for k, v in (("empenhado", r.valor_empenhado), ("liquidado", r.valor_liquidado), ("pago", r.valor_pago),
                 ("rp_inscrito", r.rp_inscrito), ("rp_pago", r.rp_pago)):
        bucket[k] = round(bucket.get(k, 0.0) + v, 2)


def emenda_json(r: EmendaRow, autor_id: str | None, quality: str) -> dict[str, Any]:
    return {
        "codigo": r.codigo, "ano": r.ano, "tipo": r.tipo, "numero": r.numero,
        "autor_id": autor_id, "autor_codigo_siafi": r.autor_codigo, "autor_nome": r.autor_nome,
        "match": quality,
        "localidade": r.localidade_tipo, "localidade_raw": r.localidade_raw,
        "uf_destino": r.uf_nome, "uf_destino_ibge": r.uf_ibge,
        "municipio_destino": r.municipio, "municipio_destino_ibge": r.municipio_ibge,
        "funcao": r.funcao, "funcao_cod": r.funcao_cod, "subfuncao": r.subfuncao, "subfuncao_cod": r.subfuncao_cod,
        "programa": r.programa, "programa_cod": r.programa_cod, "acao": r.acao, "acao_cod": r.acao_cod,
        "plano_orcamentario": r.plano_orc,
        "valor_empenhado": r.valor_empenhado, "valor_liquidado": r.valor_liquidado, "valor_pago": r.valor_pago,
        "rp_inscrito": r.rp_inscrito, "rp_cancelado": r.rp_cancelado, "rp_pago": r.rp_pago,
    }


def run(out_path: Path | None = None, refresh: bool = False, uf: str = config.DEFAULT_UF) -> dict[str, Any]:
    ufc = config.uf_config(uf)
    out_path = out_path or ufc.snapshot_path
    accessed = datetime.now(timezone.utc).isoformat(timespec="seconds")
    zip_path = fetch_file(config.PORTAL_ZIP_URL, config.RAW_DIR / "EmendasParlamentares.zip", force=refresh)
    roster = build_roster(ufc.sigla)
    matcher = Matcher(roster)
    people = roster.by_id()

    emendas: list[dict[str, Any]] = []
    total_rows = 0
    years: set[int] = set()
    rows_by_year_all: Counter[int] = Counter()
    no_author_rows_uf_dest: Counter[int] = Counter()
    por_autor_ano: dict[str, Any] = {}
    por_municipio_ano: dict[str, Any] = {}
    por_funcao_ano: dict[str, Any] = {}
    por_tipo_ano: dict[str, Any] = {}
    por_ano: dict[str, Any] = {}
    autores_usados: set[str] = set()
    siafi_codes_by_autor: dict[str, set[str]] = defaultdict(set)

    for r in iter_zip_member(zip_path, config.PORTAL_CSV_MEMBER):
        total_rows += 1
        years.add(r.ano)
        rows_by_year_all[r.ano] += 1
        if r.autor_codigo is None:
            if r.uf_ibge == ufc.uf_ibge_full:
                no_author_rows_uf_dest[r.ano] += 1
            continue
        if r.autor_codigo == ufc.bancada_codigo:
            autor_id, quality = ufc.bancada_id, "bancada"
        elif r.tipo.startswith("Emenda Individual") or r.tipo.startswith("Emenda de Comiss"):
            m = matcher.match(r.autor_nome or "", r.ano)
            matcher.stats.by_quality[m.quality] += 1
            if m.autor_id is None:
                if m.quality == "collision":
                    matcher.stats.unmatched_names[f"{r.autor_nome} [collision]"] += 1
                continue
            autor_id, quality = m.autor_id, m.quality
        else:
            continue  # relator / other bancadas
        autores_usados.add(autor_id)
        siafi_codes_by_autor[autor_id].add(r.autor_codigo)
        emendas.append(emenda_json(r, autor_id, quality))
        y = str(r.ano)
        _add(_agg_key(por_autor_ano, autor_id, y), r)
        _add(_agg_key(por_funcao_ano, r.funcao or "Sem informação", y), r)
        _add(_agg_key(por_tipo_ano, r.tipo, y), r)
        _add(_agg_key(por_ano, y), r)
        if r.municipio_ibge:
            mk = _agg_key(por_municipio_ano, r.municipio_ibge)
            mk.setdefault("nome", r.municipio)
            mk.setdefault("uf", r.uf_nome)
            _add(_agg_key(mk, "anos", y), r)

    autores = []
    for pid in sorted(autores_usados):
        if pid == ufc.bancada_id:
            autores.append({"id": pid, "nome": ufc.bancada_nome, "nome_parlamentar": ufc.bancada_siafi_nome,
                            "casa": "bancada", "casas": [], "ids": {"siafi": ufc.bancada_codigo},
                            "partido_por_legislatura": {}, "legislaturas": [], "mandatos": [], "foto": None,
                            "codigos_siafi": sorted(siafi_codes_by_autor[pid])})
            continue
        j = people[pid].to_json()
        j["codigos_siafi"] = sorted(siafi_codes_by_autor[pid])
        autores.append(j)
    roster_all = [p.to_json() for p in roster.pessoas]

    # Second member of the zip: payments by favorecido, only for the amendments kept above.
    autor_by_codigo = {e["codigo"]: e["autor_id"] for e in emendas}
    favorecidos, recebimentos, fav_stats = collect_from_zip(zip_path, autor_by_codigo, ufc.bancada_codigo, ufc.bancada_id)

    snapshot = {
        "generated_at": accessed,
        "uf": ufc.sigla,
        "years": sorted(years),
        "autores": autores,
        "roster": roster_all,
        "emendas": emendas,
        "favorecidos": favorecidos,
        "recebimentos": recebimentos,
        "agregados": {
            "por_ano": por_ano,
            "por_autor_ano": por_autor_ano,
            "por_municipio_destino_ano": por_municipio_ano,
            "por_funcao_ano": por_funcao_ano,
            "por_tipo_ano": por_tipo_ano,
        },
        "sources": [
            {"name": "Portal da Transparencia - Emendas parlamentares (bulk zip)",
             "url": config.PORTAL_ZIP_URL, "via": config.PORTAL_UNICO_URL, "accessed_at": accessed,
             "checksum": f"sha256:{sha256_of(zip_path)}", "size_bytes": zip_path.stat().st_size,
             "rows": total_rows, "member": config.PORTAL_CSV_MEMBER},
            {"name": "Portal da Transparencia - Emendas parlamentares, pagamentos por favorecido (same zip)",
             "url": config.PORTAL_ZIP_URL, "accessed_at": accessed, "member": FAVORECIDOS_MEMBER,
             "rows_kept": fav_stats["rows"]},
            *[{**s, "accessed_at": accessed} for s in roster.sources],
        ],
        "stats": {
            "rows_total": total_rows,
            "rows_by_year_all": dict(sorted(rows_by_year_all.items())),
            "rows_uf": len(emendas),
            "rows_without_author_dest_uf_by_year": dict(sorted(no_author_rows_uf_dest.items())),
            "match_by_quality": dict(matcher.stats.by_quality),
            "roster_size": len(roster.pessoas),
            "roster_matched": len([a for a in autores if a["id"] != ufc.bancada_id]),
            "collisions": {k: sorted(v) for k, v in sorted(matcher.stats.collisions.items())},
            "unmatched_collision_names": dict(matcher.stats.unmatched_names.most_common()),
            "favorecidos": fav_stats,
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return snapshot


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download the Portal zip")
    ap.add_argument("--uf", default=config.DEFAULT_UF, choices=sorted(config.UFS), help="UF da bancada (padrão RJ)")
    ap.add_argument("--out", type=Path, default=None, help="padrão: data/snapshot.json (RJ) ou data/snapshot-<uf>.json")
    a = ap.parse_args(argv)
    out = a.out or config.uf_config(a.uf).snapshot_path
    s = run(out, a.refresh, a.uf)
    st = s["stats"]
    print(f"[{s['uf']}] rows total={st['rows_total']} uf={st['rows_uf']} autores={len(s['autores'])} roster={st['roster_size']}")
    print("match:", st["match_by_quality"])
    for y, v in s["agregados"]["por_ano"].items():
        print(f"{y}: n={v['n']:5d} empenhado={v['empenhado']/1e6:10.1f}M pago={v['pago']/1e6:10.1f}M rp_pago={v['rp_pago']/1e6:8.1f}M")
    fs = st["favorecidos"]
    print(f"favorecidos: rows={fs['rows']} distinct={fs['favorecidos']} emendas={fs['emendas_com_favorecido']}"
          f" total={fs['total_recebido']/1e6:.1f}M meses {fs['ano_mes_min']}..{fs['ano_mes_max']}")
    print(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
