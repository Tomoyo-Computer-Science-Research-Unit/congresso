from pathlib import Path

from app.parsers.favorecidos import iter_csv_file, slug

FIX = Path(__file__).parent / "fixtures" / "favorecidos_mini.csv"


def test_iter_csv_file_latin1_and_filter():
    rows = list(iter_csv_file(FIX))
    assert len(rows) == 5
    niteroi, niteroi2, pf, generic, unknown = rows
    assert niteroi.codigo_emenda == "201517750015" and niteroi.autor_codigo == "1775"
    assert niteroi.valor == 1234567.89 and niteroi.municipio == "NITERÓI" and niteroi.uf == "RJ"
    assert niteroi.ano == 2024 and niteroi.ano_mes_iso == "2024-03"
    assert niteroi.natureza_juridica == "Município" and niteroi.tipo == "Pessoa Jurídica"
    assert pf.favorecido_codigo == "***.638.223-**" and pf.tipo == "Pessoa Física"  # masked CPF kept as is
    assert generic.tipo == "Inscrição Genérica" and generic.uf is None and generic.municipio is None
    assert unknown.favorecido_codigo == "-8" and unknown.uf is None and unknown.valor == -12.5

    kept = list(iter_csv_file(FIX, keep={"201517750015"}))
    assert [r.codigo_emenda for r in kept] == ["201517750015", "201517750015"]


def test_slug():
    assert slug("29138328000150") == "29138328000150"
    assert slug("***.638.223-**") == "xxx638223xx"
    assert slug("EXELISALO") == "EXELISALO"
    assert slug("-8") == "m8"


def test_collect_aggregates_by_favorecido():
    from app.favorecidos import collect

    rows = iter_csv_file(FIX, keep={"201517750015", "202371200003"})
    favorecidos, recebimentos, stats = collect(rows, {"201517750015": "camara-1", "202371200003": "bancada-rj"})
    assert stats["rows"] == 4 and stats["favorecidos"] == 3 and stats["emendas_com_favorecido"] == 2
    assert [f["codigo"] for f in favorecidos] == ["29138328000150", "***.638.223-**", "-8"]
    niteroi = favorecidos[0]
    assert niteroi["total_recebido"] == 1234667.89 and niteroi["n_emendas"] == 1
    assert niteroi["por_ano"] == {"2024": 1234667.89} and niteroi["por_autor"] == {"camara-1": 1234667.89}
    assert niteroi["nome"] == "MUNICIPIO DE NITEROI" and niteroi["natureza_juridica"] == "Município"
    assert recebimentos[0] == {"codigo_emenda": "201517750015", "autor_id": "camara-1", "ano_mes": "2024-03",
                               "favorecido_codigo": "29138328000150", "valor": 1234567.89}
    assert stats["por_tipo"]["Pessoa Física"] == {"n": 1, "valor": 2581.0}
    assert stats["ano_mes_min"] == "202403" and stats["ano_mes_max"] == "202506"
