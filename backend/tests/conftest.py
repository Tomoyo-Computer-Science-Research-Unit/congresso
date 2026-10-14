import json
from pathlib import Path

import pytest

from app.roster import Mandato, Pessoa, Roster

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def mini_csv() -> Path:
    return FIX / "emendas_mini.csv"


@pytest.fixture
def mini_roster() -> Roster:
    d = json.loads((FIX / "roster_mini.json").read_text(encoding="utf-8"))
    pessoas = [
        Pessoa(id=p["id"], nome=p["nome"], nome_parlamentar=p["nome_parlamentar"], casa=p["casa"], ids=p["ids"],
               foto=p["foto"], mandatos=[Mandato(**m) for m in p["mandatos"]])
        for p in d["pessoas"]
    ]
    return Roster(pessoas=pessoas, national_names={k: set(v) for k, v in d["national_names"].items()}, sources=[])
