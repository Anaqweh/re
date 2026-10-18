#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_release_ref="${1:?Usage: bash deploy-free-memberships.sh FULL_COMMIT_SHA}"
[[ "$inexc_release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_api_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_api_dir"
docker compose config --services | grep -qx api || { echo 'Existing api service was not found.' >&2; exit 1; }
inexc_old_container="$(docker compose ps -q api)"
[[ -n "$inexc_old_container" ]] || { echo 'The API container is not running.' >&2; exit 1; }
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_old_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_old_container")"
inexc_stage="$(mktemp -d)"
inexc_backup="$(mktemp -d "$inexc_api_dir/.free-membership-backup-XXXXXXXX")"
inexc_installed=0
inexc_started=0
cleanup(){
  inexc_exit=$?
  trap - EXIT
  if (( inexc_exit != 0 && inexc_installed == 1 )); then
    echo 'Restoring previous API files and image.' >&2
    for inexc_file in server.js membership-payments.js learner-service.js; do cp -- "$inexc_backup/$inexc_file" "$inexc_file"; done
    if (( inexc_started == 1 )); then
      docker tag "$inexc_old_image" "$inexc_image_name"
      docker compose up -d --no-build --no-deps api
    fi
  fi
  rm -rf -- "$inexc_stage"
  exit "$inexc_exit"
}
trap cleanup EXIT
for inexc_file in server.js membership-payments.js learner-service.js; do
  test -f "$inexc_file" || { echo "Missing $inexc_file" >&2; exit 1; }
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_release_ref/inexc-api/$inexc_file" -o "$inexc_stage/$inexc_file"
  docker compose exec -T api node --input-type=module --check < "$inexc_stage/$inexc_file"
  cp -- "$inexc_file" "$inexc_backup/$inexc_file"
done
for inexc_file in server.js membership-payments.js learner-service.js; do cp -- "$inexc_stage/$inexc_file" "$inexc_file"; done
inexc_installed=1
docker compose build api
inexc_started=1
docker compose up -d --no-build --no-deps api
for inexc_attempt in {1..25}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("learnerVersion")==1 else 1)' 2>/dev/null; then
    echo "Free membership API deployed. Backup: $inexc_backup"
    exit 0
  fi
  sleep 2
done
echo 'API health check failed.' >&2
exit 1
