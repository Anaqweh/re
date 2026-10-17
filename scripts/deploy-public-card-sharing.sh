#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_release_ref="${1:?Usage: bash deploy-public-card-sharing.sh COMMIT_SHA}"
[[ "$inexc_release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_api_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_api_dir"
docker compose config --services | grep -qx api || { echo 'Existing api service was not found.' >&2; exit 1; }
inexc_old_container="$(docker compose ps -q api)"
[[ -n "$inexc_old_container" ]] || { echo 'The API container is not running.' >&2; exit 1; }
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_old_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_old_container")"
inexc_stage="$(mktemp -d)"
inexc_backup="server.js.card-share-backup-$(date -u +%Y%m%dT%H%M%SZ)"
inexc_installed=0
inexc_started=0
cleanup(){
  inexc_exit=$?
  trap - EXIT
  if (( inexc_exit != 0 && inexc_installed == 1 )); then
    echo 'Restoring previous API file and image.' >&2
    cp -- "$inexc_backup" server.js
    if (( inexc_started == 1 )); then
      docker tag "$inexc_old_image" "$inexc_image_name"
      docker compose up -d --no-build --no-deps api
    fi
  fi
  rm -rf -- "$inexc_stage"
  exit "$inexc_exit"
}
trap cleanup EXIT
curl --fail --silent --show-error --location --retry 2 \
  "https://raw.githubusercontent.com/Anaqweh/re/$inexc_release_ref/inexc-api/server.js" -o "$inexc_stage/server.js"
docker compose exec -T api node --input-type=module --check < "$inexc_stage/server.js"
cp -- server.js "$inexc_backup"
cp -- "$inexc_stage/server.js" server.js
inexc_installed=1
docker compose build api
inexc_started=1
docker compose up -d --no-build --no-deps api
for inexc_attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("learnerVersion")==1 else 1)' 2>/dev/null; then
    inexc_status="$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3000/api/memberships/card/shared?share=invalid')"
    if [[ "$inexc_status" == 404 ]]; then
      echo "Public card sharing API deployed. Backup: $inexc_api_dir/$inexc_backup"
      exit 0
    fi
  fi
  sleep 2
done
echo 'API health or sharing route check failed.' >&2
exit 1
