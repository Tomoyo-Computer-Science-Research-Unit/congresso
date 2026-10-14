"""Gera os arquivos estaticos do frontend a partir de ``data/snapshot.json``.

Em ``frontend/lib``:

* ``static-data.generated.json``: anos, autores com totais e series anuais, destinos (municipios
  do RJ com populacao), funcoes, agregados e fontes. Tudo que as telas mostram sem clicar.
* ``static-autores/<autor_id>.generated.json``: as emendas (linhas) de um autor.
* ``static-destinos/<ibge>.generated.json``: as emendas destinadas a um municipio.
* ``static-geo.generated.json``: geometrias dos municipios do RJ (malha do IBGE), so para o mapa.
* ``static-favorecidos/<slug>.generated.json``: os recebimentos (pagamentos mes a mes) de um favorecido,
  so para os favorecidos que alguma lista do site alcanca (top 300 geral, top 8 por autor e por
  destino) ou que receberam >= R$ 1 mi.

Valores em reais nominais, por ano orcamentario da emenda. ``pago_total`` = pago no ano +
restos a pagar pagos depois: o que de fato chegou ao destino ate a data do arquivo. ``ipca`` traz
os fatores de correcao (IBGE/SIDRA) para o frontend multiplicar quando quiser reais de hoje.

    python -m app.etl.export_static_frontend
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import config, ipca
from ..http import fetch_file
from ..parsers.favorecidos import slug as favorecido_slug

FRONTEND_LIB = config.ROOT / "frontend" / "lib"
IBGE_RJ_MUNICIPALITIES_GEOJSON_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/33"
    "?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio"
)
IBGE_POPULATION_2022_URL = "https://apisidra.ibge.gov.br/values/t/4714/n6/in%20n3%2033/v/93/p/2022"
GEO_PRECISION = 4  # ~10 m; de sobra para um coropletico do estado
TOP = 8
TOP_FAVORECIDOS = 300
FAVORECIDO_DETALHE_MIN = 1_000_000.0  # favorecidos acima disso sempre ganham arquivo lazy

TIPO_CODES = {
    "Emenda Individual - Transferências com Finalidade Definida": "FD",
    "Emenda Individual - Transferências Especiais": "TE",
    "Emenda de Bancada": "BC",
}
UF_SIGLAS = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
    "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
    "41": "PR", "42": "SC", "43": "RS",
    "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}
SMALL_WORDS = {"de", "da", "do", "das", "dos", "e", "d"}
SEM_FUNCAO = "Sem função informada"
OUTROS_DESTINOS = {
    "uf": "Estado do Rio de Janeiro, sem município",
    "multiplo": "Vários municípios",
    "nacional": "Nacional",
    "exterior": "Exterior",
    "outro": "Região",
    "outras_ufs": "Outros estados",
}
VALUE_KEYS = ("empenhado", "liquidado", "pago", "rp_pago")


def title_case(name: str) -> str:
    """ITABORAÍ -> Itaboraí; SÃO JOÃO DE MERITI -> São João de Meriti; D'AVILA fica D'Avila."""

    words = []
    for index, word in enumerate(name.lower().split()):
        if index and word in SMALL_WORDS:
            words.append(word)
        else:
            words.append("-".join(part[:1].upper() + part[1:] for part in word.split("-")))
            words[-1] = "'".join(part[:1].upper() + part[1:] for part in words[-1].split("'"))
    return " ".join(words)


def strip_accents(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")


class Totals:
    """Soma de n, empenhado, liquidado, pago, rp_pago e emendas distintas."""

    def __init__(self) -> None:
        self.n = 0
        self.codigos: set[str] = set()
        self.values = {key: 0.0 for key in VALUE_KEYS}
        # empenhado e pago_total por ano, para o frontend deflacionar ano a ano (IPCA).
        self.por_ano: dict[int, list[float]] = {}

    def add(self, row: dict[str, Any]) -> None:
        self.n += 1
        self.codigos.add(row["codigo"])
        self.values["empenhado"] += row["valor_empenhado"]
        self.values["liquidado"] += row["valor_liquidado"]
        self.values["pago"] += row["valor_pago"]
        self.values["rp_pago"] += row["rp_pago"]
        year = self.por_ano.setdefault(int(row["ano"]), [0.0, 0.0])
        year[0] += row["valor_empenhado"]
        year[1] += row["valor_pago"] + row["rp_pago"]

    def json(self) -> dict[str, Any]:
        return {
            "n": self.n,
            "emendas": len(self.codigos),
            **{key: round(value, 2) for key, value in self.values.items()},
            "pago_total": round(self.values["pago"] + self.values["rp_pago"], 2),
        }

    def brief(self) -> dict[str, Any]:
        """So o que as listas e as series anuais mostram: n, empenhado e pago_total."""

        return {
            "n": self.n,
            "empenhado": round(self.values["empenhado"], 2),
            "pago_total": round(self.values["pago"] + self.values["rp_pago"], 2),
        }

    def ranked(self) -> dict[str, Any]:
        """brief() mais a quebra anual, para listas em que o frontend soma anos deflacionados."""

        return {
            **self.brief(),
            "por_ano": {str(year): {"empenhado": round(pair[0], 2), "pago_total": round(pair[1], 2)} for year, pair in sorted(self.por_ano.items())},
        }


class Group:
    """Totais gerais + por ano + rankings de autores, destinos e funcoes."""

    def __init__(self) -> None:
        self.total = Totals()
        self.por_ano: dict[int, Totals] = defaultdict(Totals)
        self.autores: dict[str, Totals] = defaultdict(Totals)
        self.destinos: dict[str, Totals] = defaultdict(Totals)
        self.funcoes: dict[str, Totals] = defaultdict(Totals)
        self.tipos: dict[str, Totals] = defaultdict(Totals)

    def add(self, row: dict[str, Any]) -> None:
        self.total.add(row)
        self.por_ano[row["ano"]].add(row)
        self.autores[row["autor_id"]].add(row)
        if row["municipio_destino_ibge"]:
            self.destinos[row["municipio_destino_ibge"]].add(row)
        self.funcoes[row["funcao"] or SEM_FUNCAO].add(row)
        self.tipos[TIPO_CODES.get(row["tipo"], "??")].add(row)


def top(items: dict[str, Totals], label: dict[str, Any] | None = None, limit: int = TOP) -> list[dict[str, Any]]:
    ranked = sorted(items.items(), key=lambda pair: pair[1].values["empenhado"], reverse=True)[:limit]
    return [{"id": key, **(label or {}).get(key, {}), **totals.ranked()} for key, totals in ranked]


def compact(row: dict[str, Any]) -> dict[str, Any]:
    uf_code = str(row.get("uf_destino_ibge") or "")[:2]
    return {
        "c": row["codigo"],
        "a": row["ano"],
        "n": row["numero"],
        "t": TIPO_CODES.get(row["tipo"], "??"),
        "au": row["autor_id"],
        "loc": row["localidade"],
        "m": row["municipio_destino_ibge"] or None,
        "mn": title_case(row["municipio_destino"]) if row["municipio_destino"] else None,
        "uf": UF_SIGLAS.get(uf_code),
        "f": row["funcao"] or SEM_FUNCAO,
        "sf": row["subfuncao"],
        "ac": row["acao"],
        "e": row["valor_empenhado"],
        "p": row["valor_pago"],
        "rp": row["rp_pago"],
    }


# --- Favorecidos ---------------------------------------------------------------------------


MUNICIPIO_ALIASES = {"TRAJANO DE MORAIS": "TRAJANO DE MORAES"}  # grafia do SIAFI -> grafia do IBGE


def municipio_key(name: str | None) -> str:
    key = strip_accents(name or "").upper().strip()
    return MUNICIPIO_ALIASES.get(key, key)


def favorecido_brief(fav: dict[str, Any]) -> dict[str, Any]:
    return {
        "codigo": fav["codigo"],
        "slug": favorecido_slug(fav["codigo"]),
        "nome": fav["nome"],
        "natureza_juridica": fav["natureza_juridica"],
        "tipo": fav["tipo"],
        "uf": fav["uf"],
        "municipio": title_case(fav["municipio"]) if fav["municipio"] else None,
        "total": fav["total_recebido"],
        "por_ano": fav["por_ano"],
        "n_autores": len(fav["por_autor"]),
        "n_emendas": fav["n_emendas"],
    }


def top_favorecidos(valores: dict[str, dict[str, float]], fav_by_codigo: dict[str, dict[str, Any]], limit: int = TOP) -> list[dict[str, Any]]:
    """Top por valor recebido; ``por_ano`` e por ano de pagamento, para o filtro de ano do site."""

    ranked = sorted(valores.items(), key=lambda pair: sum(pair[1].values()), reverse=True)[:limit]
    out = []
    for codigo, anos in ranked:
        fav = fav_by_codigo[codigo]
        out.append({"codigo": codigo, "slug": favorecido_slug(codigo), "nome": fav["nome"], "tipo": fav["tipo"],
                    "valor": round(sum(anos.values()), 2),
                    "por_ano": {year: round(valor, 2) for year, valor in sorted(anos.items())}})
    return out


def favorecidos_section(snapshot: dict[str, Any], ibge_names: dict[str, str],
                        municipio_destino: dict[str, str | None]) -> dict[str, Any]:
    """Tudo que o site mostra sobre favorecidos: top geral, agregados, top por autor e por municipio
    (favorecidos sediados no municipio), e as linhas dos arquivos lazy."""

    favorecidos: list[dict[str, Any]] = snapshot.get("favorecidos", [])
    recebimentos: list[dict[str, Any]] = snapshot.get("recebimentos", [])
    fav_by_codigo = {fav["codigo"]: fav for fav in favorecidos}

    por_tipo: dict[str, dict[str, Any]] = defaultdict(lambda: {"n_favorecidos": 0, "n_recebimentos": 0, "valor": 0.0})
    por_natureza: dict[str, dict[str, Any]] = defaultdict(lambda: {"n_favorecidos": 0, "n_recebimentos": 0, "valor": 0.0})
    for fav in favorecidos:
        for bucket in (por_tipo[fav["tipo"]], por_natureza[fav["natureza_juridica"]]):
            bucket["n_favorecidos"] += 1
            bucket["valor"] += fav["total_recebido"]

    ibge_by_name = {municipio_key(name): code for code, name in ibge_names.items()}
    por_autor: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    por_destino: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    linhas: dict[str, list[dict[str, Any]]] = defaultdict(list)
    municipios_sem_ibge: dict[str, float] = defaultdict(float)
    for rec in recebimentos:
        codigo = rec["favorecido_codigo"]
        fav = fav_by_codigo[codigo]
        for bucket in (por_tipo[fav["tipo"]], por_natureza[fav["natureza_juridica"]]):
            bucket["n_recebimentos"] += 1
        year = str(rec["ano_mes"])[:4]
        por_autor[rec["autor_id"]][codigo][year] += rec["valor"]
        if fav["uf"] == "RJ" and fav["municipio"]:
            ibge = ibge_by_name.get(municipio_key(fav["municipio"]))
            if ibge:
                por_destino[ibge][codigo][year] += rec["valor"]
            else:
                municipios_sem_ibge[fav["municipio"]] += rec["valor"]
        linhas[codigo].append({"c": rec["codigo_emenda"], "au": rec["autor_id"], "am": rec["ano_mes"],
                               "v": rec["valor"], "mn": municipio_destino.get(rec["codigo_emenda"])})

    top = [favorecido_brief(fav) for fav in favorecidos[:TOP_FAVORECIDOS]]
    autores = {autor_id: top_favorecidos(valores, fav_by_codigo) for autor_id, valores in por_autor.items()}
    destinos = {ibge: top_favorecidos(valores, fav_by_codigo) for ibge, valores in por_destino.items()}

    com_detalhe = {fav["codigo"] for fav in top}
    com_detalhe.update(fav["codigo"] for fav in favorecidos if fav["total_recebido"] >= FAVORECIDO_DETALHE_MIN)
    for lista in (*autores.values(), *destinos.values()):
        com_detalhe.update(item["codigo"] for item in lista)
    arquivos = {favorecido_slug(codigo): linhas[codigo] for codigo in com_detalhe}

    def rounded(buckets: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        return {key: {**b, "valor": round(b["valor"], 2)}
                for key, b in sorted(buckets.items(), key=lambda kv: kv[1]["valor"], reverse=True)}

    return {
        "top": top,
        "por_tipo": rounded(por_tipo),
        "por_natureza": rounded(por_natureza),
        "autores": autores,
        "destinos": destinos,
        "arquivos": arquivos,
        "stats": {
            "favorecidos": len(favorecidos),
            "recebimentos": len(recebimentos),
            "total_recebido": round(sum(fav["total_recebido"] for fav in favorecidos), 2),
            "com_detalhe": len(arquivos),
            "municipios_rj_sem_ibge": {k: round(v, 2) for k, v in sorted(municipios_sem_ibge.items(), key=lambda kv: -kv[1])},
        },
    }


# --- IBGE ----------------------------------------------------------------------------------


def population_2022() -> dict[str, dict[str, Any]]:
    """{ibge: {nome, populacao}} para os municipios do RJ (Censo 2022, SIDRA 4714)."""

    path = fetch_file(IBGE_POPULATION_2022_URL, config.RAW_DIR / "ibge" / "population_rj_2022.json")
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    output: dict[str, dict[str, Any]] = {}
    for row in rows[1:]:
        code = str(row.get("D1C") or "")
        name = re.sub(r"\s*(\(RJ\)|-\s*RJ)\s*$", "", str(row.get("D1N") or ""))
        value = str(row.get("V") or "")
        if code and value.replace(".", "").isdigit():
            output[code] = {"nome": name, "populacao": int(float(value))}
    return output


def municipality_geometries(names: dict[str, str]) -> dict[str, Any]:
    path = fetch_file(IBGE_RJ_MUNICIPALITIES_GEOJSON_URL, config.RAW_DIR / "ibge" / "rj_municipalities_min.geojson")
    collection = json.loads(Path(path).read_text(encoding="utf-8"))
    features = []
    for feature in collection.get("features", []):
        code = str((feature.get("properties") or {}).get("codarea") or "")
        if not code:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": _round(feature.get("geometry")),
                "properties": {"ibge": code, "nome": names.get(code, code)},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _round(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, GEO_PRECISION)
    if isinstance(value, list):
        return [_round(item) for item in value]
    if isinstance(value, dict):
        return {key: _round(item) for key, item in value.items()}
    return value


# --- Export --------------------------------------------------------------------------------


def export(snapshot_path: Path = config.SNAPSHOT_PATH, out_dir: Path = FRONTEND_LIB) -> dict[str, Any]:
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = snapshot["emendas"]
    autores_meta = {autor["id"]: autor for autor in snapshot["autores"]}
    population = population_2022()
    names = {code: info["nome"] for code, info in population.items()}

    overall = Group()
    por_autor: dict[str, Group] = defaultdict(Group)
    por_destino: dict[str, Group] = defaultdict(Group)
    por_funcao: dict[str, Group] = defaultdict(Group)
    linhas_autor: dict[str, list[dict[str, Any]]] = defaultdict(list)
    linhas_destino: dict[str, list[dict[str, Any]]] = defaultdict(list)
    outros_destinos: dict[str, Group] = defaultdict(Group)

    for row in rows:
        overall.add(row)
        por_autor[row["autor_id"]].add(row)
        por_funcao[row["funcao"] or SEM_FUNCAO].add(row)
        linhas_autor[row["autor_id"]].append(compact(row))
        ibge = row["municipio_destino_ibge"]
        uf_code = str(row.get("uf_destino_ibge") or "")[:2]
        if uf_code not in UF_SIGLAS:
            uf_code = ""  # "-1" e vazio: destino nacional, exterior ou sem UF informada
        if ibge and uf_code == "33":
            por_destino[ibge].add(row)
            linhas_destino[ibge].append(compact(row))
        elif uf_code == "33":
            outros_destinos[row["localidade"]].add(row)  # "uf" ou "multiplo" dentro do RJ
        elif uf_code:
            outros_destinos["outras_ufs"].add(row)
        else:
            outros_destinos[row["localidade"]].add(row)  # nacional, exterior, outro

    autor_labels = {
        autor_id: {"nome": _display_name(meta), "partido": _latest_party(meta), "casa": meta["casa"]}
        for autor_id, meta in autores_meta.items()
    }
    municipio_destino: dict[str, str | None] = {}
    for row in rows:  # municipio da emenda quando e um so; None quando a emenda tem varias localidades
        mn = title_case(row["municipio_destino"]) if row["municipio_destino"] else None
        municipio_destino[row["codigo"]] = mn if row["codigo"] not in municipio_destino or municipio_destino[row["codigo"]] == mn else None
    favorecidos = favorecidos_section(snapshot, names, municipio_destino)
    destino_labels = {code: {"nome": info["nome"]} for code, info in population.items()}
    funcao_labels = {name: {"nome": name} for name in por_funcao}

    years = sorted({row["ano"] for row in rows})

    def anos(group: Group) -> dict[str, Any]:
        return {str(year): group.por_ano[year].brief() for year in years if year in group.por_ano}

    autores = []
    for autor_id, group in por_autor.items():
        meta = autores_meta.get(autor_id, {"id": autor_id, "nome": autor_id})
        autores.append(
            {
                "id": autor_id,
                "nome": meta.get("nome"),
                "nome_parlamentar": meta.get("nome_parlamentar"),
                "casa": meta.get("casa"),
                "casas": meta.get("casas", []),
                "partido": _latest_party(meta),
                "partido_por_legislatura": meta.get("partido_por_legislatura", {}),
                "legislaturas": meta.get("legislaturas", []),
                "foto": meta.get("foto"),
                "codigos_siafi": meta.get("codigos_siafi", []),
                "totais": group.total.json(),
                "por_ano": anos(group),
                "tipos": {code: totals.brief() for code, totals in group.tipos.items()},
                "destinos": top(group.destinos, destino_labels),
                "funcoes": top(group.funcoes, funcao_labels),
                "favorecidos": favorecidos["autores"].get(autor_id, []),
            }
        )
    autores.sort(key=lambda autor: autor["totais"]["empenhado"], reverse=True)

    destinos = []
    for code, group in por_destino.items():
        info = population.get(code, {"nome": code, "populacao": None})
        destinos.append(
            {
                "ibge": code,
                "nome": info["nome"],
                "populacao_2022": info["populacao"],
                "totais": group.total.json(),
                "por_ano": anos(group),
                "autores": top(group.autores, autor_labels),
                "funcoes": top(group.funcoes, funcao_labels),
                "favorecidos": favorecidos["destinos"].get(code, []),
            }
        )
    destinos.sort(key=lambda destino: destino["totais"]["empenhado"], reverse=True)

    funcoes = [
        {
            "nome": name,
            "totais": group.total.json(),
            "por_ano": anos(group),
            "autores": top(group.autores, autor_labels),
            "destinos": top(group.destinos, destino_labels),
        }
        for name, group in por_funcao.items()
    ]
    funcoes.sort(key=lambda funcao: funcao["totais"]["empenhado"], reverse=True)

    with_amendments = set(por_autor)
    roster_sem_emendas = [
        {
            "nome": person["nome"],
            "nome_parlamentar": person.get("nome_parlamentar"),
            "partido": _latest_party(person),
            "casa": person.get("casa"),
            "legislaturas": person.get("legislaturas", []),
        }
        for person in snapshot.get("roster", [])
        if person["id"] not in with_amendments
    ]
    roster_sem_emendas.sort(key=lambda person: strip_accents(person["nome"] or ""))

    core = {
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "snapshot_generated_at": snapshot.get("generated_at"),
        "years": years,
        "latest_year": max(years),
        "totais": overall.total.json(),
        "por_ano": {str(year): overall.por_ano[year].json() for year in years},
        "por_tipo": {code: totals.json() for code, totals in overall.tipos.items()},
        "por_tipo_ano": {
            code: {str(year): totals.brief() for year, totals in sorted(group.por_ano.items())}
            for code, group in _by_tipo(rows).items()
        },
        # Destinos sem município: estado, vários municípios, nacional, exterior, outros estados.
        "outros_destinos": {
            key: {
                "nome": OUTROS_DESTINOS.get(key, key),
                "totais": group.total.json(),
                "por_ano": anos(group),
                "autores": top(group.autores, autor_labels),
                "funcoes": top(group.funcoes, funcao_labels),
            }
            for key, group in outros_destinos.items()
        },
        "autores": autores,
        "roster_sem_emendas": roster_sem_emendas,
        "destinos": destinos,
        "funcoes": funcoes,
        "favorecidos": favorecidos["top"],
        "favorecidos_por_tipo": favorecidos["por_tipo"],
        "favorecidos_por_natureza": favorecidos["por_natureza"],
        "ipca": ipca.load().json(),  # 2014.. so the frontend can also deflate 2014 destination-only data later
        "sources": snapshot.get("sources", []),
        "stats": {**snapshot.get("stats", {}), "favorecidos_export": favorecidos["stats"]},
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "static-data.generated.json").write_text(_dumps(core), encoding="utf-8")
    (out_dir / "static-geo.generated.json").write_text(_dumps(municipality_geometries(names)), encoding="utf-8")
    _write_many(out_dir / "static-autores", linhas_autor)
    _write_many(out_dir / "static-destinos", linhas_destino)
    _write_many(out_dir / "static-favorecidos", favorecidos["arquivos"], key=lambda line: (line["am"], line["c"]), reverse=True)
    return core


def _by_tipo(rows: list[dict[str, Any]]) -> dict[str, Group]:
    groups: dict[str, Group] = defaultdict(Group)
    for row in rows:
        groups[TIPO_CODES.get(row["tipo"], "??")].add(row)
    return groups


def _display_name(meta: dict[str, Any]) -> str:
    """Nome parlamentar quando existe; senao o nome civil em caixa normal."""

    name = str(meta.get("nome_parlamentar") or meta.get("nome") or meta.get("id") or "")
    return title_case(name) if name == name.upper() else name


def _latest_party(meta: dict[str, Any]) -> str | None:
    parties = meta.get("partido_por_legislatura") or {}
    if parties:
        return parties[max(parties, key=int)]
    return meta.get("partido")


def _write_many(directory: Path, items: dict[str, list[dict[str, Any]]], key: Any = None, reverse: bool = False) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.generated.json"):
        stale.unlink()
    for name, lines in items.items():
        lines.sort(key=key or (lambda line: (-line["a"], line["n"])), reverse=reverse)
        (directory / f"{name}.generated.json").write_text(_dumps(lines), encoding="utf-8")


def _dumps(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=config.SNAPSHOT_PATH)
    parser.add_argument("--out", type=Path, default=FRONTEND_LIB)
    args = parser.parse_args(argv)
    core = export(args.snapshot, args.out)
    fs = core["stats"]["favorecidos_export"]
    print(f"{len(core['autores'])} autores, {len(core['destinos'])} destinos, {len(core['funcoes'])} funcoes, anos {core['years'][0]}-{core['years'][-1]}")
    print(f"favorecidos: {fs['favorecidos']} ({fs['com_detalhe']} com arquivo), top {len(core['favorecidos'])}, "
          f"ipca base {core['ipca']['base_month']} fator {core['years'][0]}={core['ipca']['factors'].get(str(core['years'][0]))}")
    if fs["municipios_rj_sem_ibge"]:
        print("municipios RJ sem IBGE:", fs["municipios_rj_sem_ibge"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
