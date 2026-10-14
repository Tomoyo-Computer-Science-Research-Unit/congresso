#!/usr/bin/env bash
# Roda no droplet, por cron, uma vez por dia: puxa main, baixa de novo o arquivo do Portal da
# Transparência, regenera os dados do RJ e de SP e, se o código ou os dados mudaram desde o último
# build, constrói as duas UFs e troca os arquivos em /root/g0v/site/emendas (RJ) e
# /root/g0v/site/emendas/sp (SP). Falhas avisam por e-mail. O ETL de uma UF que falha não derruba
# a outra: aquela UF segue com os dados commitados em main.
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
UFS="RJ SP"
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

site_dir() {  # RJ na raiz do projeto, as outras UFs numa subpasta
  if [ "$1" = "RJ" ]; then echo "$DIR/site$BASE_PATH"; else echo "$DIR/site$BASE_PATH/$(echo "$1" | tr 'A-Z' 'a-z')"; fi
}

base_path() {
  if [ "$1" = "RJ" ]; then echo "$BASE_PATH"; else echo "$BASE_PATH/$(echo "$1" | tr 'A-Z' 'a-z')"; fi
}

write_status() {
  if [ -x "${PY:-}" ]; then
    for uf in $UFS; do
      [ -d "$(site_dir "$uf")" ] || continue
      (cd "$SRC/backend" && "$PY" -m app.etl.write_status --uf "$uf" --runs "$RUNS" --out "$(site_dir "$uf")/status.json") || log "status.json $uf falhou"
    done
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

if [ "${SKIP_DATA:-0}" != "1" ]; then
  # O zip do Portal é nacional: a primeira UF baixa de novo (--refresh, 32 MB) e as outras leem o
  # mesmo arquivo. O resto do bruto (Câmara, Senado, IBGE) fica em cache.
  refresh="--refresh"
  for uf in $UFS; do
    lower="$(echo "$uf" | tr 'A-Z' 'a-z')"
    if etl_output="$(cd "$SRC/backend" && "$PY" -m app.etl.export_snapshot --uf "$uf" $refresh 2>&1 && "$PY" -m app.etl.export_static_frontend --uf "$uf" 2>&1)"; then
      log "ETL $uf ok"
    else
      log "ETL $uf falhou; usando os arquivos commitados em main"
      note="${note:+$note; }ETL $uf falhou"
      notify "[emendas-rj] ETL $uf falhou" "$(printf '%s\n\n%s' "O export de $uf falhou; essa UF segue com os dados de main." "$etl_output" | tail -c 6000)"
      git -C "$SRC" checkout -q -- "frontend/data/$lower"
      git -C "$SRC" clean -q -fd -- "frontend/data/$lower"
    fi
    refresh=""
  done
fi

key="$rev $(cd "$SRC" && "$PY" - <<'EOF'
import hashlib, json, pathlib
h = hashlib.sha256()
for name in sorted(str(p) for p in pathlib.Path("frontend/data").rglob("*.generated.json")):
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
(cd "$SRC/frontend" && npm ci --no-audit --no-fund --silent)
for uf in $UFS; do
  (cd "$SRC/frontend" && rm -rf out .next && NEXT_PUBLIC_UF="$uf" NEXT_PUBLIC_BASE_PATH="$(base_path "$uf")" npm run build --silent >/dev/null)
  mkdir -p "$(site_dir "$uf")"
  if [ "$uf" = "RJ" ]; then
    # --delete no RJ não pode apagar as subpastas das outras UFs.
    rsync -a --delete --exclude=/sp/ --chmod=D755,F644 "$SRC/frontend/out/" "$(site_dir "$uf")/"
  else
    rsync -a --delete --chmod=D755,F644 "$SRC/frontend/out/" "$(site_dir "$uf")/"
  fi
  log "publicado $uf em $(site_dir "$uf")"
done
echo "$key" > "$MARK"
record "publicado" "$note"
write_status
log "publicado ($key)"
