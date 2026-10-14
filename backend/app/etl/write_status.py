"""Escreve o ``status.json`` servido em ``/emendas/status.json``: ultima rodada, ultimo build,
arquivo do Portal (local e no servidor deles) e as ultimas execucoes.

    python -m app.etl.write_status --core ../frontend/lib/static-data.generated.json \
        --runs /root/g0v/runs-emendas.jsonl --out /root/g0v/site/emendas/status.json
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
        "stats": {key: core.get("stats", {}).get(key) for key in ("rows_total", "rows_rj", "roster_size", "roster_matched")},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", type=Path, default=config.ROOT / "frontend" / "lib" / "static-data.generated.json")
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--no-probe", action="store_true")
    args = parser.parse_args(argv)
    core = json.loads(args.core.read_text(encoding="utf-8"))
    status = build_status(core, read_runs(args.runs), do_probe=not args.no_probe)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(status, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
