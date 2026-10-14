"""Downloads for the voting data.

The Câmara serves its yearly bulk files (dadosabertos.camara.leg.br/arquivos/...) from a server that
cuts every response after ~17 s (2026-10-14: a 37 MB file stops at ~6.4 MB, mid-row, with no error
other than curl's "transfer closed with outstanding read data"). It honours Range, so a download
is resumed from where it stopped until the size matches Content-Length.
"""
from __future__ import annotations

import time
from pathlib import Path

import httpx

from ..http import UA, _write_checksum

CAMARA_ARQUIVOS = "https://dadosabertos.camara.leg.br/arquivos"


def camara_arquivo_url(nome: str, ano: int) -> str:
    return f"{CAMARA_ARQUIVOS}/{nome}/csv/{nome}-{ano}.csv"


def fetch_resumable(url: str, dest: Path, *, force: bool = False, max_rounds: int = 40) -> Path:
    """Download `url` to `dest`, resuming with Range until the whole Content-Length arrived."""
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.unlink(missing_ok=True)
    total: int | None = None
    headers = {"User-Agent": UA, "Accept-Encoding": "identity"}
    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, read=60.0)) as client:
        for _ in range(max_rounds):
            have = tmp.stat().st_size if tmp.exists() else 0
            if total is not None and have >= total:
                break
            h = dict(headers)
            if have:
                h["Range"] = f"bytes={have}-"
            try:
                with client.stream("GET", url, headers=h) as r:
                    if r.status_code == 416:
                        break
                    r.raise_for_status()
                    if have and r.status_code != 206:  # server ignored Range: start over
                        have = 0
                        tmp.unlink(missing_ok=True)
                    if total is None:
                        cr = r.headers.get("content-range")
                        total = int(cr.rsplit("/", 1)[1]) if cr else int(r.headers.get("content-length", "0")) or None
                    with tmp.open("ab") as f:
                        for chunk in r.iter_bytes(1 << 20):
                            f.write(chunk)
            except (httpx.HTTPError, OSError):
                time.sleep(2.0)
                continue
            time.sleep(0.5)
        have = tmp.stat().st_size if tmp.exists() else 0
        if total is None or have != total:
            raise RuntimeError(f"{url}: baixou {have} de {total} bytes")
    tmp.replace(dest)
    _write_checksum(dest)
    return dest


SENADO = "https://legis.senado.leg.br/dadosabertos"


def senado_votacoes_url(ano: int) -> str:
    """Votos nominais de um ano (serviço /votacao, que substituiu /plenario/lista/votacao em 2025)."""
    return f"{SENADO}/votacao?dataInicio={ano}-01-01&dataFim={ano}-12-31"


def senado_orientacao_url(ano: int, mes: int) -> str:
    """Orientação de bancada e votos do painel eletrônico (SVE), um mês por pedido."""
    import calendar

    fim = calendar.monthrange(ano, mes)[1]
    return f"{SENADO}/plenario/votacao/orientacaoBancada/{ano}{mes:02d}01/{ano}{mes:02d}{fim:02d}"


def fetch_json_file(url: str, dest: Path, *, force: bool = False) -> Path:
    """GET JSON (Accept: application/json) to `dest`, cached, with retries."""
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    last: Exception | None = None
    for attempt in range(5):
        try:
            with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, read=240.0)) as client:
                r = client.get(url, headers={"User-Agent": UA, "Accept": "application/json"})
                r.raise_for_status()
                r.json()
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(r.content)
            tmp.replace(dest)
            _write_checksum(dest)
            time.sleep(0.5)
            return dest
        except (httpx.HTTPError, ValueError) as e:
            last = e
            time.sleep(3.0 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")
