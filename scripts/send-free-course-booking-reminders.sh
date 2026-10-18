#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Usage: bash send-free-course-booking-reminders.sh FULL_COMMIT_SHA}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_api_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_tmp="$(mktemp -d)"
trap 'rm -rf -- "$inexc_tmp"' EXIT
curl -fsSL --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/send-incomplete-free-course-reminders.js" -o "$inexc_tmp/send-incomplete-free-course-reminders.js"
cd "$inexc_api_dir"
test -f message-suppression.js || { echo 'Deploy the current mail API first.' >&2; exit 1; }
docker compose ps -q api | grep -q . || { echo 'The API container must be running.' >&2; exit 1; }
docker compose exec -T api node --input-type=module --check < "$inexc_tmp/send-incomplete-free-course-reminders.js"
docker compose cp "$inexc_tmp/send-incomplete-free-course-reminders.js" api:/app/send-incomplete-free-course-reminders.js
echo 'Checking eligible cards (no recipient details printed):'
docker compose exec -T api node /app/send-incomplete-free-course-reminders.js --preview
echo 'Sending booking instructions to eligible card holders:'
docker compose exec -T api node /app/send-incomplete-free-course-reminders.js --send
echo 'Finished. Check the sent count above; rerunning skips cards already attempted.'
