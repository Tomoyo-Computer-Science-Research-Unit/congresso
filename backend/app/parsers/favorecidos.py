"""Parser for Portal da Transparencia 'EmendasParlamentares_PorFavorecido.csv'.

Same conventions as ``emendas.py`` (latin-1, ';', BR numbers). The file is big (182 MB, ~830k
rows), so ``iter_rows`` streams and takes an optional ``keep`` set of amendment codes: rows for
other codes are skipped before any parsing. CPFs of pessoas fisicas arrive partially masked by
the Portal (``***.638.223-**``); they are kept exactly as given and never reconstructed.
"""
from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .emendas import MISSING, parse_brl

MEMBER = "EmendasParlamentares_PorFavorecido.csv"
EXPECTED_COLUMNS = [
    "Código da Emenda", "Código do Autor da Emenda", "Nome do Autor da Emenda", "Número da emenda",
    "Tipo de Emenda", "Ano/Mês", "Código do Favorecido", "Favorecido", "Natureza Jurídica",
    "Tipo Favorecido", "UF Favorecido", "Município Favorecido", "Valor Recebido",
]
# The Portal truncates one label ("Inscrição Genéric") on part of the rows.
TIPO_FIX = {"Inscrição Genéric": "Inscrição Genérica", "Pessoa Fisica": "Pessoa Física"}
SEM_INFORMACAO = "Sem informação"


def _opt(s: str) -> str | None:
    s = (s or "").strip()
    return None if s in MISSING or s == "-1" else s


@dataclass(frozen=True, slots=True)
class FavorecidoRow:
    codigo_emenda: str
    autor_codigo: str | None
    autor_nome: str | None
    numero: str | None
    tipo_emenda: str
    ano_mes: str  # "YYYYMM" as given
    favorecido_codigo: str  # CNPJ, masked CPF, UG code or generic inscription; "-8" = unknown
    favorecido: str
    natureza_juridica: str
    tipo: str  # Pessoa Jurídica | Pessoa Física | Unidade Gestora | Inscrição Genérica | Sem informação
    uf: str | None
    municipio: str | None
    valor: float

    @property
    def ano(self) -> int:
        return int(self.ano_mes[:4])

    @property
    def ano_mes_iso(self) -> str:
        return f"{self.ano_mes[:4]}-{self.ano_mes[4:6]}"


def parse_row(d: dict[str, str]) -> FavorecidoRow:
    tipo = d["Tipo Favorecido"].strip()
    return FavorecidoRow(
        codigo_emenda=d["Código da Emenda"].strip(),
        autor_codigo=_opt(d["Código do Autor da Emenda"]),
        autor_nome=_opt(d["Nome do Autor da Emenda"]),
        numero=_opt(d["Número da emenda"]),
        tipo_emenda=d["Tipo de Emenda"].strip(),
        ano_mes=d["Ano/Mês"].strip(),
        favorecido_codigo=d["Código do Favorecido"].strip(),
        favorecido=d["Favorecido"].strip(),
        natureza_juridica=_opt(d["Natureza Jurídica"]) or SEM_INFORMACAO,
        tipo=TIPO_FIX.get(tipo, tipo) or SEM_INFORMACAO,
        uf=_opt(d["UF Favorecido"]),
        municipio=_opt(d["Município Favorecido"]),
        valor=parse_brl(d["Valor Recebido"]),
    )


def iter_rows(text_stream: io.TextIOBase, keep: set[str] | None = None) -> Iterator[FavorecidoRow]:
    reader = csv.DictReader(text_stream, delimiter=";", quotechar='"')
    cols = reader.fieldnames or []
    missing = [c for c in EXPECTED_COLUMNS if c not in cols]
    if missing:
        raise ValueError(f"CSV layout changed; missing columns: {missing}; got {cols}")
    for d in reader:
        if keep is not None and d["Código da Emenda"] not in keep:
            continue
        yield parse_row(d)


def iter_csv_file(path: Path, keep: set[str] | None = None, encoding: str = "latin-1") -> Iterator[FavorecidoRow]:
    with path.open("r", encoding=encoding, newline="") as f:
        yield from iter_rows(f, keep)


def iter_zip_member(zip_path: Path, keep: set[str] | None = None, member: str = MEMBER,
                    encoding: str = "latin-1") -> Iterator[FavorecidoRow]:
    with zipfile.ZipFile(zip_path) as z, z.open(member) as raw:
        yield from iter_rows(io.TextIOWrapper(raw, encoding=encoding, newline=""), keep)


def slug(codigo: str) -> str:
    """File/URL-safe key for a favorecido code. CNPJ/UG codes are digits and stay as they are;
    masked CPFs '***.638.223-**' become 'xxx638223xx' (lower-case x cannot collide with the
    upper-case generic inscriptions such as 'EXELISALO')."""
    out = []
    for ch in codigo:
        if ch.isalnum():
            out.append(ch)
        elif ch == "*":
            out.append("x")
        elif ch == "-" and not out:
            out.append("m")  # "-8" -> "m8"
    return "".join(out) or "vazio"
