from collections import Counter
from types import SimpleNamespace

from app import config
from app.etl.export_snapshot import match_by_code, resolve_cross_uf


def row(code: str, dest_uf_ibge: str = "") -> SimpleNamespace:
    return SimpleNamespace(autor_codigo=code, uf_ibge=dest_uf_ibge)


def state(uf: str, candidates):
    return SimpleNamespace(ufc=config.uf_config(uf), candidates=list(candidates),
                           matcher=SimpleNamespace(stats=SimpleNamespace(by_quality=Counter())))


def test_loose_loses_to_strict_in_other_uf():
    r1, r2 = row("2792"), row("2792")
    rj = state("RJ", [(1, r1, "p", "strict"), (2, r2, "p", "loose")])
    df = state("DF", [(1, r1, "p", "loose"), (2, r2, "p", "strict")])
    drop = resolve_cross_uf([rj, df])
    assert drop["RJ"] == {2} and drop["DF"] == {1}


def test_strict_homonyms_go_to_uf_with_more_rows_of_the_code():
    rows = [row("3672", "5200000") for _ in range(3)]
    # GO matches all three (one with the full civil name); MS matches two of them.
    go = state("GO", [(i, r, "go-person", "strict") for i, r in enumerate(rows)])
    ms = state("MS", [(i, r, "ms-person", "strict") for i, r in enumerate(rows[:2])])
    drop = resolve_cross_uf([go, ms])
    assert drop["GO"] == set() and drop["MS"] == {0, 1}


def test_unmatched_row_follows_its_siafi_code():
    known, unknown = row("4181"), row("4181")
    ms = state("MS", [(1, known, "senado-1", "strict")])
    match_by_code([ms], [(1, known), (2, unknown)])
    assert (2, unknown, "senado-1", "codigo") in ms.candidates
