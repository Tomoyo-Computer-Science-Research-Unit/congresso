#!/usr/bin/env bash
# Roda no droplet, por cron, uma vez por dia: puxa main, baixa de novo o arquivo do Portal da
# Transparência, regenera os dados das 27 UFs (o zip é lido uma vez) e, se o código ou os dados
# mudaram desde o último build, faz um build Next só, com todas as UFs, e troca os arquivos em
# /root/g0v/site/emendas (RJ na raiz, as demais em /emendas/<uf>/, dados em /emendas/data/<uf>/).
# Falhas avisam por e-mail. Uma UF cujo ETL falha segue com os dados commitados em main; as outras
# usam os dados novos. Cada rodada registra quanto tempo levaram ETL e build.
#
#   /root/g0v/build-emendas.sh               # só reconstrói se algo mudou
#   FORCE=1 /root/g0v/build-emendas.sh       # reconstrói de qualquer jeito
#   SKIP_DATA=1 /root/g0v/build-emendas.sh   # não baixa nem regenera; usa o snapshot commitado
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

REPO="${REPO:-https://github.com/Tomoyo-Computer-Science-Research-Unit/emendas-rj.git}"
DIR="${DIR:-/root/g0v}"
SRC="$DIR/src-emendas"
MARK="$DIR/.emendas-built"
RUNS="$DIR/runs-emendas.jsonl"
BASE_PATH="/emendas"
# UFs vêm de backend/app/config.py (UF_ORDER); "all" no ETL.
ALERT_TO="${ALERT_TO:-arete@tomoyo.systems}"
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=2048"

started="$(date +%s)"
key=""
note=""

log() { echo "$(date -Is) $*"; }

record() {
  python3 - "$1" "${2:-}" "$key" "$(( $(date +%s) - started ))" >> "$RUNS" <<'EOF'
import datetime, json, sys
print(json.dumps({
    "at": datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds"),
    "result": sys.argv[1], "detail": sys.argv[2] or None, "key": sys.argv[3] or None, "duration_s": int(sys.argv[4]),
}, ensure_ascii=False))
EOF
}

notify() {
  printf 'From: g0v <g0v@tomoyo.systems>\nTo: %s\nSubject: %s\nContent-Type: text/plain; charset=utf-8\n\n%s\n' "$ALERT_TO" "$1" "$2" \
    | docker exec -i mailserver sendmail -t || log "aviso por e-mail falhou"
}

write_status() {  # RJ em <site>/status.json, demais em <site>/<uf>/status.json; um HEAD no zip
  if [ -x "${PY:-}" ] && [ -d "$DIR/site$BASE_PATH" ]; then
    (cd "$SRC/backend" && "$PY" -m app.etl.write_status --uf all --runs "$RUNS" --site "$DIR/site$BASE_PATH") || log "status.json falhou"
  fi
}

on_error() {
  log "falhou na linha $1"
  record "falhou" "linha $1"
  notify "[emendas-rj] rodada falhou" "O build-emendas.sh parou na linha $1 em $(hostname). Veja $DIR/build-emendas.log."
  write_status
}
trap 'on_error $LINENO' ERR

[ -d "$SRC/.git" ] || git clone -q "$REPO" "$SRC"
git -C "$SRC" fetch -q origin main
git -C "$SRC" reset -q --hard origin/main
rev="$(git -C "$SRC" rev-parse --short HEAD)"

# O script instalado é uma cópia deste arquivo; quando main o muda, troca e recomeça.
if [ -f "$SRC/deploy/build-site.sh" ] && ! cmp -s "$SRC/deploy/build-site.sh" "$0"; then
  cp "$SRC/deploy/build-site.sh" "$0"
  chmod 755 "$0"
  log "script atualizado a partir de $rev; recomeçando"
  exec "$0" "$@"
fi

PY="$SRC/backend/.venv/bin/python"
[ -x "$PY" ] || uv venv -q --python 3.12 "$SRC/backend/.venv"
uv pip install -q --python "$PY" -e "$SRC/backend"

etl_s=0
if [ "${SKIP_DATA:-0}" != "1" ]; then
  # Um processo para as 27 UFs: baixa o zip de novo (--refresh, 32 MB), lê o CSV e o arquivo de
  # favorecidos uma vez e escreve um snapshot por UF. Câmara, Senado e IBGE ficam em cache.
  t0="$(date +%s)"
  all_ufs="$(cd "$SRC/backend" && "$PY" -c 'from app import config; print(" ".join(config.UF_ORDER))')"
  failed=""
  if etl_output="$(cd "$SRC/backend" && "$PY" -m app.etl.export_snapshot --uf all --refresh 2>&1)"; then
    :
  else
    failed="$(printf '%s\n' "$etl_output" | sed -n 's/^etl-failed: //p')"
    [ -n "$failed" ] || failed="$all_ufs"  # caiu antes de separar por UF (zip, CSV): todas falham
  fi
  ok=""
  for uf in $all_ufs; do
    case " $failed " in *" $uf "*) ;; *) ok="${ok:+$ok,}$uf" ;; esac
  done
  if [ -n "$ok" ]; then
    if export_output="$(cd "$SRC/backend" && "$PY" -m app.etl.export_static_frontend --uf "$ok" 2>&1)"; then
      :
    else
      failed="$failed $(printf '%s\n' "$export_output" | sed -n 's/^export-failed: //p')"
      etl_output="$etl_output
$export_output"
    fi
  fi
  failed="$(echo $failed)"
  if [ -n "$failed" ]; then
    log "ETL falhou em: $failed; essas UFs seguem com os dados commitados em main"
    note="ETL falhou: $failed"
    notify "[emendas-rj] ETL falhou: $failed" "$(printf '%s\n\n%s' "Essas UFs seguem com os dados de main; as demais foram atualizadas." "$etl_output" | tail -c 6000)"
    for uf in $failed; do
      lower="$(echo "$uf" | tr 'A-Z' 'a-z')"
      git -C "$SRC" checkout -q -- "frontend/data/$lower" 2>/dev/null || true
      git -C "$SRC" clean -q -fd -- "frontend/data/$lower"
    done
  else
    log "ETL ok"
  fi
  etl_s=$(( $(date +%s) - t0 ))
fi

key="$rev $(cd "$SRC" && "$PY" - <<'EOF'
import hashlib, json, pathlib
h = hashlib.sha256()
for name in sorted(str(p) for p in pathlib.Path("frontend/data").rglob("*.json")):
    data = json.loads(pathlib.Path(name).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data.pop("generated_at", None)
        data.pop("snapshot_generated_at", None)
        for source in data.get("sources", []) if isinstance(data.get("sources"), list) else []:
            source.pop("accessed_at", None)
    h.update(name.encode())
    h.update(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())
print(h.hexdigest()[:16])
EOF
)"

if [ "${FORCE:-0}" != "1" ] && [ -f "$MARK" ] && [ "$(cat "$MARK")" = "$key" ]; then
  log "sem mudança ($key)"
  record "sem mudança" "$note"
  write_status
  exit 0
fi

log "construindo ($key)"
t0="$(date +%s)"
# Um build com as 27 UFs: as telas buscam os dados (public/data, copiado de frontend/data no
# prebuild) com fetch, então o bundle não cresce com as UFs.
(cd "$SRC/frontend" && npm ci --no-audit --no-fund --silent && rm -rf out && NEXT_PUBLIC_BASE_PATH="$BASE_PATH" npm run build --silent >/dev/null)
build_s=$(( $(date +%s) - t0 ))
mkdir -p "$DIR/site$BASE_PATH"
# O out tem todas as UFs; status.json (um por UF) é escrito depois e fica protegido do --delete.
rsync -a --delete --exclude=status.json --chmod=D755,F644 "$SRC/frontend/out/" "$DIR/site$BASE_PATH/"
note="${note:+$note; }etl ${etl_s}s, build ${build_s}s"
log "publicado: etl ${etl_s}s, build ${build_s}s"
echo "$key" > "$MARK"
record "publicado" "$note"
write_status
log "publicado ($key)"
