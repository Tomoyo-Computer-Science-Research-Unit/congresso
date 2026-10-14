"""Câmara dos Deputados: votações nominais de plenário e presença em sessões deliberativas.

Source: the yearly bulk files at https://dadosabertos.camara.leg.br/arquivos/<nome>/csv/<nome>-<ano>.csv
(UTF-8 with BOM, `;` separated, every field quoted):

- votacoes              one row per votação (all órgãos): id "<idProposicao>-<seq>", data, siglaOrgao,
                        idEvento, aprovacao (1/0), votosSim/Nao/Outros, descricao (result sentence),
                        ultimaAberturaVotacao_descricao (what was put to the vote)
- votacoesVotos         one row per deputy vote: idVotacao, voto, deputado_id/nome/siglaPartido/siglaUf
- votacoesOrientacoes   one row per bancada orientation: idVotacao, siglaBancada, orientacao
- votacoesProposicoes   proposições linked to each votação (titulo "PL 754/2015", ementa)
- eventos               events (sessions, meetings): id, dataHoraInicio, situacao, descricaoTipo
- eventosOrgaos         event -> órgão (PLEN for plenário sessions)
- eventosPresencaDeputados  event -> deputies registered present

A votação is "nominal de plenário" when siglaOrgao == PLEN and it has rows in votacoesVotos. A
session counts for presence when it is a "Sessão Deliberativa" of PLEN, was not cancelled and has at
least one presence registered (a few closed sessions have none; their presence was not recorded).
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

INICIO = "2015-02-01"  # legislatura 55
ARQUIVOS = ["votacoes", "votacoesVotos", "votacoesOrientacoes", "votacoesProposicoes",
            "eventos", "eventosOrgaos", "eventosPresencaDeputados"]

# Voto as written in votacoesVotos -> one-letter code used everywhere downstream.
VOTO_CODES = {"Sim": "S", "Não": "N", "Abstenção": "A", "Obstrução": "O", "Artigo 17": "P", "": "X"}
GOVERNO = {"GOV.", "Governo"}
ORIENTACAO = {"Sim": "S", "Não": "N", "Liberado": "L", "Obstrução": "O", "Abstenção": "A"}


def read_csv(path: Path) -> Iterator[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def _int(value: str | None) -> int:
    try:
        return int(value or 0)
    except ValueError:
        return 0


_PLACAR = re.compile(r"\s*\(?\s*Sim\s*:.*$", re.S)


def resultado_frase(descricao: str) -> str:
    """'Rejeitado o Requerimento. Sim: 22; não: 246; total: 274.' -> 'Rejeitado o Requerimento.'"""
    text = " ".join((descricao or "").split())
    text = _PLACAR.sub("", text).strip()
    if text and not text.endswith("."):
        text += "."
    return text


def tipo_votacao(*textos: str) -> str:
    """Coarse kind used by the list filter: requerimento, destaque (emendas, destaques, partes do
    texto votadas em separado) or texto (projeto, PEC em turno, MP, substitutivo, redação final)."""
    text = " ".join(t for t in textos if t).lower()
    if re.search(r"\brequerimento|\brecurso\b", text):
        return "requerimento"
    if re.search(r"destaque|destacad|\bemenda (n|aglutinativa|de plen)|\bemendas\b|subemenda(?! substitutiva global)|\bart\.|\bartigo\b|\binciso\b|§|expressão|dispositivo", text):
        return "destaque"
    return "texto"


@dataclass(slots=True)
class Votacao:
    id: str  # "c:<id da Câmara>" / "s:<codigoSessaoVotacao>"
    casa: str
    data: str
    hora: str | None
    prop: str | None  # "c:<idProposicao>" / "s:<codigoMateria>"
    titulo: str  # "PL 754/2015"
    objeto: str  # what was put to the vote
    resultado_frase: str
    resultado: str | None  # aprovado | rejeitado
    tipo: str
    evento: str | None = None
    votos: dict[str, tuple[str, str | None, str | None]] = field(default_factory=dict)  # raw key -> (code, partido, uf)
    orientacoes: dict[str, str] = field(default_factory=dict)
    fonte: str = ""
    secreta: bool = False


@dataclass(slots=True)
class Sessao:
    id: str
    casa: str
    data: str
    presentes: set[str]  # raw keys present
    # Senado: raw key -> code (F falta, J justificada) for senators listed but not present
    ausentes: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class Proposicao:
    id: str
    titulo: str
    ementa: str


def parse_year(dirpath: Path, ano: int, api_votos: Callable[[str], list[dict] | None] | None = None,
               ) -> tuple[list[Votacao], list[Sessao], dict[str, Proposicao], dict[str, dict]]:
    """Read one year of bulk files. Returns votações (plenário, nominal), sessions with presence,
    proposições and per-deputy metadata seen in the votes (name, party, UF).

    `api_votos(id)` fills a plenário votação that has a placar in `votacoes` but no rows in
    `votacoesVotos` (API v2 /votacoes/{id}/votos); None skips them."""
    p = lambda nome: dirpath / f"{nome}-{ano}.csv"  # noqa: E731

    votos: dict[str, dict[str, tuple[str, str | None, str | None]]] = {}
    deputados: dict[str, dict] = {}
    for row in read_csv(p("votacoesVotos")):
        dep = row["deputado_id"]
        key = f"camara-{dep}"
        code = VOTO_CODES.get(row["voto"].strip(), "X")
        votos.setdefault(row["idVotacao"], {})[key] = (code, row["deputado_siglaPartido"] or None, row["deputado_siglaUf"] or None)
        deputados[key] = {"nome": row["deputado_nome"], "partido": row["deputado_siglaPartido"] or None,
                          "uf": row["deputado_siglaUf"] or None, "foto": row.get("deputado_urlFoto") or None}

    orient: dict[str, dict[str, str]] = {}
    for row in read_csv(p("votacoesOrientacoes")):
        code = ORIENTACAO.get(row["orientacao"].strip())
        if code:
            bancada = "Governo" if row["siglaBancada"] in GOVERNO else row["siglaBancada"]
            orient.setdefault(row["idVotacao"], {})[bancada] = code

    props: dict[str, Proposicao] = {}
    vot_props: dict[str, list[str]] = {}
    for row in read_csv(p("votacoesProposicoes")):
        pid = row["proposicao_id"]
        if not pid or pid == "0":
            continue
        props[f"c:{pid}"] = Proposicao(f"c:{pid}", row["proposicao_titulo"].strip(), " ".join(row["proposicao_ementa"].split()))
        vot_props.setdefault(row["idVotacao"], []).append(f"c:{pid}")

    votacoes: list[Votacao] = []
    for row in read_csv(p("votacoes")):
        vid = row["id"]
        if row["siglaOrgao"] != "PLEN" or row["data"] < INICIO:
            continue
        if vid not in votos and api_votos and _int(row["votosSim"]) + _int(row["votosNao"]) + _int(row["votosOutros"]) > 0:
            for item in api_votos(vid) or []:
                dep = item.get("deputado_") or {}
                key = f"camara-{dep.get('id')}"
                code = VOTO_CODES.get((item.get("tipoVoto") or "").strip(), "X")
                votos.setdefault(vid, {})[key] = (code, dep.get("siglaPartido") or None, dep.get("siglaUf") or None)
                deputados.setdefault(key, {"nome": dep.get("nome"), "partido": dep.get("siglaPartido") or None,
                                           "uf": dep.get("siglaUf") or None, "foto": dep.get("urlFoto") or None})
        if vid not in votos:
            continue
        prefix = f"c:{vid.split('-')[0]}"
        linked = vot_props.get(vid, [])
        prop = prefix if prefix in props else (linked[0] if linked else None)
        if prop is None and prefix != "c:":
            prop = prefix  # filled later from the API when the bulk file lacks it
        objeto = " ".join(row["ultimaAberturaVotacao_descricao"].split())
        frase = resultado_frase(row["descricao"])
        aprov = row["aprovacao"].strip()
        votacoes.append(Votacao(
            id=f"c:{vid}", casa="camara", data=row["data"],
            hora=(row["dataHoraRegistro"][11:16] or None) if row["dataHoraRegistro"] else None,
            prop=prop, titulo=props[prop].titulo if prop in props else "",
            objeto=objeto, resultado_frase=frase,
            resultado="aprovado" if aprov == "1" else "rejeitado" if aprov == "0" else None,
            tipo=tipo_votacao(objeto or frase), evento=row["idEvento"] or None,
            votos=votos[vid], orientacoes=orient.get(vid, {}),
            fonte=f"https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao={vid.split('-')[0]}",
        ))

    plen = {row["idEvento"] for row in read_csv(p("eventosOrgaos")) if row["siglaOrgao"] == "PLEN"}
    sessoes_meta = {}
    for row in read_csv(p("eventos")):
        if row["id"] in plen and row["descricaoTipo"] == "Sessão Deliberativa" and not row["situacao"].startswith("Cancelada"):
            sessoes_meta[row["id"]] = row["dataHoraInicio"][:10]
    presentes: dict[str, set[str]] = {}
    for row in read_csv(p("eventosPresencaDeputados")):
        if row["idEvento"] in sessoes_meta:
            presentes.setdefault(row["idEvento"], set()).add(f"camara-{row['idDeputado']}")
    sessoes = [Sessao(sid, "camara", data, presentes[sid]) for sid, data in sorted(sessoes_meta.items(), key=lambda kv: kv[1])
               if sid in presentes and data >= INICIO]
    return votacoes, sessoes, props, deputados


# ----------------------------------------------------------------------------- exercício


@dataclass(frozen=True, slots=True)
class Exercicio:
    inicio: str  # ISO day, inclusive
    fim: str  # ISO day, exclusive
    partido: str | None
    uf: str | None


def exercise_intervals(historico: list[dict]) -> list[Exercicio]:
    """From /deputados/{id}/historico, the periods the deputy was in office.

    Each record is a status change. The deputy is in office from a record with situacao "Exercício"
    until the next record whose situacao is something else (Afastado, Licença, Suplência,
    FIM_MANDATO...). Records with situacao null are snapshots ("nome no início da legislatura") and
    do not change the state. A party change inside an exercise period starts a new interval. An
    exit stamped 23:59 (end of term) still counts that day.
    """
    rows = sorted((r for r in historico if r.get("situacao")), key=lambda r: r["dataHora"])
    out: list[Exercicio] = []
    cur: dict | None = None
    for r in rows:
        day = r["dataHora"][:10]
        if r["situacao"] == "Exercício":
            if cur is None:
                cur = {"inicio": day, "partido": r.get("siglaPartido"), "uf": r.get("siglaUf")}
            elif r.get("siglaPartido") != cur["partido"]:
                if day > cur["inicio"]:
                    out.append(Exercicio(cur["inicio"], day, cur["partido"], cur["uf"]))
                cur = {"inicio": day, "partido": r.get("siglaPartido"), "uf": r.get("siglaUf") or cur["uf"]}
        elif cur is not None:
            if r["dataHora"][11:16] >= "23:59":
                day = _next_day(day)
            if day > cur["inicio"]:
                out.append(Exercicio(cur["inicio"], day, cur["partido"], cur["uf"]))
            cur = None
    if cur is not None:
        out.append(Exercicio(cur["inicio"], "9999-12-31", cur["partido"], cur["uf"]))
    return out


def _next_day(day: str) -> str:
    import datetime as dt

    return (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()


def exercise_on(intervals: list[Exercicio], day: str) -> Exercicio | None:
    """The exercise period covering `day` (ISO date), or None; the exit day itself does not count."""
    for e in intervals:
        if e.inicio <= day < e.fim:
            return e
    return None
