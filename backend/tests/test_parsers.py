import pytest

from app.parsers.emendas import classify_localidade, iter_csv_file, parse_brl


@pytest.mark.parametrize("s,v", [("1300000,00", 1300000.0), ("1.234.567,89", 1234567.89), ("-500,50", -500.5),
                                 ("0,00", 0.0), ("", 0.0), ("S/I", 0.0)])
def test_parse_brl(s, v):
    assert parse_brl(s) == v


def test_iter_csv_file_latin1(mini_csv):
    rows = list(iter_csv_file(mini_csv))
    assert len(rows) == 5
    r2014, jandira, bancada, relator, multi_sem_uf = rows
    assert r2014.codigo is None and r2014.autor_codigo is None and r2014.ano == 2014
    assert r2014.municipio == "SANTO ANTÔNIO DE PÁDUA" and r2014.localidade_tipo == "municipio"
    assert jandira.codigo == "201517750015" and jandira.autor_codigo == "1775"
    assert jandira.valor_empenhado == 1234567.89 and jandira.valor_pago == -500.5
    assert jandira.localidade_tipo == "uf" and jandira.municipio is None and jandira.uf_ibge == "3300000"
    assert bancada.localidade_tipo == "multiplo" and bancada.municipio is None and bancada.uf_nome == "RIO DE JANEIRO"
    assert multi_sem_uf.localidade_tipo == "multiplo" and multi_sem_uf.uf_nome is None and multi_sem_uf.uf_ibge is None
    assert relator.localidade_tipo == "nacional" and relator.uf_nome is None


def test_classify_localidade():
    assert classify_localidade("NITERÓI - RJ", "3303302", "RIO DE JANEIRO") == "municipio"
    assert classify_localidade("Exterior", None, None) == "exterior"
    assert classify_localidade("Sudeste", None, None) == "outro"
