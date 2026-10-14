"""Votações nominais de plenário e presença dos deputados federais e senadores, por UF.

    python -m app.etl.export_votos --uf all            # baixa o ano corrente de novo, anos passados do cache
    python -m app.etl.export_votos --uf all --offline  # só o cache em data/raw

Fontes: arquivos anuais da Câmara (dadosabertos.camara.leg.br/arquivos) e o serviço /votacao do
Senado (legis.senado.leg.br/dadosabertos), mais o histórico de exercício de cada deputado
(API v2 /deputados/{id}/historico) para saber quem estava em exercício em cada votação e sessão.
Cobertura: legislaturas 55, 56 e 57 (de 2015-02-01 em diante).

Saída (frontend/data):
  votacoes/index.generated.json        todas as votações: id, data, proposição, tipo, resultado, placar, governo
  votacoes/<ano>.generated.json        detalhe por votação: o que foi a voto, frase do resultado, por partido, orientações
  votacoes/proposicoes.generated.json  título e ementa das proposições votadas
  votacoes/meta.generated.json         contagens e fontes
  <uf>/static-bancada.generated.json   parlamentares da UF que votaram ou tinham sessão, e faltas por mês
  <uf>/static-votos/<ano>.generated.json   voto da bancada da UF em cada votação do ano
  <uf>/static-parlamentares/<id>.generated.json   lista de votos de um parlamentar, com marcas
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .. import config
from ..http import fetch_json
from ..votos import camara, senado
from ..votos.camara import Exercicio, Proposicao, Sessao, Votacao
from ..votos.fetch import (camara_arquivo_url, fetch_json_file, fetch_resumable, senado_orientacao_url,
                           senado_votacoes_url)

FRONTEND_DATA = config.ROOT / "frontend" / "data"
RAW_CAMARA = config.RAW_DIR / "camara" / "arquivos"
RAW_HIST = config.RAW_DIR / "camara" / "historico"
RAW_CAMARA_API = config.RAW_DIR / "camara" / "api"
RAW_SENADO = config.RAW_DIR / "senado" / "votos"
PRIMEIRO_ANO = 2015
HIST_MAX_AGE_DAYS = 7  # deputies of the current legislature get their history refreshed weekly

VOTOU = {"S", "N", "A", "O"}
FLAG_CONTRA_MAIORIA, FLAG_CONTRA_PARTIDO, FLAG_CONTRA_GOVERNO, FLAG_GOVERNO_ORIENTOU, FLAG_PARTIDO_MAIORIA = 1, 2, 4, 8, 16


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def anos_cobertos(today: dt.date | None = None) -> list[int]:
    today = today or dt.date.today()
    return list(range(PRIMEIRO_ANO, today.year + 1))


def refresh_years(today: dt.date | None = None) -> set[int]:
    """Years whose files are downloaded again: the current one, and the previous one until 15 Feb
    (votes of late December show up in the files some days later)."""
    today = today or dt.date.today()
    years = {today.year}
    if today < dt.date(today.year, 2, 15):
        years.add(today.year - 1)
    return years


# ----------------------------------------------------------------------------- fetch


def _fetch(fn, *args, force: bool, dest: Path, **kw) -> Path | None:
    try:
        return fn(*args, dest, force=force, **kw)
    except Exception as e:  # noqa: BLE001
        if dest.exists():
            log(f"aviso: {dest.name} não foi baixado de novo ({e}); usando o cache")
            return dest
        log(f"aviso: {dest.name} indisponível ({e})")
        return None


def fetch_sources(anos: list[int], offline: bool = False, today: dt.date | None = None) -> dict[str, Any]:
    today = today or dt.date.today()
    fresh = set() if offline else refresh_years(today)
    stats: dict[str, Any] = {"baixados": [], "cache": []}
    for ano in anos:
        force = ano in fresh
        for nome in camara.ARQUIVOS:
            dest = RAW_CAMARA / f"{nome}-{ano}.csv"
            if offline:
                continue
            existed = dest.exists()
            _fetch(fetch_resumable, camara_arquivo_url(nome, ano), force=force, dest=dest)
            stats["baixados" if force or not existed else "cache"].append(dest.name)
        if offline:
            continue
        _fetch(fetch_json_file, senado_votacoes_url(ano), force=force, dest=RAW_SENADO / f"votacoes-{ano}.json")
        for mes in range(1, 13):
            if dt.date(ano, mes, 1) > today:
                break
            _fetch(fetch_json_file, senado_orientacao_url(ano, mes), force=force,
                   dest=RAW_SENADO / f"orientacao-{ano}-{mes:02d}.json")
    return stats


def camara_api_votos(offline: bool):
    def get(vid: str) -> list[dict] | None:
        dest = RAW_CAMARA_API / f"votacao_{vid}_votos.json"
        if offline and not dest.exists():
            return None
        try:
            return fetch_json(f"{config.CAMARA_API}/votacoes/{vid}/votos", dest).get("dados")
        except Exception as e:  # noqa: BLE001
            log(f"aviso: votos de {vid} pela API: {e}")
            return None
    return get


def camara_api_proposicao(pid: str, offline: bool) -> Proposicao | None:
    raw = pid.split(":", 1)[1]
    dest = RAW_CAMARA_API / f"proposicao_{raw}.json"
    if offline and not dest.exists():
        return None
    try:
        d = fetch_json(f"{config.CAMARA_API}/proposicoes/{raw}", dest).get("dados") or {}
    except Exception as e:  # noqa: BLE001
        log(f"aviso: proposição {raw} pela API: {e}")
        return None
    titulo = f"{d.get('siglaTipo')} {d.get('numero')}/{d.get('ano')}" if d.get("siglaTipo") else ""
    return Proposicao(pid, titulo, " ".join((d.get("ementa") or "").split()))


def historicos(keys: Iterable[str], offline: bool, today: dt.date | None = None) -> dict[str, list[Exercicio]]:
    """Exercise periods of each deputy ("camara-<id>"), from /deputados/{id}/historico (cached)."""
    today = today or dt.date.today()
    out: dict[str, list[Exercicio]] = {}
    for key in sorted(keys):
        dep = key.split("-", 1)[1]
        dest = RAW_HIST / f"{dep}.json"
        force = False
        if dest.exists() and not offline:
            age = (time.time() - dest.stat().st_mtime) / 86400
            current = '"idLegislatura": 57' in dest.read_text(encoding="utf-8")
            force = current and age > HIST_MAX_AGE_DAYS
        if offline and not dest.exists():
            continue
        try:
            data = fetch_json(f"{config.CAMARA_API}/deputados/{dep}/historico", dest, force=force)
        except Exception as e:  # noqa: BLE001
            if dest.exists():
                data = json.loads(dest.read_text(encoding="utf-8"))
            else:
                log(f"aviso: histórico de {dep}: {e}")
                continue
        out[key] = camara.exercise_intervals(data.get("dados") or [])
    return out


# ----------------------------------------------------------------------------- model


@dataclass(slots=True)
class Dados:
    votacoes: list[Votacao] = field(default_factory=list)
    sessoes: list[Sessao] = field(default_factory=list)
    props: dict[str, Proposicao] = field(default_factory=dict)
    pessoas: dict[str, dict] = field(default_factory=dict)  # raw key -> name, party, uf, foto (latest seen)
    exercicio: dict[str, list[Exercicio]] = field(default_factory=dict)
    # computed
    sessao_uf: dict[tuple[str, str], str] = field(default_factory=dict)  # (sessao id, raw key) -> uf
    ausencias_sessao: dict[str, dict[str, str]] = field(default_factory=dict)  # sessao id -> raw key -> F/J
    stats: dict[str, Any] = field(default_factory=dict)


def load(anos: list[int], offline: bool) -> Dados:
    d = Dados()
    api = camara_api_votos(offline)
    validos = senado.codigos_validos(sorted(config.RAW_DIR.glob("senado_legislatura_5[5-7].json")))
    descartadas: list[dict] = []
    for ano in anos:
        if not (RAW_CAMARA / f"votacoes-{ano}.csv").exists():
            log(f"aviso: Câmara {ano} sem arquivo")
        else:
            v, s, p, m = camara.parse_year(RAW_CAMARA, ano, api)
            d.votacoes += v
            d.sessoes += s
            d.props.update(p)
            d.pessoas.update(m)
        path = RAW_SENADO / f"votacoes-{ano}.json"
        if path.exists():
            ori = senado.parse_orientacoes(sorted(RAW_SENADO.glob(f"orientacao-{ano}-*.json")))
            v, s, p, m = senado.parse_year(path, ori, validos or None, descartadas)
            d.votacoes += v
            d.sessoes += s
            d.props.update(p)
            d.pessoas.update(m)
    d.stats["senado_descartadas"] = {
        "total": len(descartadas), "abertas": sum(1 for x in descartadas if not x["secreta"]),
        "por_ano": dict(Counter(x["data"][:4] for x in descartadas)),
        "ultima": max((x["data"] for x in descartadas), default=None),
    }
    # Proposições the bulk files do not describe come from the API, one request each (cached).
    for vot in d.votacoes:
        if vot.prop and vot.prop.startswith("c:") and (vot.prop not in d.props or not d.props[vot.prop].titulo):
            prop = camara_api_proposicao(vot.prop, offline)
            if prop:
                d.props[vot.prop] = prop
        if vot.prop in d.props and not vot.titulo:
            vot.titulo = d.props[vot.prop].titulo
    return d


def complete(d: Dados, offline: bool, exercicio: dict[str, list[Exercicio]] | None = None) -> None:
    """Add the deputies in office who did not vote (absent, or present without vote) and compute
    who was in office at each Câmara session. `exercicio` replaces the API history (tests)."""
    deputados = {k for k in d.pessoas if k.startswith("camara-")}
    for s in d.sessoes:
        if s.casa == "camara":
            deputados |= s.presentes
    d.exercicio = exercicio if exercicio is not None else historicos(deputados, offline)
    log(f"histórico de exercício: {len(d.exercicio)} de {len(deputados)} deputados")

    by_day: dict[str, list[tuple[str, Exercicio]]] = {}

    def em_exercicio(day: str) -> list[tuple[str, Exercicio]]:
        if day not in by_day:
            by_day[day] = [(k, e) for k, ivs in d.exercicio.items() if (e := camara.exercise_on(ivs, day))]
        return by_day[day]

    presentes_evento = {s.id: s.presentes for s in d.sessoes if s.casa == "camara"}
    added = Counter()
    for vot in d.votacoes:
        if vot.casa != "camara":
            continue
        presentes = presentes_evento.get(vot.evento or "", set())
        for key, e in em_exercicio(vot.data):
            if key not in vot.votos:
                code = "X" if key in presentes else "F"
                vot.votos[key] = (code, e.partido, e.uf)
                added[code] += 1
    d.stats["camara_votos_completados"] = dict(added)

    for s in d.sessoes:
        if s.casa == "camara":
            aus: dict[str, str] = {}
            for key, e in em_exercicio(s.data):
                d.sessao_uf[(s.id, key)] = e.uf or d.pessoas.get(key, {}).get("uf")
                if key not in s.presentes:
                    aus[key] = "F"
            for key in s.presentes:
                if (s.id, key) not in d.sessao_uf:
                    d.sessao_uf[(s.id, key)] = d.pessoas.get(key, {}).get("uf")
            d.ausencias_sessao[s.id] = aus
        else:
            d.ausencias_sessao[s.id] = dict(s.ausentes)
    # Senado: the UF of each senator in a session comes from the votes of that session.
    sen_uf: dict[tuple[str, str], str] = {}
    for vot in d.votacoes:
        if vot.casa == "senado":
            for key, (_c, _p, uf) in vot.votos.items():
                sen_uf[(vot.evento or "", key)] = uf
    for s in d.sessoes:
        if s.casa == "senado":
            for key in s.presentes | set(s.ausentes):
                d.sessao_uf[(s.id, key)] = sen_uf.get((s.id, key)) or d.pessoas.get(key, {}).get("uf")


@dataclass(slots=True)
class Derivado:
    contagem: dict[str, int]
    maioria: str | None
    partidos: dict[str, list[int]]
    maioria_partido: dict[str, str | None]
    governo: str | None


def derive(vot: Votacao) -> Derivado:
    cont = Counter(code for code, _p, _u in vot.votos.values())
    partidos: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for code, partido, _uf in vot.votos.values():
        if code in VOTOU:
            partidos[partido or "sem partido"]["SNAO".index(code)] += 1
    sim, nao = cont["S"], cont["N"]
    maioria = "S" if sim > nao else "N" if nao > sim else None
    mp = {p: ("S" if v[0] > v[1] else "N" if v[1] > v[0] else None) for p, v in partidos.items()}
    gov = vot.orientacoes.get("Governo")
    return Derivado({c: cont[c] for c in "SNAOPVXFJ" if cont[c]}, maioria, dict(partidos), mp, gov)


def flags_for(code: str, partido: str | None, der: Derivado) -> int:
    if code not in ("S", "N"):
        return 0
    f = 0
    if der.maioria and code != der.maioria:
        f |= FLAG_CONTRA_MAIORIA
    pm = der.maioria_partido.get(partido or "sem partido")
    if pm:
        f |= FLAG_PARTIDO_MAIORIA
        if code != pm:
            f |= FLAG_CONTRA_PARTIDO
    if der.governo in ("S", "N"):
        f |= FLAG_GOVERNO_ORIENTOU
        if code != der.governo:
            f |= FLAG_CONTRA_GOVERNO
    return f


# ----------------------------------------------------------------------------- export


def _dumps(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _write(path: Path, payload: object) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = _dumps(payload)
    path.write_text(text, encoding="utf-8")
    return len(text.encode())


def ordem(votacoes: list[Votacao]) -> list[Votacao]:
    """Order of the common index: most recent first (date, time, id)."""
    return sorted(votacoes, key=lambda v: (v.data, v.hora or "", v.id), reverse=True)


def ordinais(votacoes: list[Votacao]) -> dict[str, int]:
    """Position of each votação among those of its house, oldest first. The frontend rebuilds the
    same numbering from the index (filter by house, reverse), so a parlamentar's file can carry one
    character per votação instead of the id."""
    out: dict[str, int] = {}
    count: Counter = Counter()
    for v in reversed(ordem(votacoes)):
        out[v.id] = count[v.casa]
        count[v.casa] += 1
    return out


FLAG_CHARS = "0123456789abcdefghijklmnopqrstuv"  # flags 0..31, one base-32 character


def write_common(d: Dados, derived: dict[str, Derivado], out: Path, sources: list[dict]) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.generated.json"):
        stale.unlink()
    ordered = ordem(d.votacoes)
    index = []
    detalhe: dict[str, dict[str, Any]] = defaultdict(dict)
    for v in ordered:
        der = derived[v.id]
        c = der.contagem
        index.append([v.id, v.data, v.titulo, v.tipo, {"aprovado": "a", "rejeitado": "r"}.get(v.resultado or ""),
                      c.get("S", 0), c.get("N", 0), c.get("A", 0), c.get("O", 0), der.governo, v.prop])
        detalhe[v.data[:4]][v.id] = {
            "ob": v.objeto, "fr": v.resultado_frase, "h": v.hora, "f": v.fonte,
            "pp": dict(sorted(der.partidos.items(), key=lambda kv: -sum(kv[1]))),
            "or": v.orientacoes, "cnt": c,
        }
    sizes = {"index": _write(out / "index.generated.json", index)}
    for ano, items in detalhe.items():
        sizes[ano] = _write(out / f"{ano}.generated.json", items)
    used = {v.prop for v in d.votacoes if v.prop}
    props = {pid: [p.titulo, p.ementa] for pid, p in sorted(d.props.items()) if pid in used}
    sizes["proposicoes"] = _write(out / "proposicoes.generated.json", props)
    por_casa_ano: dict[str, Counter] = defaultdict(Counter)
    for v in d.votacoes:
        por_casa_ano[v.casa][v.data[:4]] += 1
    sess_casa_ano: dict[str, Counter] = defaultdict(Counter)
    for s in d.sessoes:
        sess_casa_ano[s.casa][s.data[:4]] += 1
    gov = Counter(v.casa for v in d.votacoes if derived[v.id].governo in ("S", "N", "L", "O", "A"))
    meta = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "inicio": camara.INICIO,
        "anos": sorted({int(v.data[:4]) for v in d.votacoes}),
        "votacoes": {casa: dict(sorted(c.items())) for casa, c in por_casa_ano.items()},
        "sessoes": {casa: dict(sorted(c.items())) for casa, c in sess_casa_ano.items()},
        "com_orientacao_governo": dict(gov),
        "votos": sum(1 for v in d.votacoes for code, _p, _u in v.votos.values() if code in VOTOU),
        "sources": sources,
        "stats": d.stats,
    }
    sizes["meta"] = _write(out / "meta.generated.json", meta)
    return {"sizes": sizes, "meta": meta}


def _uf_maps(snapshot: dict[str, Any]) -> tuple[dict[str, str], dict[str, dict], set[str]]:
    """raw key ("camara-<id>", "senado-<codigo>") -> person id of this UF's roster; person meta; autores."""
    raw_to_id: dict[str, str] = {}
    meta: dict[str, dict] = {}
    for p in snapshot.get("roster", []):
        meta[p["id"]] = p
        for casa, rid in (p.get("ids") or {}).items():
            if casa in ("camara", "senado"):
                raw_to_id[f"{casa}-{rid}"] = p["id"]
    autores = {a["id"] for a in snapshot.get("autores", [])}
    return raw_to_id, meta, autores


def write_uf(uf: str, d: Dados, derived: dict[str, Derivado], national: dict[str, str],
             snapshot: dict[str, Any] | None = None, out: Path | None = None) -> dict[str, Any]:
    if snapshot is None:
        path = config.uf_config(uf).snapshot_path
        snapshot = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    raw_to_id, roster, autores = _uf_maps(snapshot)
    out = out or FRONTEND_DATA / uf.lower()

    def pid(raw: str) -> str:
        return raw_to_id.get(raw) or national.get(raw) or raw

    pessoas: dict[str, dict[str, Any]] = {}

    def touch(raw: str, partido: str | None, day: str) -> str:
        person = pid(raw)
        info = pessoas.setdefault(person, {"id": person, "casas": set(), "partido": None, "_day": "", "raws": set()})
        info["casas"].add(raw.split("-", 1)[0])
        info["raws"].add(raw)
        if day >= info["_day"] and partido:
            info["partido"], info["_day"] = partido, day
        return person

    # votes of the UF's bancada, per year, aligned to a member list per house
    por_ano: dict[str, dict[str, Any]] = {}
    pos = ordinais(d.votacoes)
    linhas: dict[str, dict[str, dict[int, tuple[str, int]]]] = defaultdict(lambda: defaultdict(dict))
    for v in ordem(d.votacoes):
        der = derived[v.id]
        members = {raw: val for raw, val in v.votos.items() if val[2] == uf}
        if not members:
            continue
        ano = v.data[:4]
        bloco = por_ano.setdefault(ano, {"m": {"camara": [], "senado": []}, "v": {}})
        lista = bloco["m"][v.casa]
        codes = {}
        for raw, (code, partido, _uf) in members.items():
            person = touch(raw, partido, v.data)
            if person not in lista:
                lista.append(person)
            codes[person] = code
            linhas[person][v.casa][pos[v.id]] = (code, flags_for(code, partido, der))
        bloco["v"][v.id] = codes
    for bloco in por_ano.values():
        for casa, lista in bloco["m"].items():
            lista.sort()
        for vid, codes in bloco["v"].items():
            casa = "camara" if vid.startswith("c:") else "senado"
            bloco["v"][vid] = "".join(codes.get(p, ".") for p in bloco["m"][casa])

    # attendance per month: [faltas, ausências justificadas, sessões em exercício]
    presenca: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    for s in d.sessoes:
        aus = d.ausencias_sessao.get(s.id, {})
        mes = s.data[:7]
        for raw in s.presentes | set(aus):
            if d.sessao_uf.get((s.id, raw)) != uf:
                continue
            person = touch(raw, None, s.data)
            cell = presenca[person][mes]
            cell[2] += 1
            code = aus.get(raw)
            if code == "F":
                cell[0] += 1
            elif code == "J":
                cell[1] += 1

    lista_pessoas = []
    for person, info in pessoas.items():
        meta = roster.get(person) or {}
        seen = [d.pessoas[r] for r in sorted(info["raws"]) if r in d.pessoas]
        nome = next((s["nome"] for s in reversed(seen) if s.get("nome")), None) or meta.get("nome_parlamentar") or meta.get("nome") or person
        partido = info["partido"] or next((s["partido"] for s in reversed(seen) if s.get("partido")), None)
        lista_pessoas.append({"id": person, "nome": nome, "partido": partido, "casas": sorted(info["casas"]),
                              "autor": person in autores})
    lista_pessoas.sort(key=lambda p: p["nome"])

    sizes: dict[str, int] = {}
    bancada = {
        "pessoas": lista_pessoas,
        "presenca": {p: {m: c for m, c in sorted(meses.items())} for p, meses in presenca.items()},
    }
    sizes["bancada"] = _write(out / "static-bancada.generated.json", bancada)
    vdir = out / "static-votos"
    vdir.mkdir(parents=True, exist_ok=True)
    for stale in vdir.glob("*.generated.json"):
        stale.unlink()
    sizes["votos"] = sum(_write(vdir / f"{ano}.generated.json", bloco) for ano, bloco in por_ano.items())
    pdir = out / "static-parlamentares"
    pdir.mkdir(parents=True, exist_ok=True)
    for stale in pdir.glob("*.generated.json"):
        stale.unlink()
    sizes["parlamentares"] = sum(_write(pdir / f"{person}.generated.json", parlamentar_json(casas)) for person, casas in linhas.items())
    return {
        "uf": uf, "pessoas": len(lista_pessoas), "com_votos": len(linhas),
        "votos": sum(len(c) for casas in linhas.values() for c in casas.values()), "anos": len(por_ano), "sizes": sizes,
    }


def parlamentar_json(casas: dict[str, dict[int, tuple[str, int]]]) -> dict[str, list[Any]]:
    """{casa: [primeira posição, votos, marcas]}: one character per votação of the house from the
    first to the last one the parlamentar was in; "." where he was not in office (or not from the
    UF), marcas in base 32 (see FLAG_*)."""
    out: dict[str, list[Any]] = {}
    for casa, rows in casas.items():
        ini, fim = min(rows), max(rows)
        codes = "".join(rows[i][0] if i in rows else "." for i in range(ini, fim + 1))
        flags = "".join(FLAG_CHARS[rows[i][1]] if i in rows else "0" for i in range(ini, fim + 1))
        out[casa] = [ini, codes, flags]
    return out


def sources_list(d: Dados) -> list[dict[str, Any]]:
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    return [
        {"name": "Câmara dos Deputados, arquivos anuais de votações (votacoes, votacoesVotos, votacoesOrientacoes, votacoesProposicoes)",
         "url": "https://dadosabertos.camara.leg.br/arquivos/", "accessed_at": now},
        {"name": "Câmara dos Deputados, arquivos anuais de eventos e presença (eventos, eventosOrgaos, eventosPresencaDeputados)",
         "url": "https://dadosabertos.camara.leg.br/arquivos/", "accessed_at": now},
        {"name": "Câmara dos Deputados, API v2: histórico de exercício de cada deputado e lacunas dos arquivos",
         "url": "https://dadosabertos.camara.leg.br/api/v2/", "accessed_at": now},
        {"name": "Senado Federal, votações nominais com voto por senador (/votacao)",
         "url": "https://legis.senado.leg.br/dadosabertos/votacao", "accessed_at": now},
        {"name": "Senado Federal, orientação de bancada do painel eletrônico (/plenario/votacao/orientacaoBancada)",
         "url": "https://legis.senado.leg.br/dadosabertos/plenario/votacao/orientacaoBancada", "accessed_at": now},
    ]


def export(ufs: list[str], offline: bool = False) -> dict[str, Any]:
    t0 = time.time()
    anos = anos_cobertos()
    fetched = fetch_sources(anos, offline=offline)
    d = load(anos, offline)
    complete(d, offline)
    derived = {v.id: derive(v) for v in d.votacoes}
    common = write_common(d, derived, FRONTEND_DATA / "votacoes", sources_list(d))
    national: dict[str, str] = {}
    for sigla in config.UF_ORDER:
        path = config.uf_config(sigla).snapshot_path
        if path.exists():
            raw_to_id, _m, _a = _uf_maps(json.loads(path.read_text(encoding="utf-8")))
            for raw, person in raw_to_id.items():
                national.setdefault(raw, person)
    results = {}
    failed = []
    for uf in ufs:
        try:
            results[uf] = write_uf(uf, d, derived, national)
        except Exception as e:  # noqa: BLE001
            log(f"export-votos-failed: {uf}: {e}")
            failed.append(uf)
    log(f"votos: {len(d.votacoes)} votações, {len(d.sessoes)} sessões, {time.time() - t0:.0f} s")
    if failed:
        print("export-votos-failed: " + " ".join(failed))
    return {"common": common, "ufs": results, "fetched": fetched, "failed": failed}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--uf", default="all", help="UF, lista separada por vírgula ou 'all'")
    parser.add_argument("--offline", action="store_true", help="não baixa nada; usa data/raw")
    args = parser.parse_args(argv)
    ufs = config.UF_ORDER if args.uf.lower() == "all" else [u.strip().upper() for u in args.uf.split(",")]
    result = export(ufs, offline=args.offline)
    summary = {uf: {k: r[k] for k in ("pessoas", "com_votos", "votos", "sizes")} for uf, r in result["ufs"].items()}
    print(json.dumps({"meta": {k: result["common"]["meta"][k] for k in ("anos", "votacoes", "sessoes", "votos", "com_orientacao_governo", "stats")},
                      "sizes": result["common"]["sizes"], "ufs": summary}, ensure_ascii=False, indent=1))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
