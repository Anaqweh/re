#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Run on the existing INEXC Training droplet. Pin every download to one commit.
inexc_release_ref="${1:?Usage: bash deploy-message-center.sh COMMIT_SHA}"
[[ "$inexc_release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_api_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_api_dir"
docker compose config --services | grep -qx api || { echo 'Existing api service was not found.' >&2; exit 1; }

inexc_stage="$(mktemp -d)"
inexc_backup="$inexc_api_dir/message-center-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$inexc_backup"
inexc_old_container="$(docker compose ps -q api)"
[[ -n "$inexc_old_container" ]] || { echo 'The existing API container is not running.' >&2; exit 1; }
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_old_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_old_container")"
inexc_installed=0
inexc_started=0
inexc_files=(server.js learner-service.js course-payment.js stripe-payments.js membership-payments.js check-stripe-readiness.js import-course-catalog.js course-catalog-20261016.json message-subscriptions.js message-subscription-links.js message-contacts.js message-file-reader.py message-format.js message-mail.js message-mail-legacy.js message-mail-v4.js message-format-v4.js message-design.js message-font-faces.js message-studio.js message-studio-schema.js message-suppression.js package.json Dockerfile)

inexc_rollback() {
  local inexc_exit=$?
  trap - EXIT
  if (( inexc_exit != 0 && inexc_installed == 1 )); then
    echo 'Deployment failed; restoring the previous API files.' >&2
    for inexc_file in "${inexc_files[@]}"; do
      if [[ -f "$inexc_backup/$inexc_file" ]]; then
        cp -- "$inexc_backup/$inexc_file" "$inexc_api_dir/$inexc_file"
      elif [[ -f "$inexc_backup/$inexc_file.absent" ]]; then
        rm -f -- "$inexc_api_dir/$inexc_file"
      fi
    done
    if (( inexc_started == 1 )); then
      docker tag "$inexc_old_image" "$inexc_image_name"
      docker compose up -d --no-build --no-deps api
    fi
  fi
  rm -rf -- "$inexc_stage"
  exit "$inexc_exit"
}
trap inexc_rollback EXIT

for inexc_file in "${inexc_files[@]}"; do
  curl --fail --silent --show-error --location --retry 2 \
    "https://raw.githubusercontent.com/Anaqweh/re/$inexc_release_ref/inexc-api/$inexc_file" \
    -o "$inexc_stage/$inexc_file"
  [[ -s "$inexc_stage/$inexc_file" ]]
  if [[ -f "$inexc_file" ]]; then cp -- "$inexc_file" "$inexc_backup/$inexc_file";
  else touch "$inexc_backup/$inexc_file.absent"; fi
done
inexc_installed=1
for inexc_file in "${inexc_files[@]}"; do cp -- "$inexc_stage/$inexc_file" "$inexc_file"; done
docker compose build api
inexc_started=1
docker compose up -d --no-build --no-deps api

inexc_healthy=0
for inexc_attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if (lambda h: h.get("messageStudioVersion")==5 and h.get("subscriptionsVersion")==2)(json.load(sys.stdin)) else 1)' 2>/dev/null; then
    inexc_route_status="$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/message-capabilities)"
    if [[ "$inexc_route_status" == 401 ]]; then inexc_healthy=1; break; fi
  fi
  sleep 2
done
(( inexc_healthy == 1 )) || { echo 'API health or message-center route check failed.' >&2; exit 1; }
echo 'INEXC message center API deployed. This script does not create or send test campaigns; the worker resumes previously authorized queued/scheduled campaigns.'
echo "Previous API files: $inexc_backup"
