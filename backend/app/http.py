"""Polite, cached HTTP fetching. Every download is streamed to data/raw and gets a .sha256 sidecar."""
from __future__ import annotations

import hashlib
import ssl
import json
import time
from pathlib import Path
from typing import Any

import httpx

UA = "emendas-rj-etl/0.1 (civic-tech prototype; contact via repo)"
_SLEEP = 0.25

# Intermediarias que servidores do governo esquecem de mandar. Em 2026-10-14 o
# servicodados.ibge.gov.br (malhas) passou a servir so o certificado folha, emitido pela Sectigo
# DV R36; sem a intermediaria a verificacao falha. O certificado vem do endereco AIA da propria
# folha e entra so como intermediaria: a cadeia continua verificada ate uma raiz do sistema.
EXTRA_INTERMEDIATES = ["http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt"]
_ctx: ssl.SSLContext | None = None


def _verify_with_intermediates() -> ssl.SSLContext:
    global _ctx
    if _ctx is None:
        ctx = ssl.create_default_context()
        for url in EXTRA_INTERMEDIATES:
            der = httpx.get(url, headers={"User-Agent": UA}, timeout=30.0, follow_redirects=True).content
            pem = ssl.DER_cert_to_PEM_cert(der) if not der.startswith(b"-----") else der.decode()
            ctx.load_verify_locations(cadata=pem)
        _ctx = ctx
    return _ctx


def _is_cert_error(exc: BaseException) -> bool:
    return "CERTIFICATE_VERIFY_FAILED" in str(exc)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_checksum(path: Path) -> str:
    digest = sha256_of(path)
    path.with_suffix(path.suffix + ".sha256").write_text(f"{digest}  {path.name}\n")
    return digest


def fetch_file(url: str, dest: Path, *, force: bool = False, headers: dict[str, str] | None = None) -> Path:
    """Stream `url` to `dest` once; later calls reuse the cached file."""
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = {"User-Agent": UA, **(headers or {})}
    verify: ssl.SSLContext | bool = True
    for attempt in range(4):
        try:
            with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, read=300.0), verify=verify) as c:
                with c.stream("GET", url, headers=h) as r:
                    r.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in r.iter_bytes(1 << 20):
                            f.write(chunk)
            tmp.replace(dest)
            _write_checksum(dest)
            time.sleep(_SLEEP)
            return dest
        except (httpx.HTTPError, OSError) as e:  # noqa: PERF203
            if verify is True and _is_cert_error(e):
                verify = _verify_with_intermediates()
                continue
            if attempt == 3:
                raise
            time.sleep(2.0 * (attempt + 1))
            last = e  # noqa: F841
    raise RuntimeError("unreachable")


def fetch_json(url: str, dest: Path, *, force: bool = False, params: dict[str, Any] | None = None) -> Any:
    """GET JSON with retries (the Camara API sometimes answers 'upstream request timeout' as text)."""
    if dest.exists() and not force:
        return json.loads(dest.read_text(encoding="utf-8"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    h = {"User-Agent": UA, "Accept": "application/json"}
    for attempt in range(5):
        try:
            with httpx.Client(follow_redirects=True, timeout=60.0) as c:
                r = c.get(url, headers=h, params=params)
                r.raise_for_status()
                data = r.json()
            dest.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            _write_checksum(dest)
            time.sleep(_SLEEP)
            return data
        except (httpx.HTTPError, ValueError):
            if attempt == 4:
                raise
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError("unreachable")
