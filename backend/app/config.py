from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SNAPSHOT_PATH = DATA_DIR / "snapshot.json"

UF = "RJ"
UF_NOME = "RIO DE JANEIRO"
BANCADA_RJ_CODIGO = "7120"  # SIAFI author code of "BANCADA DO RIO DE JANEIRO"

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
