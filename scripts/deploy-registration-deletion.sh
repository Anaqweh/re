#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
(( $# >= 1 && $# <= 2 )) || { echo 'Supply a full commit SHA and optionally --reset-existing-ai-registrations.' >&2; exit 1; }
inexc_delete_ref="$1"
inexc_delete_action="${2:-}"
[[ "$inexc_delete_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
[[ -z "$inexc_delete_action" || "$inexc_delete_action" == '--reset-existing-ai-registrations' ]] || { echo 'Unknown action.' >&2; exit 1; }
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_delete_container="$(docker compose ps -q api)"
[[ -n "$inexc_delete_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
inexc_delete_old_image="$(docker inspect --format '{{.Image}}' "$inexc_delete_container")"
inexc_delete_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_delete_container")"
inexc_delete_stage="$(mktemp -d)"
inexc_delete_backup="$(mktemp -d "$PWD/.registration-deletion-backup-XXXXXXXX")"
inexc_delete_installed=0
inexc_delete_started=0
inexc_delete_files=(server.js Dockerfile registration-deletion.js ai-licence-reset.js run-ai-licence-reset.js)
cleanup(){
 inexc_delete_exit=$?
 trap - EXIT
 if (( inexc_delete_exit != 0 && inexc_delete_installed == 1 )); then
  echo 'Restoring previous API files and image after installation failure.' >&2
  for inexc_delete_file in "${inexc_delete_files[@]}"; do
   if [[ -f "$inexc_delete_backup/$inexc_delete_file" ]]; then cp -- "$inexc_delete_backup/$inexc_delete_file" "$inexc_delete_file";
   elif [[ -f "$inexc_delete_backup/$inexc_delete_file.absent" ]]; then rm -f -- "$inexc_delete_file"; fi
  done
  if (( inexc_delete_started == 1 )); then docker tag "$inexc_delete_old_image" "$inexc_delete_image_name"; docker compose up -d --no-build --no-deps api; fi
 fi
 rm -rf -- "$inexc_delete_stage"
 exit "$inexc_delete_exit"
}
trap cleanup EXIT
for inexc_delete_file in server.js Dockerfile; do
 test -s "$inexc_delete_file" || { echo "Missing $inexc_delete_file" >&2; exit 1; }
 cp -- "$inexc_delete_file" "$inexc_delete_stage/$inexc_delete_file"
done
for inexc_delete_asset in scripts/patch-registration-deletion.py scripts/registration-deletion-patches.json inexc-api/registration-deletion.js inexc-api/ai-licence-reset.js inexc-api/run-ai-licence-reset.js; do
 curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_delete_ref/$inexc_delete_asset" -o "$inexc_delete_stage/${inexc_delete_asset##*/}"
done
python3 "$inexc_delete_stage/patch-registration-deletion.py" "$inexc_delete_stage" "$inexc_delete_stage/registration-deletion-patches.json"
for inexc_delete_file in server.js registration-deletion.js ai-licence-reset.js run-ai-licence-reset.js; do
 docker compose exec -T api node --input-type=module --check < "$inexc_delete_stage/$inexc_delete_file"
done
for inexc_delete_file in "${inexc_delete_files[@]}"; do
 if [[ -f "$inexc_delete_file" ]]; then cp -- "$inexc_delete_file" "$inexc_delete_backup/$inexc_delete_file"; else touch "$inexc_delete_backup/$inexc_delete_file.absent"; fi
done
inexc_delete_installed=1
for inexc_delete_file in "${inexc_delete_files[@]}"; do cp -- "$inexc_delete_stage/$inexc_delete_file" "$inexc_delete_file"; done
docker compose build api
inexc_delete_started=1
docker compose up -d --no-build --no-deps api
inexc_delete_healthy=0
for inexc_delete_attempt in {1..25}; do
 if curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("registrationDeletionVersion")==1 else 1)' 2>/dev/null; then inexc_delete_healthy=1; break; fi
 sleep 2
done
(( inexc_delete_healthy == 1 )) || { echo 'API health check failed.' >&2; exit 1; }
# Source deployment is complete. A later operation failure must not roll back installed safety checks.
inexc_delete_installed=0
echo 'Safe per-registrant deletion is active in the administration page.'
echo "Protected source backup: $inexc_delete_backup"
if [[ "$inexc_delete_action" == '--reset-existing-ai-registrations' ]]; then
 docker compose exec -T api node /app/run-ai-licence-reset.js --apply
 echo 'Waiting for the existing message worker. Suppressed recipients remain suppressed.'
 for inexc_delete_attempt in {1..30}; do
  docker compose exec -T api node /app/run-ai-licence-reset.js --status > "$inexc_delete_stage/status.json"
  if python3 - "$inexc_delete_stage/status.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
sys.exit(0 if s.get('campaignStatus') not in ('queued','sending') else 1)
PY
  then break; fi
  sleep 3
 done
 cat "$inexc_delete_stage/status.json"
 echo 'Delivery totals above come from the message center. Sent means accepted by the email provider; delivery/open events may arrive later.'
fi
