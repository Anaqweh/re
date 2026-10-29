#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ref="${1:?Supply the full reviewed commit SHA}"
[[ "$ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
container="$(docker compose ps -q api)"
[[ -n "$container" ]] || { echo 'API service is not running.' >&2; exit 1; }
old_image="$(docker inspect --format '{{.Image}}' "$container")"
image_name="$(docker inspect --format '{{.Config.Image}}' "$container")"
stage="$(mktemp -d)"
backup="$(mktemp -d "$PWD/.board-cards-backup-XXXXXXXX")"
changed=0
started=0
cleanup(){
 result=$?
 trap - EXIT
 if (( result != 0 && changed == 1 )); then
  cp "$backup/server.js" server.js
  cp "$backup/Dockerfile" Dockerfile
  if [[ -f "$backup/board-card-offers.js" ]]; then cp "$backup/board-card-offers.js" board-card-offers.js; fi
  if (( started == 1 )); then docker tag "$old_image" "$image_name"; docker compose up -d --no-build --no-deps api; fi
  echo 'Previous API restored. See the error above.' >&2
 fi
 rm -rf "$stage"
 exit "$result"
}
trap cleanup EXIT
cp server.js Dockerfile "$stage/"
cp server.js Dockerfile "$backup/"
[[ ! -f board-card-offers.js ]] || cp board-card-offers.js "$backup/"
curl -fsSL --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$ref/inexc-api/board-card-offers.js" -o "$stage/board-card-offers.js"
python3 - "$stage" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);f=p/'server.js';s=f.read_text()
imp="import {setupBoardCardOffers,installBoardCardOffers} from './board-card-offers.js';"
if imp not in s:
 assert "installServiceCatalog({app,pool,auth,uploadDir});" in s, 'Unknown API version; no files changed'
 assert 'setupDatabase().then(' in s, 'Unknown startup; no files changed'
 s=imp+'\n'+s
 s=s.replace('installServiceCatalog({app,pool,auth,uploadDir});',"installServiceCatalog({app,pool,auth,uploadDir});\ninstallBoardCardOffers({app,pool,auth,courseMediaUpload,apiOrigin:'https://api.inexctraining.com'});")
 s=s.replace('setupDatabase().then(', 'setupDatabase().then(() => setupBoardCardOffers(pool)).then(')
 f.write_text(s)
f=p/'Dockerfile';s=f.read_text()
if 'board-card-offers.js' not in s:s+='\nCOPY board-card-offers.js ./\n'
f.write_text(s)
PY
for file in server.js board-card-offers.js; do docker compose exec -T api node --input-type=module --check < "$stage/$file"; done
changed=1
cp "$stage/server.js" "$stage/board-card-offers.js" "$stage/Dockerfile" ./
docker compose build api
started=1
docker compose up -d --no-build --no-deps api
for attempt in {1..25}; do
 if curl -fsS --max-time 3 http://127.0.0.1:3000/api/board-cards/capabilities | python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin).get("version")==2 else 1)' 2>/dev/null; then
  changed=0
  echo "Course cards ready. Backup: $backup"
  echo 'No email or payment was initiated by this update. Existing scheduled workers retain their normal behavior.'
  exit 0
 fi
 sleep 2
done
exit 1
