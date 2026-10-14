from app.config import legislatura_autora
from app.match import Matcher
from app.names import normalize, split_siafi_author


def test_normalize():
    assert normalize("Chico D'Angelo") == "CHICO DANGELO"
    assert normalize("  Romário  ") == "ROMARIO"
    assert normalize("JOÃO BATISTA DA ROCHA LEMOS") == "JOAO BATISTA DA ROCHA LEMOS"


def test_split_siafi_author():
    cur, former = split_siafi_author("TIAGO DIMAS (EX-PARLAMENTAR LAZARO BOTELHO, NOS TERMOS ART. 78 LDO 2025 E DA MENSAGEM 95-CN, DE 06.11.25)")
    assert (cur, former) == ("TIAGO DIMAS", "LAZARO BOTELHO")
    assert split_siafi_author("JANDIRA FEGHALI") == ("JANDIRA FEGHALI", None)
    # truncated parenthesis still parses
    cur, former = split_siafi_author("MISSIONARIO JOSE OLIMPIO (EX-PARLAMENTAR EDUARDO BOLSONARO, NOS TERMOS DA DECISAO ADPF 854, DE 03")
    assert (cur, former) == ("MISSIONARIO JOSE OLIMPIO", "EDUARDO BOLSONARO")


def test_legislatura_autora():
    assert legislatura_autora(2015) == 54
    assert legislatura_autora(2016) == 55
    assert legislatura_autora(2019) == 55
    assert legislatura_autora(2020) == 56
    assert legislatura_autora(2024) == 57


def test_matcher(mini_roster):
    m = Matcher(mini_roster)
    assert m.match("JANDIRA FEGHALI", 2015).quality == "strict"          # leg 54
    assert m.match("JANDIRA FEGHALI", 2016).quality == "strict"          # leg 55
    r = m.match("JANDIRA FEGHALI", 2024)                                 # leg 57: not in roster, name unique -> loose
    assert (r.autor_id, r.quality) == ("camara-74848", "loose")
    assert m.match("ROMARIO", 2017).autor_id == "senado-5322"            # nome_parlamentar, accent-insensitive
    assert m.match("MARCELO RAMOS", 2024).quality == "collision"         # homonym elsewhere, wrong legislature
    assert m.match("MARCELO RAMOS", 2017).quality == "strict"            # right legislature wins, collision logged
    assert "MARCELO RAMOS" in m.stats.collisions
    assert m.match("FULANO", 2017).quality == "none"
