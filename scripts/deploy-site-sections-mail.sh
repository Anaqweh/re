#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
release_ref="${1:?Usage: bash deploy-site-sections-mail.sh FULL_COMMIT_SHA}"
[[ "$release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
api_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$api_dir"
docker compose config --services | grep -qx api
old_container="$(docker compose ps -q api)"
[[ -n "$old_container" ]] || { echo 'The API container is not running.' >&2; exit 1; }
old_image="$(docker inspect --format '{{.Image}}' "$old_container")"
image_name="$(docker inspect --format '{{.Config.Image}}' "$old_container")"
stage="$(mktemp -d)"
backup="$(mktemp -d "$api_dir/.site-sections-mail-backup-XXXXXXXX")"
installed=0
started=0
files=(server.js message-mail.js message-studio.js membership-payments.js learner-service.js)
cleanup(){
  exit_status=$?
  trap - EXIT
  if (( exit_status != 0 && installed == 1 )); then
    echo 'Restoring previous API files and image.' >&2
    for file in "${files[@]}"; do cp -- "$backup/$file" "$file"; done
    if (( started == 1 )); then
      docker tag "$old_image" "$image_name"
      docker compose up -d --no-build --no-deps api
    fi
  fi
  rm -rf -- "$stage"
  exit "$exit_status"
}
trap cleanup EXIT
for file in "${files[@]}"; do
  test -f "$file" || { echo "Missing $file" >&2; exit 1; }
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$release_ref/inexc-api/$file" -o "$stage/$file"
  docker compose exec -T api node --input-type=module --check < "$stage/$file"
  cp -- "$file" "$backup/$file"
done
for file in "${files[@]}"; do cp -- "$stage/$file" "$file"; done
installed=1
docker compose build api
started=1
docker compose up -d --no-build --no-deps api
for attempt in {1..25}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("messageStudioVersion")==5 else 1)' 2>/dev/null; then
    echo "Site sections and mail API deployed. Backup: $backup"
    exit 0
  fi
  sleep 2
done
echo 'API health check failed.' >&2
exit 1
