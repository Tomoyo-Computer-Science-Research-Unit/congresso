from app.etl.export_static_frontend import favorecidos_section, municipio_key


def test_municipio_key_normalises_and_aliases():
    assert municipio_key("SÃO JOÃO DE MERITI") == municipio_key("São João de Meriti")
    assert municipio_key("TRAJANO DE MORAIS") == municipio_key("Trajano de Moraes")


def test_favorecidos_section_tops_and_files():
    snapshot = {
        "favorecidos": [
            {"codigo": "1", "nome": "FUNDO A", "natureza_juridica": "Município", "tipo": "Pessoa Jurídica", "uf": "RJ",
             "municipio": "NITERÓI", "total_recebido": 300.0, "por_ano": {"2024": 300.0}, "por_autor": {"a": 200.0, "b": 100.0}, "n_emendas": 2},
            {"codigo": "***.1-**", "nome": "PESSOA", "natureza_juridica": "Sem informação", "tipo": "Pessoa Física", "uf": "SP",
             "municipio": "SANTOS", "total_recebido": 5.0, "por_ano": {"2025": 5.0}, "por_autor": {"a": 5.0}, "n_emendas": 1},
        ],
        "recebimentos": [
            {"codigo_emenda": "e1", "autor_id": "a", "ano_mes": "2024-01", "favorecido_codigo": "1", "valor": 200.0},
            {"codigo_emenda": "e2", "autor_id": "b", "ano_mes": "2024-02", "favorecido_codigo": "1", "valor": 100.0},
            {"codigo_emenda": "e3", "autor_id": "a", "ano_mes": "2025-03", "favorecido_codigo": "***.1-**", "valor": 5.0},
        ],
    }
    out = favorecidos_section(snapshot, {"3303302": "Niterói"}, {"e1": "Niterói", "e2": None, "e3": None})
    assert [f["codigo"] for f in out["top"]] == ["1", "***.1-**"]
    assert out["top"][0]["n_autores"] == 2 and out["top"][0]["municipio"] == "Niterói" and out["top"][0]["slug"] == "1"
    assert out["por_tipo"]["Pessoa Física"] == {"n_favorecidos": 1, "n_recebimentos": 1, "valor": 5.0}
    assert out["por_natureza"]["Município"]["valor"] == 300.0
    assert [x["codigo"] for x in out["autores"]["a"]] == ["1", "***.1-**"] and out["autores"]["a"][0]["valor"] == 200.0
    assert list(out["destinos"]) == ["3303302"] and out["destinos"]["3303302"][0]["valor"] == 300.0  # SP favorecido excluded
    assert set(out["arquivos"]) == {"1", "xxx1xx"}
    assert out["arquivos"]["1"][0] == {"c": "e1", "au": "a", "am": "2024-01", "v": 200.0, "mn": "Niterói"}
    assert out["stats"]["municipios_uf_sem_ibge"] == {}


def test_municipio_key_sp_aliases():
    from app.config import uf_config

    aliases = uf_config("SP").municipio_aliases
    assert municipio_key("EMBU", aliases) == municipio_key("Embu das Artes", aliases)
    assert municipio_key("SÃO LUÍS DO PARAITINGA", aliases) == municipio_key("São Luiz do Paraitinga", aliases)
    assert municipio_key("SANTA BARBARA D'OESTE", aliases) == municipio_key("Santa Bárbara d'Oeste", aliases)


def test_favorecidos_section_sp_limits_split_core_and_extra():
    from app.etl.export_static_frontend import Limits

    snapshot = {
        "favorecidos": [
            {"codigo": str(i), "nome": f"F{i}", "natureza_juridica": "Município", "tipo": "Pessoa Jurídica", "uf": "SP",
             "municipio": "SANTOS", "total_recebido": 100.0 - i, "por_ano": {"2024": 100.0 - i}, "por_autor": {"a": 100.0 - i}, "n_emendas": 1}
            for i in range(4)
        ],
        "recebimentos": [
            {"codigo_emenda": f"e{i}", "autor_id": "a", "ano_mes": "2024-01", "favorecido_codigo": str(i), "valor": 100.0 - i}
            for i in range(4)
        ],
    }
    out = favorecidos_section(snapshot, {"3548500": "Santos"}, {}, "SP",
                              Limits(top_favorecidos=1, favorecidos_por_lista=3, detalhe_min=None, nucleo_so_top=True))
    assert [f["codigo"] for f in out["top"]] == ["0"]
    assert [f["codigo"] for f in out["extra"]] == ["1", "2"]  # reachable from lists, outside the core
    assert set(out["arquivos"]) == {"0", "1", "2"}
    assert list(out["destinos"]) == ["3548500"]
