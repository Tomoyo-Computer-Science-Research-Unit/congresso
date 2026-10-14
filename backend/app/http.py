"""Polite, cached HTTP fetching. Every download is streamed to data/raw and gets a .sha256 sidecar."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import httpx

UA = "emendas-rj-etl/0.1 (civic-tech prototype; contact via repo)"
_SLEEP = 0.25


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
    for attempt in range(4):
        try:
            with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, read=300.0)) as c:
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
