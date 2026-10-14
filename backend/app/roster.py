"""Roster of one state's federal bancada: deputies and senators per legislature (RJ, SP...).

Sources: Camara dadosabertos v2 (/deputados?idLegislatura=N filtered by siglaUf, /deputados/{id}) and
Senado dadosabertos (/senador/lista/legislatura/N). Also builds a NATIONAL name index (all
deputies and senators, every legislature) so homonyms from other states can be detected.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from . import config
from .http import fetch_json
from .names import normalize


@dataclass(slots=True)
class Mandato:
    legislatura: int
    casa: str  # camara | senado
    partido: str | None
    inicio: str | None
    fim: str | None
    participacao: str | None = None  # Titular / 1o Suplente ... (senado only)


@dataclass(slots=True)
class Pessoa:
    id: str
    nome: str  # civil name when known
    nome_parlamentar: str
    casa: str  # house of the most recent mandate
    ids: dict[str, str]
    foto: str | None
    mandatos: list[Mandato] = field(default_factory=list)
    nomes_alternativos: set[str] = field(default_factory=set)

    @property
    def legislaturas(self) -> list[int]:
        return sorted({m.legislatura for m in self.mandatos})

    @property
    def casas(self) -> list[str]:
        return sorted({m.casa for m in self.mandatos})

    def partido_por_legislatura(self) -> dict[str, str | None]:
        out: dict[str, str | None] = {}
        for m in sorted(self.mandatos, key=lambda m: (m.legislatura, m.inicio or "")):
            out[str(m.legislatura)] = m.partido
        return out

    def name_keys(self) -> set[str]:
        keys = {normalize(self.nome), normalize(self.nome_parlamentar)}
        keys |= {normalize(n) for n in self.nomes_alternativos}
        keys.discard("")
        return keys

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "nome": self.nome,
            "nome_parlamentar": self.nome_parlamentar,
            "casa": self.casa,
            "casas": self.casas,
            "ids": self.ids,
            "partido_por_legislatura": self.partido_por_legislatura(),
            "legislaturas": self.legislaturas,
            "mandatos": [
                {"legislatura": m.legislatura, "casa": m.casa, "partido": m.partido,
                 "inicio": m.inicio, "fim": m.fim, "participacao": m.participacao}
                for m in self.mandatos
            ],
            "foto": self.foto,
        }


# ----------------------------------------------------------------------------- Camara

def _camara_list(legislatura: int, uf: str | None, raw_dir: Path) -> list[dict[str, Any]]:
    tag = f"{uf or 'BR'}_leg{legislatura}"
    items: list[dict[str, Any]] = []
    pagina = 1
    while True:
        params: dict[str, Any] = {"idLegislatura": legislatura, "itens": 100, "pagina": pagina,
                                  "ordem": "ASC", "ordenarPor": "nome"}
        if uf:
            params["siglaUf"] = uf
        data = fetch_json(f"{config.CAMARA_API}/deputados", raw_dir / "camara" / f"deputados_{tag}_p{pagina}.json",
                          params=params)
        items.extend(data["dados"])
        if not any(l.get("rel") == "next" for l in data.get("links", [])):
            return items
        pagina += 1


def _camara_detail(dep_id: int, raw_dir: Path) -> dict[str, Any]:
    data = fetch_json(f"{config.CAMARA_API}/deputados/{dep_id}", raw_dir / "camara" / f"deputado_{dep_id}.json")
    return data["dados"]


# ----------------------------------------------------------------------------- Senado

def _as_list(x: Any) -> list[Any]:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _senado_list(legislatura: int, raw_dir: Path) -> list[dict[str, Any]]:
    data = fetch_json(f"{config.SENADO_API}/senador/lista/legislatura/{legislatura}",
                      raw_dir / f"senado_legislatura_{legislatura}.json")
    return _as_list(data["ListaParlamentarLegislatura"]["Parlamentares"]["Parlamentar"])


def _senado_mandatos_uf(p: dict[str, Any], legislatura: int, uf: str) -> list[Mandato]:
    """Mandates in `legislatura` for `uf` where the person actually exercised (has Exercicios)."""
    out: list[Mandato] = []
    partido = p["IdentificacaoParlamentar"].get("SiglaPartidoParlamentar")
    for m in _as_list(p.get("Mandatos", {}).get("Mandato")):
        if m.get("UfParlamentar") != uf:
            continue
        legs = {int(m["PrimeiraLegislaturaDoMandato"]["NumeroLegislatura"])}
        if m.get("SegundaLegislaturaDoMandato"):
            legs.add(int(m["SegundaLegislaturaDoMandato"]["NumeroLegislatura"]))
        if legislatura not in legs:
            continue
        exerc = _as_list(m.get("Exercicios", {}).get("Exercicio"))
        if not exerc:
            continue  # suplente que nunca assumiu
        leg_ini, leg_fim = config.LEGISLATURAS[legislatura]
        for e in exerc:
            ini, fim = e.get("DataInicio"), e.get("DataFim")
            if (fim and fim < leg_ini) or (ini and ini > leg_fim):
                continue
            out.append(Mandato(legislatura, "senado", partido, max(ini or leg_ini, leg_ini),
                               min(fim or leg_fim, leg_fim), m.get("DescricaoParticipacao")))
    return out


# ----------------------------------------------------------------------------- build

@dataclass(slots=True)
class Roster:
    pessoas: list[Pessoa]
    national_names: dict[str, set[str]]  # normalized name -> {"camara:<id>", "senado:<id>"} nationwide
    sources: list[dict[str, Any]]

    def by_id(self) -> dict[str, Pessoa]:
        return {p.id: p for p in self.pessoas}


def _merge_people(people: Iterable[Pessoa]) -> list[Pessoa]:
    """Merge a deputy and a senator record that are the same person (same normalized civil name)."""
    by_civil: dict[str, Pessoa] = {}
    out: list[Pessoa] = []
    for p in people:
        key = normalize(p.nome)
        if key in by_civil:
            q = by_civil[key]
            q.mandatos.extend(p.mandatos)
            q.ids.update(p.ids)
            q.nomes_alternativos |= {p.nome_parlamentar} | p.nomes_alternativos
            latest = max(q.mandatos, key=lambda m: (m.legislatura, m.inicio or ""))
            q.casa = latest.casa
            if latest.casa == p.casa:
                q.nome_parlamentar, q.foto = p.nome_parlamentar, p.foto or q.foto
        else:
            by_civil[key] = p
            out.append(p)
    return out


def build_roster(uf: str = config.DEFAULT_UF, raw_dir: Path = config.RAW_DIR,
                 legislaturas: Iterable[int] = config.LEGISLATURAS) -> Roster:
    uf = uf.upper()
    legislaturas = list(legislaturas)
    sources: list[dict[str, Any]] = []
    national: dict[str, set[str]] = {}
    camara: dict[int, Pessoa] = {}
    senado: dict[str, Pessoa] = {}

    for leg in legislaturas:
        leg_ini, leg_fim = config.LEGISLATURAS[leg]
        # One national listing per legislature: feeds the homonym index and, filtered by siglaUf,
        # the state's roster. (The UF-filtered endpoint 504s on page 2, see FINDINGS.md.)
        todos = _camara_list(leg, None, raw_dir)
        for d in todos:
            national.setdefault(normalize(d["nome"]), set()).add(f"camara:{d['id']}")
        da_uf = [d for d in todos if d.get("siglaUf") == uf]
        sources.append({"name": f"camara deputados {uf} leg {leg}", "url": f"{config.CAMARA_API}/deputados?siglaUf={uf}&idLegislatura={leg}", "rows": len(da_uf)})
        for d in da_uf:
            p = camara.get(d["id"])
            if p is None:
                det = _camara_detail(d["id"], raw_dir)
                p = Pessoa(id=f"camara-{d['id']}", nome=det.get("nomeCivil") or d["nome"], nome_parlamentar=d["nome"],
                           casa="camara", ids={"camara": str(d["id"])}, foto=d.get("urlFoto"))
                status = det.get("ultimoStatus") or {}
                if status.get("nomeEleitoral"):
                    p.nomes_alternativos.add(status["nomeEleitoral"])
                camara[d["id"]] = p
            p.nomes_alternativos.add(d["nome"])
            p.mandatos.append(Mandato(leg, "camara", d.get("siglaPartido"), leg_ini, leg_fim))

        sen = _senado_list(leg, raw_dir)
        sources.append({"name": f"senado lista legislatura {leg}", "url": f"{config.SENADO_API}/senador/lista/legislatura/{leg}", "rows": len(sen)})
        for s in sen:
            ident = s["IdentificacaoParlamentar"]
            code = str(ident["CodigoParlamentar"])
            for nm in (ident.get("NomeParlamentar"), ident.get("NomeCompletoParlamentar")):
                if nm:
                    national.setdefault(normalize(nm), set()).add(f"senado:{code}")
            mandatos = _senado_mandatos_uf(s, leg, uf)
            if not mandatos:
                continue
            p = senado.get(code)
            if p is None:
                p = Pessoa(id=f"senado-{code}", nome=ident.get("NomeCompletoParlamentar") or ident["NomeParlamentar"],
                           nome_parlamentar=ident["NomeParlamentar"], casa="senado", ids={"senado": code},
                           foto=ident.get("UrlFotoParlamentar") or f"https://www.senado.leg.br/senadores/img/fotos-oficiais/senador{code}.jpg")
                senado[code] = p
            p.mandatos.extend(mandatos)

    pessoas = _merge_people([*camara.values(), *senado.values()])
    pessoas.sort(key=lambda p: normalize(p.nome_parlamentar))
    return Roster(pessoas=pessoas, national_names=national, sources=sources)


if __name__ == "__main__":  # quick manual run / warm the cache: python -m app.roster SP
    import sys
    r = build_roster(sys.argv[1] if len(sys.argv) > 1 else config.DEFAULT_UF)
    print(json.dumps({"pessoas": len(r.pessoas), "national_names": len(r.national_names)}))
