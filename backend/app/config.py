from __future__ import annotations

import unicodedata
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
    def pelo(self) -> str:
        return {"do": "pelo", "da": "pela", "de": "por"}[self.preposicao]

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


# sigla, nome, preposicao, IBGE, codigo SIAFI da bancada (71xx, um por UF no CSV do Portal), nome no CSV
_UFS_RAW = [
    ("AC", "Acre", "do", "12", "7102", "BANCADA DO ACRE"),
    ("AL", "Alagoas", "de", "27", "7103", "BANCADA DE ALAGOAS"),
    ("AM", "Amazonas", "do", "13", "7104", "BANCADA DO AMAZONAS"),
    ("AP", "Amapá", "do", "16", "7105", "BANCADA DO AMAPA"),
    ("BA", "Bahia", "da", "29", "7106", "BANCADA DA BAHIA"),
    ("CE", "Ceará", "do", "23", "7107", "BANCADA DO CEARA"),
    ("DF", "Distrito Federal", "do", "53", "7108", "BANCADA DO DISTRITO FEDERAL"),
    ("ES", "Espírito Santo", "do", "32", "7109", "BANCADA DO ESPIRITO SANTO"),
    ("GO", "Goiás", "de", "52", "7110", "BANCADA DE GOIAS"),
    ("MA", "Maranhão", "do", "21", "7111", "BANCADA DO MARANHAO"),
    ("MT", "Mato Grosso", "de", "51", "7112", "BANCADA DO MATO GROSSO"),
    ("MS", "Mato Grosso do Sul", "de", "50", "7113", "BANCADA DO MATO GROSSO DO SUL"),
    ("MG", "Minas Gerais", "de", "31", "7114", "BANCADA DE MINAS GERAIS"),
    ("PA", "Pará", "do", "15", "7115", "BANCADA DO PARA"),
    ("PB", "Paraíba", "da", "25", "7116", "BANCADA DA PARAIBA"),
    ("PR", "Paraná", "do", "41", "7117", "BANCADA DO PARANA"),
    ("PE", "Pernambuco", "de", "26", "7118", "BANCADA DE PERNAMBUCO"),
    ("PI", "Piauí", "do", "22", "7119", "BANCADA DO PIAUI"),
    ("RJ", "Rio de Janeiro", "do", "33", "7120", "BANCADA DO RIO DE JANEIRO"),
    ("RN", "Rio Grande do Norte", "do", "24", "7121", "BANCADA DO RIO GRANDE DO NORTE"),
    ("RS", "Rio Grande do Sul", "do", "43", "7122", "BANCADA DO RIO GRANDE DO SUL"),
    ("RO", "Rondônia", "de", "11", "7123", "BANCADA DE RONDONIA"),
    ("RR", "Roraima", "de", "14", "7124", "BANCADA DE RORAIMA"),
    ("SC", "Santa Catarina", "de", "42", "7126", "BANCADA DE SANTA CATARINA"),
    ("SP", "São Paulo", "de", "35", "7125", "BANCADA DE SAO PAULO"),
    ("SE", "Sergipe", "de", "28", "7127", "BANCADA DE SERGIPE"),
    ("TO", "Tocantins", "do", "17", "7128", "BANCADA DE TOCANTINS"),
]
# Grafia do municipio no arquivo de favorecidos -> grafia do IBGE (normalizada por municipio_key).
_ALIASES: dict[str, dict[str, str]] = {
    "RJ": {"TRAJANO DE MORAIS": "TRAJANO DE MORAES"},
    "SP": {"EMBU": "EMBU DAS ARTES", "SAO LUIS DO PARAITINGA": "SAO LUIZ DO PARAITINGA", "FLORINIA": "FLORINEA"},
    "BA": {"SANTA TERESINHA": "SANTA TEREZINHA", "MUQUEM DE SAO FRANCISCO": "MUQUEM DO SAO FRANCISCO"},
    "CE": {"ITAPAGE": "ITAPAJE"},
    # BOA ESPERANCA DO NORTE (MT) foi instalado depois do Censo 2022 e fica sem codigo IBGE aqui.
    "MT": {"SANTO ANTONIO DO LEVERGER": "SANTO ANTONIO DE LEVERGER", "POXOREO": "POXOREU"},
    "MG": {"BARAO DE MONTE ALTO": "BARAO DO MONTE ALTO", "DONA EUSEBIA": "DONA EUZEBIA", "BRASOPOLIS": "BRAZOPOLIS",
           "SAO THOME DAS LETRAS": "SAO TOME DAS LETRAS"},
    "PA": {"SANTA ISABEL DO PARA": "SANTA IZABEL DO PARA", "ELDORADO DOS CARAJAS": "ELDORADO DO CARAJAS"},
    "PB": {"SERIDO": "SAO VICENTE DO SERIDO"},
    "PE": {"IGUARACI": "IGUARACY"},
    "RN": {"ACU": "ASSU", "PRESIDENTE JUSCELINO": "SERRA CAIADA", "AUGUSTO SEVERO": "CAMPO GRANDE", "ARES": "AREZ"},
    "RR": {"SAO LUIZ": "SAO LUIZ DO ANAUA"},
    "SE": {"GRACHO CARDOSO": "GRACCHO CARDOSO", "AMPARO DE SAO FRANCISCO": "AMPARO DO SAO FRANCISCO"},
    "TO": {"FORTALEZA DO TABOCAO": "TABOCAO"},
}
# Nome do autor no SIAFI (normalizado) -> nome que o roster conhece, quando nenhum dos dois casa.
# Gim Argello (senador pelo DF, legislatura 54) aparece so como "GIM"; o Senado o lista pelo civil.
SIAFI_NAME_ALIASES: dict[str, str] = {"GIM": "JORGE AFONSO ARGELLO"}

UFS: dict[str, UfConfig] = {
    sigla: UfConfig(sigla, nome, prep, ibge, codigo, siafi, _ALIASES.get(sigla, {}))
    for sigla, nome, prep, ibge, codigo, siafi in _UFS_RAW
}
# Ordem do seletor do site: RJ primeiro (mora na raiz), depois as demais em ordem alfabetica de nome.
UF_ORDER = ["RJ"] + sorted((s for s in UFS if s != "RJ"),
                           key=lambda s: unicodedata.normalize("NFKD", UFS[s].nome).encode("ascii", "ignore").decode())
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
