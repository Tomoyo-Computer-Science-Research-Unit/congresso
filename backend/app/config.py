from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SNAPSHOT_PATH = DATA_DIR / "snapshot.json"



@dataclass(frozen=True, slots=True)
class UfConfig:
    """Everything the ETL needs to know about one state's bancada."""

    sigla: str  # "RJ"
    nome: str  # "Rio de Janeiro"
    preposicao: str  # "do" / "de": "Estado do Rio de Janeiro", "Bancada de São Paulo"
    ibge: str  # two-digit IBGE state code, "33"
    bancada_codigo: str  # SIAFI author code of the state's bancada (RP 7)
    bancada_siafi_nome: str  # name of that code in the CSV
    municipio_aliases: dict[str, str] = field(default_factory=dict)  # SIAFI spelling -> IBGE spelling

    @property
    def bancada_id(self) -> str:
        return f"bancada-{self.sigla.lower()}"

    @property
    def bancada_nome(self) -> str:
        return f"Bancada {self.preposicao} {self.nome}"

    @property
    def uf_ibge_full(self) -> str:
        return f"{self.ibge}00000"  # "Código UF IBGE" as the Portal writes it

    @property
    def snapshot_path(self) -> Path:
        # RJ keeps the original path; other states get their own file.
        return SNAPSHOT_PATH if self.sigla == "RJ" else DATA_DIR / f"snapshot-{self.sigla.lower()}.json"


UFS: dict[str, UfConfig] = {
    "RJ": UfConfig("RJ", "Rio de Janeiro", "do", "33", "7120", "BANCADA DO RIO DE JANEIRO",
                   {"TRAJANO DE MORAIS": "TRAJANO DE MORAES"}),
    "SP": UfConfig("SP", "São Paulo", "de", "35", "7125", "BANCADA DE SAO PAULO",
                   {"EMBU": "EMBU DAS ARTES", "SAO LUIS DO PARAITINGA": "SAO LUIZ DO PARAITINGA",
                    "FLORINIA": "FLORINEA"}),
}
DEFAULT_UF = "RJ"


def uf_config(sigla: str | None = None) -> UfConfig:
    key = (sigla or DEFAULT_UF).upper()
    if key not in UFS:
        raise ValueError(f"UF sem configuração: {sigla!r}; conhecidas: {sorted(UFS)}")
    return UFS[key]


# Portal da Transparencia: the HTML page builds the link
# <base>/download-de-dados/emendas-parlamentares/UNICO which 302-redirects to the S3 object below.
PORTAL_DOWNLOAD_PAGE = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares"
PORTAL_UNICO_URL = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"
PORTAL_ZIP_URL = (
    "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/"
    "emendas-parlamentares/EmendasParlamentares.zip"
)
PORTAL_CSV_MEMBER = "EmendasParlamentares.csv"

CAMARA_API = "https://dadosabertos.camara.leg.br/api/v2"
SENADO_API = "https://legis.senado.leg.br/dadosabertos"

# Legislaturas covering budget years 2014..2027. Budget-year Y amendments are filed in Y-1,
# so the authoring legislature of year Y is the one in office in Y-1.
LEGISLATURAS: dict[int, tuple[str, str]] = {
    54: ("2011-02-01", "2015-01-31"),
    55: ("2015-02-01", "2019-01-31"),
    56: ("2019-02-01", "2023-01-31"),
    57: ("2023-02-01", "2027-01-31"),
}


def legislatura_autora(ano: int) -> int:
    """Legislature that authored the amendments of budget year `ano`."""
    filing_year = ano - 1
    for leg, (ini, _fim) in sorted(LEGISLATURAS.items(), reverse=True):
        if filing_year >= int(ini[:4]):
            return leg
    return min(LEGISLATURAS)
