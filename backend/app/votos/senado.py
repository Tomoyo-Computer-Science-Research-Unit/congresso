"""Senado Federal: votações nominais de plenário (voto por senador) e comparecimento.

Sources (legis.senado.leg.br/dadosabertos, JSON with Accept: application/json):

- /votacao?dataInicio=<ano>-01-01&dataFim=<ano>-12-31   every nominal vote of the year with the
  vote of each senator in office (siglaVotoParlamentar: Sim, Não, Abstenção, Votou [secret ballot],
  P-NRV [present, no vote], NCom [did not attend], AP/LS/MIS/LP/LG/LAP/MERC [justified absence],
  Presidente (art. 51 RISF), P-OD [declared obstruction], NA [dispositivo não citado]).
- /plenario/votacao/orientacaoBancada/<inicio>/<fim>    the electronic panel (SVE) with each
  leader's orientation, one month per request; joined on sequencialVotacao. Starts in 2018-10.

The Senado does not publish a per-session attendance list. Attendance here comes from the votes:
each session with at least one nominal vote (open or secret) counts once; a senator listed in it
is present if any of his entries in that session is a presence code, absent with justification if
all entries are justified codes, and absent (falta) otherwise (NCom).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .camara import INICIO, Proposicao, Sessao, Votacao, tipo_votacao

VOTO_CODES = {
    "Sim": "S", "Não": "N", "Abstenção": "A", "P-OD": "O", "Presidente (art. 51 RISF)": "P",
    "Votou": "V", "P-NRV": "X", "NA": "X", "NCom": "F",
    "AP": "J", "LS": "J", "MIS": "J", "LP": "J", "LG": "J", "LAP": "J", "MERC": "J",
}
PRESENTE = {"S", "N", "A", "O", "P", "V", "X"}
ORIENTACAO = {"SIM": "S", "NÃO": "N", "NAO": "N", "LIVRE": "L", "LIBERADO": "L", "OBSTRUÇÃO": "O", "ABSTENÇÃO": "A"}
RESULTADO = {"A": "aprovado", "R": "rejeitado"}


def voto_code(sigla: str | None) -> str:
    sigla = (sigla or "").strip()
    if sigla in VOTO_CODES:
        return VOTO_CODES[sigla]
    # Unknown codes seen so far are leaves and missions; anything else counts as present without vote.
    return "J" if re.match(r"^(L|MIS|AP)", sigla) else "X"


def parse_orientacoes(paths: list[Path]) -> dict[int, dict[str, str]]:
    """sequencialVotacao -> {bancada: code}; "Governo" is the government leader."""
    out: dict[int, dict[str, str]] = {}
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        for v in data.get("votacoes", []) or []:
            seq = v.get("sequencialVotacao")
            for o in v.get("orientacoesLideranca") or []:
                code = ORIENTACAO.get((o.get("voto") or "").strip().upper())
                if seq is not None and code and o.get("partido"):
                    out.setdefault(int(seq), {})[o["partido"].strip()] = code
    return out


# Integrity check. Until 2017-02 most /votacao records list the wrong people: on 2015-04-01, 69 of
# the 81 names are senators of past decades (Abdias Nascimento, Antonio Carlos Magalhães...), the
# same 81 on every vote of 2015 and 2016 except six, and the same kind of list on 2017-02-15/16.
# A record is kept only when at most MAX_ESTRANHOS of its senators are missing from the Senado's
# own lists of senators of legislaturas 55 to 57 (/senador/lista/legislatura/N).
MAX_ESTRANHOS = 3


def codigos_validos(paths: list[Path]) -> set[str]:
    """CodigoParlamentar of every senator in the Senado's legislature lists (cached JSON)."""
    out: set[str] = set()
    for path in paths:
        out |= set(re.findall(r'"CodigoParlamentar":\s*"?(\d+)', path.read_text(encoding="utf-8")))
    return out


def parse_year(path: Path, orientacoes: dict[int, dict[str, str]], validos: set[str] | None = None,
               descartadas: list[dict] | None = None) -> tuple[list[Votacao], list[Sessao], dict[str, Proposicao], dict[str, dict]]:
    """One year of /votacao. Secret votes count for attendance but are not listed as votações.
    With `validos`, records listing more than MAX_ESTRANHOS unknown senators are dropped (and
    appended to `descartadas`)."""
    data = json.loads(path.read_text(encoding="utf-8"))
    votacoes: list[Votacao] = []
    props: dict[str, Proposicao] = {}
    senadores: dict[str, dict] = {}
    sess: dict[str, dict] = {}
    for v in data:
        if not v.get("votos") or (v.get("dataSessao") or "") < INICIO:
            continue
        if validos:
            estranhos = [x for x in v["votos"] if str(x.get("codigoParlamentar")) not in validos]
            if len(estranhos) > MAX_ESTRANHOS:
                if descartadas is not None:
                    descartadas.append({"id": v.get("codigoSessaoVotacao"), "data": v.get("dataSessao"),
                                        "secreta": v.get("votacaoSecreta") == "S", "estranhos": len(estranhos),
                                        "listados": len(v["votos"])})
                continue
        votos: dict[str, tuple[str, str | None, str | None]] = {}
        for x in v["votos"]:
            key = f"senado-{x['codigoParlamentar']}"
            code = voto_code(x.get("siglaVotoParlamentar"))
            votos[key] = (code, x.get("siglaPartidoParlamentar") or None, x.get("siglaUFParlamentar") or None)
            senadores[key] = {"nome": x.get("nomeParlamentar"), "partido": x.get("siglaPartidoParlamentar") or None,
                              "uf": x.get("siglaUFParlamentar") or None, "foto": None}
        sid = str(v.get("codigoSessao"))
        s = sess.setdefault(sid, {"data": v["dataSessao"], "codes": {}})
        for key, (code, _p, _u) in votos.items():
            s["codes"].setdefault(key, set()).add(code)
        if v.get("votacaoSecreta") == "S":
            continue
        prop = f"s:{v['codigoMateria']}" if v.get("codigoMateria") else None
        titulo = (v.get("identificacao") or "").strip()
        if prop:
            props[prop] = Proposicao(prop, titulo, " ".join((v.get("ementa") or "").split()))
        objeto = " ".join((v.get("descricaoVotacao") or "").split())
        resultado = RESULTADO.get(v.get("resultadoVotacao") or "")
        frase = {"aprovado": "Aprovado.", "rejeitado": "Rejeitado."}.get(resultado or "", "")
        votacoes.append(Votacao(
            id=f"s:{v['codigoSessaoVotacao']}", casa="senado", data=v["dataSessao"], hora=None,
            prop=prop, titulo=titulo, objeto=objeto, resultado_frase=frase, resultado=resultado,
            tipo=tipo_votacao(objeto), evento=sid, votos=votos,
            orientacoes=orientacoes.get(int(v.get("sequencialVotacao") or -1), {}),
            fonte=f"https://www25.senado.leg.br/web/atividade/materias/-/materia/{v['codigoMateria']}" if v.get("codigoMateria") else "",
        ))
    sessoes = []
    for sid, s in sorted(sess.items(), key=lambda kv: kv[1]["data"]):
        presentes = {k for k, codes in s["codes"].items() if codes & PRESENTE}
        ausentes = {k: ("J" if codes == {"J"} or ("J" in codes and "F" not in codes) else "F")
                    for k, codes in s["codes"].items() if k not in presentes}
        sessoes.append(Sessao(sid, "senado", s["data"], presentes, ausentes))
    return votacoes, sessoes, props, senadores
