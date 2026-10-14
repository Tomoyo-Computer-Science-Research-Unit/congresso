"""Escreve o ``status.json`` servido em ``/congresso/status.json``: ultima rodada, ultimo build,
arquivo do Portal (local e no servidor deles) e as ultimas execucoes.

    python -m app.etl.write_status --uf all --runs /root/g0v/runs-emendas.jsonl --site /root/g0v/site/congresso
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .. import config

RUNS_KEPT = 30


def read_runs(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    runs: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                runs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return runs


def probe(url: str) -> dict[str, Any]:
    try:
        response = httpx.head(url, timeout=15.0, follow_redirects=True)
    except httpx.HTTPError as exc:
        return {"status": None, "error": type(exc).__name__}
    size = response.headers.get("content-length")
    return {"status": response.status_code, "last_modified": response.headers.get("last-modified"), "size_bytes": int(size) if size and size.isdigit() else None}


def build_status(core: dict[str, Any], runs: list[dict[str, Any]], do_probe: bool = True) -> dict[str, Any]:
    published = [run for run in runs if run.get("result") == "publicado"]
    sources = [dict(source) for source in core.get("sources", [])]
    if do_probe:
        for source in sources:
            if str(source.get("url", "")).endswith(".zip"):
                source["remote"] = probe(str(source["url"]))
    return {
        "written_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "snapshot": {"generated_at": core.get("snapshot_generated_at"), "latest_year": core.get("latest_year"), "ipca_base": (core.get("ipca") or {}).get("base_month")},
        "last_run": runs[-1] if runs else None,
        "last_published": published[-1] if published else None,
        "runs": list(reversed(runs[-RUNS_KEPT:])),
        "sources": sources,
        "uf": core.get("uf"),
        "stats": {key: core.get("stats", {}).get(key) for key in ("rows_total", "rows_uf", "roster_size", "roster_matched")},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uf", default=config.DEFAULT_UF, help="UF, lista separada por virgula ou 'all'")
    parser.add_argument("--core", type=Path, default=None, help="so com uma UF: padrão frontend/data/<uf>/static-data.generated.json")
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=None, help="so com uma UF: arquivo de saida")
    parser.add_argument("--site", type=Path, default=None, help="raiz do site: RJ em <site>/status.json, demais em <site>/<uf>/status.json")
    parser.add_argument("--no-probe", action="store_true")
    args = parser.parse_args(argv)
    from .export_snapshot import parse_ufs

    ufs = parse_ufs(args.uf)
    runs = read_runs(args.runs)
    remote: dict[str, Any] = {}
    for sigla in ufs:
        core_path = (args.core if args.core and len(ufs) == 1 else None) or config.ROOT / "frontend" / "data" / sigla.lower() / "static-data.generated.json"
        if not core_path.exists():
            continue
        core = json.loads(core_path.read_text(encoding="utf-8"))
        status = build_status(core, runs, do_probe=False)
        if not args.no_probe:  # o zip e o mesmo para todas as UFs: um HEAD so
            for source in status["sources"]:
                url = str(source.get("url", ""))
                if url.endswith(".zip"):
                    if url not in remote:
                        remote[url] = probe(url)
                    source["remote"] = remote[url]
        if args.out and len(ufs) == 1:
            out = args.out
        elif args.site:
            out = args.site / "status.json" if sigla == config.DEFAULT_UF else args.site / sigla.lower() / "status.json"
        else:
            parser.error("--site ou --out")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(status, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
