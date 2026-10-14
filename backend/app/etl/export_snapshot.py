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
from ..favorecidos import collect
from ..http import fetch_file, sha256_of
from ..parsers.favorecidos import MEMBER as FAVORECIDOS_MEMBER
from ..parsers.favorecidos import iter_zip_member as iter_favorecidos
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


class UfRun:
    """Estado de uma UF durante a leitura unica do CSV: roster, matcher, linhas e agregados."""

    def __init__(self, uf: str) -> None:
        self.ufc = config.uf_config(uf)
        self.roster = build_roster(self.ufc.sigla)
        self.matcher = Matcher(self.roster)
        self.people = self.roster.by_id()
        self.emendas: list[dict[str, Any]] = []
        self.no_author_rows_uf_dest: Counter[int] = Counter()
        self.por_autor_ano: dict[str, Any] = {}
        self.por_municipio_ano: dict[str, Any] = {}
        self.por_funcao_ano: dict[str, Any] = {}
        self.por_tipo_ano: dict[str, Any] = {}
        self.por_ano: dict[str, Any] = {}
        self.autores_usados: set[str] = set()
        self.siafi_codes_by_autor: dict[str, set[str]] = defaultdict(set)
        # (seq da linha no CSV, linha, autor, qualidade); vira emendas em finalize(), depois que
        # run_many tira as linhas que outra UF reclama com mais direito.
        self.candidates: list[tuple[int, EmendaRow, str, str]] = []
        self.dropped: Counter[str] = Counter()

    def feed(self, seq: int, r: EmendaRow) -> None:
        ufc = self.ufc
        if r.autor_codigo is None:
            if r.uf_ibge == ufc.uf_ibge_full:
                self.no_author_rows_uf_dest[r.ano] += 1
            return
        if r.autor_codigo == ufc.bancada_codigo:
            autor_id, quality = ufc.bancada_id, "bancada"
        elif r.tipo.startswith("Emenda Individual") or r.tipo.startswith("Emenda de Comiss"):
            m = self.matcher.match(r.autor_nome or "", r.ano)
            self.matcher.stats.by_quality[m.quality] += 1
            if m.autor_id is None:
                if m.quality == "collision":
                    self.matcher.stats.unmatched_names[f"{r.autor_nome} [collision]"] += 1
                return
            autor_id, quality = m.autor_id, m.quality
        else:
            return  # relator / other bancadas
        self.candidates.append((seq, r, autor_id, quality))

    def finalize(self, drop: set[int]) -> None:
        for seq, r, autor_id, quality in self.candidates:
            if seq in drop:
                self.dropped[f"{r.autor_nome} [{quality}]"] += 1
                continue
            self._keep(r, autor_id, quality)
        self.candidates = []

    def _keep(self, r: EmendaRow, autor_id: str, quality: str) -> None:
        self.autores_usados.add(autor_id)
        self.siafi_codes_by_autor[autor_id].add(r.autor_codigo)
        self.emendas.append(emenda_json(r, autor_id, quality))
        y = str(r.ano)
        _add(_agg_key(self.por_autor_ano, autor_id, y), r)
        _add(_agg_key(self.por_funcao_ano, r.funcao or "Sem informação", y), r)
        _add(_agg_key(self.por_tipo_ano, r.tipo, y), r)
        _add(_agg_key(self.por_ano, y), r)
        if r.municipio_ibge:
            mk = _agg_key(self.por_municipio_ano, r.municipio_ibge)
            mk.setdefault("nome", r.municipio)
            mk.setdefault("uf", r.uf_nome)
            _add(_agg_key(mk, "anos", y), r)

    def autores(self) -> list[dict[str, Any]]:
        ufc = self.ufc
        autores = []
        for pid in sorted(self.autores_usados):
            if pid == ufc.bancada_id:
                autores.append({"id": pid, "nome": ufc.bancada_nome, "nome_parlamentar": ufc.bancada_siafi_nome,
                                "casa": "bancada", "casas": [], "ids": {"siafi": ufc.bancada_codigo},
                                "partido_por_legislatura": {}, "legislaturas": [], "mandatos": [], "foto": None,
                                "codigos_siafi": sorted(self.siafi_codes_by_autor[pid])})
                continue
            j = self.people[pid].to_json()
            j["codigos_siafi"] = sorted(self.siafi_codes_by_autor[pid])
            autores.append(j)
        return autores


def match_by_code(runs: list[UfRun], individual: list[tuple[int, EmendaRow]]) -> None:
    """Linha individual que nenhum nome casou, mas cujo codigo SIAFI ja e de uma pessoa casada por
    nome em outras linhas (e so de uma): vai para essa pessoa, com qualidade "codigo". Cobre grafias
    que o roster nao tem ("DEP. ROSEANA SARNEY", "NELSINHO TRAD FILHO", "LUIZ DO CARMO")."""

    claimed = {seq for state in runs for seq, *_rest in state.candidates}
    owners: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for state in runs:
        for _seq, r, autor_id, quality in state.candidates:
            if quality == "strict" and r.autor_codigo:
                owners[r.autor_codigo].add((state.ufc.sigla, autor_id))
    by_uf = {state.ufc.sigla: state for state in runs}
    for seq, r in individual:
        if seq in claimed:
            continue
        owner = owners.get(r.autor_codigo or "")
        if owner and len(owner) == 1:
            sigla, autor_id = next(iter(owner))
            by_uf[sigla].candidates.append((seq, r, autor_id, "codigo"))
            by_uf[sigla].matcher.stats.by_quality["codigo"] += 1


def resolve_cross_uf(runs: list[UfRun]) -> dict[str, set[int]]:
    """Linhas que mais de uma UF reclama (so aparece com varias UFs na mesma rodada).

    1. Uma linha casada "loose" numa UF e "strict" noutra fica so com a strict (Vitor Paulo: deputado
       pelo RJ na legislatura 54 e pelo DF na 55; cada ano vai para a UF do mandato).
    2. Uma linha que duas UFs casam "strict" (dois homonimos com mandato na mesma legislatura, como
       os dois Pedro Chaves de GO e MS) fica com a UF que casa mais linhas do mesmo codigo SIAFI: o
       codigo e de uma pessoa so, e a grafia completa do nome ("PEDRO PINHEIRO CHAVES") so casa com
       ela. Empate: a UF de destino da linha.
    """

    claims: dict[int, list[tuple[str, str, EmendaRow]]] = defaultdict(list)
    for state in runs:
        for seq, r, _autor, quality in state.candidates:
            if quality in ("strict", "loose"):
                claims[seq].append((state.ufc.sigla, quality, r))
    drop: dict[str, set[int]] = defaultdict(set)
    per_code: dict[str, Counter[str]] = defaultdict(Counter)
    for seq, items in claims.items():
        if len(items) < 2:
            continue
        if any(q == "strict" for _uf, q, _r in items):
            for uf, q, _r in items:
                if q == "loose":
                    drop[uf].add(seq)
    for seq, items in claims.items():
        for uf, _q, r in items:
            if seq not in drop[uf]:
                per_code[r.autor_codigo or ""][uf] += 1
    ibge_uf = {state.ufc.uf_ibge_full: state.ufc.sigla for state in runs}
    for seq, items in claims.items():
        alive = [(uf, r) for uf, _q, r in items if seq not in drop[uf]]
        if len(alive) < 2:
            continue
        r = alive[0][1]
        counts = per_code[r.autor_codigo or ""]
        ranked = sorted(alive, key=lambda item: (counts[item[0]], ibge_uf.get(r.uf_ibge or "") == item[0]), reverse=True)
        for uf, _r in ranked[1:]:
            drop[uf].add(seq)
    return drop


def run_many(ufs: list[str], refresh: bool = False, out_paths: dict[str, Path] | None = None,
             failed: dict[str, str] | None = None) -> dict[str, dict[str, Any]]:
    """Le o zip uma vez (CSV principal e favorecidos) e escreve um snapshot por UF. Uma UF cujo roster
    falha (API da Camara ou do Senado fora do ar) entra em ``failed`` e nao derruba as outras."""

    accessed = datetime.now(timezone.utc).isoformat(timespec="seconds")
    zip_path = fetch_file(config.PORTAL_ZIP_URL, config.RAW_DIR / "EmendasParlamentares.zip", force=refresh)
    failed = failed if failed is not None else {}
    runs = []
    for uf in ufs:
        try:
            runs.append(UfRun(uf))
        except Exception as exc:  # noqa: BLE001 - qualquer falha de rede/parse do roster
            failed[config.uf_config(uf).sigla] = f"roster: {type(exc).__name__}: {exc}"[:300]
    total_rows = 0
    years: set[int] = set()
    rows_by_year_all: Counter[int] = Counter()
    individual: list[tuple[int, EmendaRow]] = []
    for seq, r in enumerate(iter_zip_member(zip_path, config.PORTAL_CSV_MEMBER)):
        total_rows += 1
        years.add(r.ano)
        rows_by_year_all[r.ano] += 1
        if r.autor_codigo is not None and r.tipo.startswith("Emenda Individual"):
            individual.append((seq, r))
        for state in runs:
            state.feed(seq, r)
    match_by_code(runs, individual)
    drops = resolve_cross_uf(runs)
    for state in runs:
        state.finalize(drops.get(state.ufc.sigla, set()))

    # Segundo membro do zip, lido uma vez: cada linha vai para a UF dona da emenda.
    autor_by_codigo = {state.ufc.sigla: {e["codigo"]: e["autor_id"] for e in state.emendas} for state in runs}
    uf_by_codigo: dict[str, list[str]] = defaultdict(list)
    for sigla, codes in autor_by_codigo.items():
        for code in codes:
            uf_by_codigo[code].append(sigla)
    fav_rows: dict[str, list[Any]] = defaultdict(list)
    for row in iter_favorecidos(zip_path, keep=set(uf_by_codigo)):
        for sigla in uf_by_codigo[row.codigo_emenda]:
            fav_rows[sigla].append(row)

    sha = sha256_of(zip_path)
    out: dict[str, dict[str, Any]] = {}
    for state in runs:
        ufc = state.ufc
        favorecidos, recebimentos, fav_stats = collect(fav_rows.pop(ufc.sigla, []), autor_by_codigo[ufc.sigla],
                                                       ufc.bancada_codigo, ufc.bancada_id)
        autores = state.autores()
        snapshot = {
            "generated_at": accessed,
            "uf": ufc.sigla,
            "years": sorted(years),
            "autores": autores,
            "roster": [p.to_json() for p in state.roster.pessoas],
            "emendas": state.emendas,
            "favorecidos": favorecidos,
            "recebimentos": recebimentos,
            "agregados": {
                "por_ano": state.por_ano,
                "por_autor_ano": state.por_autor_ano,
                "por_municipio_destino_ano": state.por_municipio_ano,
                "por_funcao_ano": state.por_funcao_ano,
                "por_tipo_ano": state.por_tipo_ano,
            },
            "sources": [
                {"name": "Portal da Transparencia - Emendas parlamentares (bulk zip)",
                 "url": config.PORTAL_ZIP_URL, "via": config.PORTAL_UNICO_URL, "accessed_at": accessed,
                 "checksum": f"sha256:{sha}", "size_bytes": zip_path.stat().st_size,
                 "rows": total_rows, "member": config.PORTAL_CSV_MEMBER},
                {"name": "Portal da Transparencia - Emendas parlamentares, pagamentos por favorecido (same zip)",
                 "url": config.PORTAL_ZIP_URL, "accessed_at": accessed, "member": FAVORECIDOS_MEMBER,
                 "rows_kept": fav_stats["rows"]},
                *[{**s, "accessed_at": accessed} for s in state.roster.sources],
            ],
            "stats": {
                "rows_total": total_rows,
                "rows_by_year_all": dict(sorted(rows_by_year_all.items())),
                "rows_uf": len(state.emendas),
                "rows_without_author_dest_uf_by_year": dict(sorted(state.no_author_rows_uf_dest.items())),
                "match_by_quality": dict(state.matcher.stats.by_quality),
                "roster_size": len(state.roster.pessoas),
                "roster_matched": len([a for a in autores if a["id"] != ufc.bancada_id]),
                "collisions": {k: sorted(v) for k, v in sorted(state.matcher.stats.collisions.items())},
                "unmatched_collision_names": dict(state.matcher.stats.unmatched_names.most_common()),
                "dropped_to_other_uf": dict(state.dropped.most_common()),
                "favorecidos": fav_stats,
            },
        }
        path = (out_paths or {}).get(ufc.sigla) or ufc.snapshot_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        out[ufc.sigla] = snapshot
    return out


def run(out_path: Path | None = None, refresh: bool = False, uf: str = config.DEFAULT_UF) -> dict[str, Any]:
    sigla = config.uf_config(uf).sigla
    return run_many([sigla], refresh, {sigla: out_path} if out_path else None)[sigla]


def parse_ufs(value: str) -> list[str]:
    """"all" -> todas na ordem do site; "RJ,SP" -> essas."""

    if value.lower() == "all":
        return list(config.UF_ORDER)
    return [config.uf_config(item.strip()).sigla for item in value.split(",") if item.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download the Portal zip")
    ap.add_argument("--uf", default=config.DEFAULT_UF, help="UF, lista separada por virgula ou 'all' (padrão RJ)")
    ap.add_argument("--out", type=Path, default=None, help="so com uma UF: padrão data/snapshot.json (RJ) ou data/snapshot-<uf>.json")
    a = ap.parse_args(argv)
    ufs = parse_ufs(a.uf)
    failed: dict[str, str] = {}
    outs = run_many(ufs, a.refresh, {ufs[0]: a.out} if a.out and len(ufs) == 1 else None, failed)
    for sigla, s in outs.items():
        _report(s, (a.out if a.out and len(ufs) == 1 else config.uf_config(sigla).snapshot_path), verbose=len(ufs) == 1)
    if failed:
        for sigla, why in failed.items():
            print(f"[{sigla}] FALHOU {why}")
        print("etl-failed:", " ".join(failed))
        return 2
    return 0


def _report(s: dict[str, Any], out: Path, verbose: bool) -> None:
    st = s["stats"]
    if not verbose:
        print(f"[{s['uf']}] linhas={st['rows_uf']} autores={len(s['autores'])} roster={st['roster_size']} casados={st['roster_matched']}"
              f" match={st['match_by_quality']} favorecidos={st['favorecidos']['favorecidos']}")
        return
    print(f"[{s['uf']}] rows total={st['rows_total']} uf={st['rows_uf']} autores={len(s['autores'])} roster={st['roster_size']}")
    print("match:", st["match_by_quality"])
    for y, v in s["agregados"]["por_ano"].items():
        print(f"{y}: n={v['n']:5d} empenhado={v['empenhado']/1e6:10.1f}M pago={v['pago']/1e6:10.1f}M rp_pago={v['rp_pago']/1e6:8.1f}M")
    fs = st["favorecidos"]
    print(f"favorecidos: rows={fs['rows']} distinct={fs['favorecidos']} emendas={fs['emendas_com_favorecido']}"
          f" total={fs['total_recebido']/1e6:.1f}M meses {fs['ano_mes_min']}..{fs['ano_mes_max']}")
    print(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
