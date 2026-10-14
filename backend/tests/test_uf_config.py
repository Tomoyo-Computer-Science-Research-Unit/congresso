import pytest

from app import config


def test_uf_configs():
    rj, sp = config.uf_config("RJ"), config.uf_config("sp")
    assert (rj.bancada_id, rj.bancada_codigo, rj.uf_ibge_full) == ("bancada-rj", "7120", "3300000")
    assert (sp.bancada_id, sp.bancada_codigo, sp.uf_ibge_full) == ("bancada-sp", "7125", "3500000")
    assert sp.bancada_nome == "Bancada de São Paulo" and rj.bancada_nome == "Bancada do Rio de Janeiro"
    assert rj.snapshot_path == config.SNAPSHOT_PATH and sp.snapshot_path.name == "snapshot-sp.json"
    with pytest.raises(ValueError):
        config.uf_config("XX")
