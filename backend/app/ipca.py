"""IPCA deflator from IBGE SIDRA (tabela 1737, variavel 2266: numero-indice, dez/1993 = 100).

Monetary values stay nominal everywhere in the data; the frontend multiplies by one of these
factors. For budget year Y::

    factor[Y]     = index[base_month] / mean(index of the months of Y available)
    factor_dec[Y] = index[base_month] / index[Y-12]

``factor`` is the default because an amendment's execution (empenho, pagamento) is spread through
the year, so the average price level of the year is the natural deflator of a yearly flow;
``factor_dec`` ("reais de dezembro de Y") is offered for people who prefer the end-of-year
convention. For the current year the mean uses the months published so far.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import config
from .http import fetch_file

SIDRA_IPCA_URL = "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/all"
CACHE_PATH = config.RAW_DIR / "ibge" / "ipca_1737_2266.json"


@dataclass(frozen=True, slots=True)
class Ipca:
    source_url: str
    fetched_at: str  # ISO date of the cached file
    base_month: str  # "YYYY-MM", latest month published
    factors: dict[str, float]  # by budget year, mean-of-year convention
    factors_dec: dict[str, float]  # by budget year, December convention
    months_in_base_year: int  # how many months of the current year entered its mean

    def json(self) -> dict[str, Any]:
        return {
            "source_url": self.source_url, "fetched_at": self.fetched_at, "base_month": self.base_month,
            "variable": "IPCA - Número-índice (base: dezembro de 1993 = 100), SIDRA t/1737 v/2266",
            "method": "factor = index[base_month] / mean(index of the year's months); factor_dec uses December",
            "factors": self.factors, "factors_dec": self.factors_dec,
        }


def parse_series(rows: list[dict[str, Any]]) -> dict[str, float]:
    """SIDRA JSON (first row = header) -> {"YYYYMM": index}."""
    out: dict[str, float] = {}
    for row in rows[1:]:
        code = str(row.get("D3C") or "")
        value = str(row.get("V") or "")
        if len(code) == 6 and code.isdigit():
            try:
                out[code] = float(value)
            except ValueError:
                continue  # "..." / "-" for months not yet published
    return out


def compute_factors(series: dict[str, float], first_year: int, last_year: int | None = None,
                    ndigits: int = 4) -> tuple[str, dict[str, float], dict[str, float], int]:
    """Returns (base_month "YYYY-MM", factors, factors_dec, months in the last year's mean)."""
    if not series:
        raise ValueError("empty IPCA series")
    latest = max(series)
    base = series[latest]
    last_year = last_year if last_year is not None else int(latest[:4])
    factors: dict[str, float] = {}
    factors_dec: dict[str, float] = {}
    months_last = 0
    for year in range(first_year, last_year + 1):
        months = [series[f"{year}{m:02d}"] for m in range(1, 13) if f"{year}{m:02d}" in series]
        if not months:
            continue
        if year == last_year:
            months_last = len(months)
        factors[str(year)] = round(base / (sum(months) / len(months)), ndigits)
        dec = series.get(f"{year}12")
        # December not published yet (current year): fall back to the latest month, i.e. factor 1.
        factors_dec[str(year)] = round(base / dec, ndigits) if dec is not None else round(base / series[latest], ndigits)
    return f"{latest[:4]}-{latest[4:6]}", factors, factors_dec, months_last


def load(first_year: int = 2014, refresh: bool = False) -> Ipca:
    path = fetch_file(SIDRA_IPCA_URL, CACHE_PATH, force=refresh)
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    series = parse_series(rows)
    base_month, factors, factors_dec, months_last = compute_factors(series, first_year)
    from datetime import datetime, timezone
    fetched = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
    return Ipca(SIDRA_IPCA_URL, fetched, base_month, factors, factors_dec, months_last)
