"""Votações nominais e presença: parsers da Câmara e do Senado, exercício, agregados e saída por UF."""
from __future__ import annotations

import json
from pathlib import Path

from app.etl import export_votos as ev
from app.votos import camara, senado
from app.votos.camara import Exercicio

FIX = Path(__file__).parent / "fixtures" / "votos"


def test_resultado_frase_strips_placar():
    assert camara.resultado_frase("Rejeitado o Requerimento. Sim: 22; não: 246; total: 274.") == "Rejeitado o Requerimento."
    assert camara.resultado_frase("Mantido o texto destacado.Sim: 3; não: 4") == "Mantido o texto destacado."
    assert camara.resultado_frase("Aprovado o Parecer") == "Aprovado o Parecer."


def test_tipo_votacao():
    assert camara.tipo_votacao("Votação do Requerimento do Dep. X que solicita a retirada de pauta.") == "requerimento"
    assert camara.tipo_votacao("Votação da Emenda nº 193, objeto do Destaque da bancada do PRB.") == "destaque"
    assert camara.tipo_votacao("Votação do art. 2º da Proposta de Emenda à Constituição nº 358 de 2013") == "destaque"
    assert camara.tipo_votacao("Votação em segundo turno.") == "texto"
    assert camara.tipo_votacao("Aprovada, em segundo turno, a Proposta de Emenda à Constituição nº 197 de 2012.") == "texto"


def test_exercise_intervals_licenca_e_partido():
    hist = [
        {"dataHora": "2023-02-01T10:00", "situacao": "Exercício", "siglaPartido": "PT", "siglaUf": "RJ"},
        {"dataHora": "2023-06-01T12:00", "situacao": "Afastado", "siglaPartido": "PT", "siglaUf": "RJ"},
        {"dataHora": "2023-10-01T09:00", "situacao": "Exercício", "siglaPartido": "PT", "siglaUf": "RJ"},
        {"dataHora": "2024-03-05T18:00", "situacao": "Exercício", "siglaPartido": "PSB", "siglaUf": "RJ"},
        {"dataHora": "2027-01-31T23:59", "situacao": "FIM_MANDATO", "siglaPartido": "PSB", "siglaUf": "RJ"},
        {"dataHora": "2027-02-01T00:00", "situacao": None, "siglaPartido": "PSB", "siglaUf": "RJ"},
    ]
    ivs = camara.exercise_intervals(hist)
    assert [(e.inicio, e.fim, e.partido) for e in ivs] == [
        ("2023-02-01", "2023-06-01", "PT"), ("2023-10-01", "2024-03-05", "PT"), ("2024-03-05", "2027-02-01", "PSB")]
    assert camara.exercise_on(ivs, "2023-05-31").partido == "PT"
    assert camara.exercise_on(ivs, "2023-06-01") is None  # licença começa no dia
    assert camara.exercise_on(ivs, "2023-08-10") is None
    assert camara.exercise_on(ivs, "2027-01-31").partido == "PSB"  # saída às 23:59 conta o dia
    assert camara.exercise_on(ivs, "2027-02-01") is None


def test_camara_parse_year_plenario_nominal():
    vots, sess, props, deps = camara.parse_year(FIX / "camara", 2023)
    ids = [v.id for v in vots]
    # CCJC fica fora; a votação de plenário sem voto nominal (simbólica) também
    assert ids == ["c:100-1", "c:100-2"]
    v1, v2 = vots
    assert v1.titulo == "PL 1/2023" and props["c:100"].ementa == "Dispõe sobre coisas."
    assert v1.resultado == "aprovado" and v2.resultado == "rejeitado"
    assert v1.objeto == "Votação em turno único." and v1.resultado_frase == "Aprovado o Projeto de Lei nº 1 de 2023."
    assert v2.tipo == "requerimento" and v1.tipo == "texto"
    assert v1.orientacoes == {"Governo": "N", "PT": "S"} and v2.orientacoes == {"Governo": "L"}
    assert v1.votos["camara-3"] == ("N", "PL", "SP")
    assert v2.votos["camara-4"][0] == "A"
    # sessões deliberativas de plenário não canceladas e com presença registrada
    assert [(s.id, s.data, sorted(s.presentes)) for s in sess] == [
        ("9001", "2023-03-14", ["camara-1", "camara-2", "camara-3", "camara-4", "camara-5"]),
        ("9004", "2023-03-16", ["camara-1", "camara-3"])]
    assert deps["camara-1"]["nome"] == "Ana"


def test_camara_api_fills_missing_votes():
    calls = []

    def api(vid):
        calls.append(vid)
        return [{"tipoVoto": "Sim", "deputado_": {"id": 7, "nome": "Gil", "siglaPartido": "PSB", "siglaUf": "RJ"}}]

    vots, *_ = camara.parse_year(FIX / "camara", 2023, api)
    # 100-4 é simbólica (placar 0-0-0) e não vai à API; 100-5 tem placar e nenhum voto no arquivo
    assert calls == ["100-5"]
    assert [v.id for v in vots] == ["c:100-1", "c:100-2", "c:100-5"]
    assert vots[2].votos == {"camara-7": ("S", "PSB", "RJ")} and vots[2].tipo == "destaque"


def test_senado_parse_year():
    ori = senado.parse_orientacoes([FIX / "senado" / "orientacao-2023-05.json"])
    vots, sess, props, sens = senado.parse_year(FIX / "senado" / "votacoes-2023.json", ori)
    assert [v.id for v in vots] == ["s:11", "s:13"]  # secreta e sem votos ficam fora da lista
    v11, v13 = vots
    assert v11.orientacoes == {"Governo": "S", "PT": "S", "PL": "L"}
    assert v11.votos["senado-12"][0] == "J" and v11.votos["senado-13"][0] == "P" and v11.votos["senado-14"][0] == "F"
    assert v13.resultado == "rejeitado" and v13.tipo == "requerimento"
    assert props["s:500"].titulo == "PL 5/2023"
    # presença por sessão: a secreta conta; Vera votou na secreta, então esteve na sessão 1
    s1, s2 = sess
    assert s1.presentes == {"senado-10", "senado-11", "senado-13", "senado-14"}
    assert s1.ausentes == {"senado-12": "J"}
    assert s2.ausentes == {"senado-10": "J", "senado-11": "F"}
    assert "senado-12" in s2.presentes  # P-NRV: presente sem voto


def _dados() -> ev.Dados:
    d = ev.Dados()
    v, s, p, m = camara.parse_year(FIX / "camara", 2023)
    d.votacoes += v; d.sessoes += s; d.props.update(p); d.pessoas.update(m)
    ori = senado.parse_orientacoes([FIX / "senado" / "orientacao-2023-05.json"])
    v, s, p, m = senado.parse_year(FIX / "senado" / "votacoes-2023.json", ori)
    d.votacoes += v; d.sessoes += s; d.props.update(p); d.pessoas.update(m)
    full = [Exercicio("2023-02-01", "2027-02-01", "PT", "RJ")]
    exercicio = {
        "camara-1": full, "camara-2": full, "camara-3": [Exercicio("2023-02-01", "2027-02-01", "PL", "SP")],
        "camara-4": [Exercicio("2023-02-01", "2027-02-01", "PL", "RJ")],
        "camara-5": [Exercicio("2023-02-01", "2027-02-01", "PSOL", "RJ")],
        "camara-6": [Exercicio("2023-02-01", "2023-03-01", "PP", "RJ")],  # saiu antes
    }
    ev.complete(d, offline=True, exercicio=exercicio)
    return d


def test_complete_adds_absent_and_present_without_vote():
    d = _dados()
    v1 = next(v for v in d.votacoes if v.id == "c:100-1")
    assert v1.votos["camara-5"] == ("X", "PSOL", "RJ")  # presente na sessão 9001, não votou
    assert "camara-6" not in v1.votos
    assert d.ausencias_sessao["9004"] == {"camara-2": "F", "camara-4": "F", "camara-5": "F"}


def test_ordinais_por_casa():
    d = _dados()
    pos = ev.ordinais(d.votacoes)
    assert pos == {"c:100-1": 0, "c:100-2": 1, "s:11": 0, "s:13": 1}
    assert [v.id for v in ev.ordem(d.votacoes)][:2] == ["s:13", "s:11"]


def test_derive_and_flags():
    d = _dados()
    v1 = next(v for v in d.votacoes if v.id == "c:100-1")
    der = ev.derive(v1)
    assert der.contagem == {"S": 3, "N": 1, "X": 1}
    assert der.maioria == "S" and der.governo == "N"
    assert der.partidos == {"PT": [2, 0, 0, 0], "PL": [1, 1, 0, 0]}
    assert der.maioria_partido == {"PT": "S", "PL": None}
    f = ev.flags_for("S", "PT", der)
    assert f == ev.FLAG_PARTIDO_MAIORIA | ev.FLAG_GOVERNO_ORIENTOU | ev.FLAG_CONTRA_GOVERNO
    f = ev.flags_for("N", "PL", der)
    assert f == ev.FLAG_CONTRA_MAIORIA | ev.FLAG_GOVERNO_ORIENTOU  # partido empatado: sem maioria
    assert ev.flags_for("X", "PSOL", der) == 0


def test_write_uf(tmp_path):
    d = _dados()
    derived = {v.id: ev.derive(v) for v in d.votacoes}
    snapshot = {
        "roster": [
            {"id": "camara-1", "nome": "ANA SILVA", "nome_parlamentar": "ANA", "ids": {"camara": "1", "senado": "10"}},
            {"id": "camara-2", "nome": "BRUNO", "nome_parlamentar": "BRUNO", "ids": {"camara": "2"}},
        ],
        "autores": [{"id": "camara-1"}, {"id": "bancada-rj"}],
    }
    res = ev.write_uf("RJ", d, derived, {}, snapshot=snapshot, out=tmp_path)
    bancada = json.loads((tmp_path / "static-bancada.generated.json").read_text())
    pessoas = {p["id"]: p for p in bancada["pessoas"]}
    # Ana foi deputada (camara-1) e é a senadora Rita (senado-10) no roster: uma pessoa, duas casas
    assert pessoas["camara-1"]["casas"] == ["camara", "senado"] and pessoas["camara-1"]["autor"] is True
    assert "camara-3" not in pessoas and "senado-13" not in pessoas  # SP
    assert pessoas["camara-5"]["autor"] is False
    votos = json.loads((tmp_path / "static-votos" / "2023.generated.json").read_text())
    assert votos["m"]["camara"] == ["camara-1", "camara-2", "camara-4", "camara-5"]
    assert votos["v"]["c:100-1"] == "SSSX" and votos["v"]["c:100-2"] == "SNAX"
    assert votos["m"]["senado"] == ["camara-1", "senado-11", "senado-12"]
    assert votos["v"]["s:11"] == "SNJ" and votos["v"]["s:13"] == "JFX"
    ana = json.loads((tmp_path / "static-parlamentares" / "camara-1.generated.json").read_text())
    # posições por casa, da mais antiga: c:100-1 = 0, c:100-2 = 1; s:11 = 0, s:13 = 1
    assert ana["camara"][:2] == [0, "SS"] and ana["senado"][:2] == [0, "SJ"]
    flags = ev.FLAG_CHARS.index(ana["camara"][2][0])
    assert flags == ev.flags_for("S", "PT", ev.derive(next(v for v in d.votacoes if v.id == "c:100-1")))
    # presença: camara-2 faltou à sessão 9004; senado-11 faltou à sessão 2 (NCom); senado-12 justificou a 1
    pres = bancada["presenca"]
    assert pres["camara-2"]["2023-03"] == [1, 0, 2]
    assert pres["senado-11"]["2023-05"] == [1, 0, 2]
    assert pres["senado-12"]["2023-05"] == [0, 1, 2]
    # Ana: duas sessões da Câmara em março e duas do Senado em maio (uma justificada)
    assert pres["camara-1"] == {"2023-03": [0, 0, 2], "2023-05": [0, 1, 2]}
    assert res["com_votos"] == 6


def test_senado_drops_records_with_wrong_people():
    # Os registros de 2015-2016 do /votacao listam senadores de outras décadas; ficam fora.
    path = FIX / "senado" / "votacoes-2023.json"
    todos = {"10", "11", "12", "13", "14"}
    descartadas: list[dict] = []
    vots, sess, *_ = senado.parse_year(path, {}, todos, descartadas)
    assert len(vots) == 2 and descartadas == []
    vots, sess, *_ = senado.parse_year(path, {}, {"10"}, descartadas)  # 4 estranhos em cada
    assert vots == [] and sess == []
    assert [x["id"] for x in descartadas] == [11, 12, 13]
    assert senado.codigos_validos([]) == set()
