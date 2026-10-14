"""Match SIAFI author names (free-text, no stable id) to the RJ roster.

Rules, in order:
 1. exact normalized-name match against a roster person whose legislaturas include the
    authoring legislature of the budget year ("strict");
 2. exact name match against a roster person in another legislature, accepted only when the
    name is unique nationwide ("loose");
 3. everything else: unmatched. Names that match an RJ person AND a non-RJ person nationwide
    are reported as collisions.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .config import legislatura_autora
from .names import normalize, split_siafi_author
from .roster import Pessoa, Roster


@dataclass(slots=True)
class MatchResult:
    autor_id: str | None
    quality: str  # strict | loose | bancada | none | collision
    key: str


@dataclass(slots=True)
class MatchStats:
    by_quality: Counter[str] = field(default_factory=Counter)
    collisions: dict[str, set[str]] = field(default_factory=dict)
    unmatched_names: Counter[str] = field(default_factory=Counter)  # SIAFI name -> rows


class Matcher:
    def __init__(self, roster: Roster) -> None:
        self.roster = roster
        self.index: dict[str, list[Pessoa]] = defaultdict(list)
        for p in roster.pessoas:
            for k in p.name_keys():
                self.index[k].append(p)
        self.rj_ids = {f"{casa}:{i}" for p in roster.pessoas for casa, i in p.ids.items()}
        self.stats = MatchStats()
        self._cache: dict[tuple[str, int], MatchResult] = {}

    def _others_nationwide(self, key: str) -> set[str]:
        return {x for x in self.roster.national_names.get(key, set()) if x not in self.rj_ids}

    def match(self, autor_nome: str, ano: int) -> MatchResult:
        ck = (autor_nome, ano)
        if ck in self._cache:
            return self._cache[ck]
        current, former = split_siafi_author(autor_nome)
        leg = legislatura_autora(ano)
        res = MatchResult(None, "none", normalize(current))
        for cand in (current, former):
            if not cand:
                continue
            key = normalize(cand)
            people = self.index.get(key, [])
            strict = [p for p in people if leg in p.legislaturas]
            others = self._others_nationwide(key)
            if strict:
                if others:
                    self.stats.collisions.setdefault(key, set()).update(others)
                res = MatchResult(strict[0].id, "strict", key)
                break
            if people and not others:
                res = MatchResult(people[0].id, "loose", key)
                break
            if people and others:
                self.stats.collisions.setdefault(key, set()).update(others)
                res = MatchResult(None, "collision", key)
                break
        self._cache[ck] = res
        return res
