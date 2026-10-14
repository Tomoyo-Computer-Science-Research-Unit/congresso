import pytest

from app.ipca import compute_factors, parse_series


def _sidra(values: dict[str, str]) -> list[dict]:
    header = {"D3C": "Mês (Código)", "V": "Valor"}
    return [header, *({"D3C": k, "V": v} for k, v in values.items())]


def test_parse_series_skips_header_and_unpublished():
    rows = _sidra({"202401": "100.0", "202402": "...", "202403": "102"})
    assert parse_series(rows) == {"202401": 100.0, "202403": 102.0}


def test_compute_factors_mean_and_december():
    # 2023: flat at 100 all year, Dec = 100.  2024: 110 Jan-Nov, 120 in Dec.  2025: Jan-Mar 150 (partial year).
    series = {f"2023{m:02d}": 100.0 for m in range(1, 13)}
    series.update({f"2024{m:02d}": 110.0 for m in range(1, 12)})
    series["202412"] = 120.0
    series.update({"202501": 150.0, "202502": 150.0, "202503": 150.0})
    base_month, factors, factors_dec, months_last = compute_factors(series, 2023)
    assert base_month == "2025-03" and months_last == 3
    assert factors["2023"] == pytest.approx(1.5)
    mean_2024 = (110 * 11 + 120) / 12
    assert factors["2024"] == pytest.approx(round(150 / mean_2024, 4))
    assert factors["2025"] == pytest.approx(1.0)
    assert factors_dec["2023"] == pytest.approx(1.5)
    assert factors_dec["2024"] == pytest.approx(1.25)
    assert factors_dec["2025"] == pytest.approx(1.0)  # December not published: latest month


def test_compute_factors_skips_years_without_data():
    series = {"202001": 100.0, "202012": 100.0, "202106": 200.0}
    _, factors, _, _ = compute_factors(series, 2018)
    assert set(factors) == {"2020", "2021"} and factors["2020"] == 2.0
