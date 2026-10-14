"""Name normalisation shared by the roster and the matcher."""
from __future__ import annotations

import re

from unidecode import unidecode

_EX = re.compile(r"\s*\((?:EX[- ]PARLAMENTAR|EX-SENADOR|EX-DEPUTAD[OA])\s+([^,()]+)[^)]*\)?\s*$", re.I)
_PUNCT = re.compile(r"[^A-Z0-9 ]+")
_WS = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Upper-case ASCII, no punctuation, single spaces. 'Chico D'Angelo' -> 'CHICO DANGELO'."""
    s = unidecode(name or "").upper()
    s = s.replace("'", "").replace("’", "")
    s = _PUNCT.sub(" ", s)
    return _WS.sub(" ", s).strip()


def split_siafi_author(raw: str) -> tuple[str, str | None]:
    """SIAFI sometimes rewrites an author code holder as
    'TIAGO DIMAS (EX-PARLAMENTAR LAZARO BOTELHO, NOS TERMOS ...)'. Returns (current, former)."""
    m = _EX.search(raw)
    if not m:
        return raw.strip(), None
    return raw[: m.start()].strip(), m.group(1).strip()
