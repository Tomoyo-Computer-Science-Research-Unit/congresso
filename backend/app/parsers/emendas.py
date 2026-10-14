"""Parser for Portal da Transparencia 'EmendasParlamentares.csv' (latin-1, ';', BR numbers)."""
from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

EXPECTED_COLUMNS = [
    "Código da Emenda", "Ano da Emenda", "Tipo de Emenda", "Código do Autor da Emenda",
    "Nome do Autor da Emenda", "Número da emenda", "Localidade de aplicação do recurso",
    "Código Município IBGE", "Município", "Código UF IBGE", "UF", "Região",
    "Código Função", "Nome Função", "Código Subfunção", "Nome Subfunção",
    "Código Programa", "Nome Programa", "Código Ação", "Nome Ação",
    "Código Plano Orçamentário", "Nome Plano Orçamentário",
    "Valor Empenhado", "Valor Liquidado", "Valor Pago",
    "Valor Restos A Pagar Inscritos", "Valor Restos A Pagar Cancelados", "Valor Restos A Pagar Pagos",
]
MISSING = {"", "S/I", "Sem informação", "Sem informacao", "Múltiplo", "Multiplo", "-14"}


def parse_brl(s: str) -> float:
    """'1.300.000,50' or '1300000,50' -> 1300000.5 ; blanks -> 0.0."""
    s = (s or "").strip()
    if s in MISSING:
        return 0.0
    neg = s.startswith("-")
    s = s.lstrip("-").replace(".", "").replace(",", ".")
    v = float(s)
    return -v if neg else v


def _opt(s: str) -> str | None:
    s = (s or "").strip()
    return None if s in MISSING else s


@dataclass(frozen=True, slots=True)
class EmendaRow:
    codigo: str | None
    ano: int
    tipo: str
    autor_codigo: str | None
    autor_nome: str | None
    numero: str | None
    localidade_raw: str
    localidade_tipo: str  # municipio | uf | nacional | multiplo | exterior | outro
    municipio_ibge: str | None
    municipio: str | None
    uf_ibge: str | None
    uf_nome: str | None
    regiao: str | None
    funcao_cod: str | None
    funcao: str | None
    subfuncao_cod: str | None
    subfuncao: str | None
    programa_cod: str | None
    programa: str | None
    acao_cod: str | None
    acao: str | None
    plano_orc_cod: str | None
    plano_orc: str | None
    valor_empenhado: float
    valor_liquidado: float
    valor_pago: float
    rp_inscrito: float
    rp_cancelado: float
    rp_pago: float


def classify_localidade(raw: str, municipio_ibge: str | None, uf_nome: str | None) -> str:
    r = (raw or "").strip()
    if municipio_ibge:
        return "municipio"
    u = r.upper()
    if u == "NACIONAL":
        return "nacional"
    if u.startswith("MÚLTIPLO") or u.startswith("MULTIPLO"):
        return "multiplo"
    if u.endswith("(UF)") or (uf_nome and u == uf_nome.upper()):
        return "uf"
    if "EXTERIOR" in u:
        return "exterior"
    return "outro"


def parse_row(d: dict[str, str]) -> EmendaRow:
    mun_ibge = _opt(d["Código Município IBGE"])
    uf_nome = _opt(d["UF"])
    raw_loc = d["Localidade de aplicação do recurso"]
    return EmendaRow(
        codigo=_opt(d["Código da Emenda"]),
        ano=int(d["Ano da Emenda"]),
        tipo=d["Tipo de Emenda"].strip(),
        autor_codigo=_opt(d["Código do Autor da Emenda"]),
        autor_nome=_opt(d["Nome do Autor da Emenda"]),
        numero=_opt(d["Número da emenda"]),
        localidade_raw=raw_loc,
        localidade_tipo=classify_localidade(raw_loc, mun_ibge, uf_nome),
        municipio_ibge=mun_ibge,
        municipio=_opt(d["Município"]),
        uf_ibge=_opt(d["Código UF IBGE"]),
        uf_nome=uf_nome,
        regiao=_opt(d["Região"]),
        funcao_cod=_opt(d["Código Função"]),
        funcao=_opt(d["Nome Função"]),
        subfuncao_cod=_opt(d["Código Subfunção"]),
        subfuncao=_opt(d["Nome Subfunção"]),
        programa_cod=_opt(d["Código Programa"]),
        programa=_opt(d["Nome Programa"]),
        acao_cod=_opt(d["Código Ação"]),
        acao=_opt(d["Nome Ação"]),
        plano_orc_cod=_opt(d["Código Plano Orçamentário"]),
        plano_orc=_opt(d["Nome Plano Orçamentário"]),
        valor_empenhado=parse_brl(d["Valor Empenhado"]),
        valor_liquidado=parse_brl(d["Valor Liquidado"]),
        valor_pago=parse_brl(d["Valor Pago"]),
        rp_inscrito=parse_brl(d["Valor Restos A Pagar Inscritos"]),
        rp_cancelado=parse_brl(d["Valor Restos A Pagar Cancelados"]),
        rp_pago=parse_brl(d["Valor Restos A Pagar Pagos"]),
    )


def iter_rows(text_stream: io.TextIOBase) -> Iterator[EmendaRow]:
    reader = csv.DictReader(text_stream, delimiter=";", quotechar='"')
    cols = reader.fieldnames or []
    missing = [c for c in EXPECTED_COLUMNS if c not in cols]
    if missing:
        raise ValueError(f"CSV layout changed; missing columns: {missing}; got {cols}")
    for d in reader:
        yield parse_row(d)


def iter_csv_file(path: Path, encoding: str = "latin-1") -> Iterator[EmendaRow]:
    with path.open("r", encoding=encoding, newline="") as f:
        yield from iter_rows(f)


def iter_zip_member(zip_path: Path, member: str, encoding: str = "latin-1") -> Iterator[EmendaRow]:
    with zipfile.ZipFile(zip_path) as z, z.open(member) as raw:
        yield from iter_rows(io.TextIOWrapper(raw, encoding=encoding, newline=""))
