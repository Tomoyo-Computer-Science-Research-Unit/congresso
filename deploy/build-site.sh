#!/usr/bin/env bash
# Roda no droplet, por cron, uma vez por dia: puxa main, baixa de novo o arquivo do Portal da
# Transparência, regenera o snapshot e, se o código ou os dados mudaram desde o último build,
# constrói o site e troca os arquivos em /root/g0v/site/emendas. Falhas avisam por e-mail.
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

on_error() {
  log "falhou na linha $1"
  record "falhou" "linha $1"
  notify "[emendas-rj] rodada falhou" "O build-emendas.sh parou na linha $1 em $(hostname). Veja $DIR/build-emendas.log."
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

if [ "${SKIP_DATA:-0}" != "1" ]; then
  # --refresh baixa o zip de novo (32 MB); o resto do bruto (Câmara, Senado, IBGE) fica em cache.
  if etl_output="$(cd "$SRC/backend" && "$PY" -m app.etl.export_snapshot --refresh 2>&1 && "$PY" -m app.etl.export_static_frontend 2>&1)"; then
    log "ETL ok"
  else
    log "ETL falhou; usando os arquivos commitados em main"
    note="ETL falhou"
    notify "[emendas-rj] ETL falhou" "$(printf '%s\n\n%s' "O export falhou; o site segue com os dados de main." "$etl_output" | tail -c 6000)"
    git -C "$SRC" checkout -q -- frontend/lib
  fi
fi

key="$rev $(cd "$SRC" && "$PY" - <<'EOF'
import hashlib, json, pathlib
h = hashlib.sha256()
for name in sorted(str(p) for p in pathlib.Path("frontend/lib").rglob("*.generated.json")):
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
  exit 0
fi

log "construindo ($key)"
(cd "$SRC/frontend" && npm ci --no-audit --no-fund --silent && rm -rf out .next && NEXT_PUBLIC_BASE_PATH="$BASE_PATH" npm run build --silent >/dev/null)
mkdir -p "$DIR/site$BASE_PATH"
rsync -a --delete --chmod=D755,F644 "$SRC/frontend/out/" "$DIR/site$BASE_PATH/"
echo "$key" > "$MARK"
record "publicado" "$note"
log "publicado ($key)"
