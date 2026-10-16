#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Apply copy changes to the installed API; do not deploy unrelated features.
inexc_release_ref="${1:?Usage: bash deploy-package-names.sh COMMIT_SHA}"
[[ "$inexc_release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_api_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_api_dir"
inexc_old_container="$(docker compose ps -q api)"
[[ -n "$inexc_old_container" ]] || { echo 'The existing API container is not running.' >&2; exit 1; }
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_old_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_old_container")"
inexc_stage="$(mktemp -d)"
inexc_backup="$inexc_api_dir/package-names-backup-$(date -u +%Y%m%dT%H%M%S%NZ)"
inexc_files=(server.js learner-service.js membership-payments.js course-payment.js stripe-payments.js)
inexc_installed=0
inexc_started=0

inexc_rollback() {
  local inexc_exit=$?
  trap - EXIT
  if (( inexc_exit != 0 && inexc_installed == 1 )); then
    echo 'Update failed; restoring the previous API wording.' >&2
    for inexc_file in "${inexc_files[@]}"; do cp -- "$inexc_backup/$inexc_file" "$inexc_api_dir/$inexc_file"; done
    if (( inexc_started == 1 )); then
      docker tag "$inexc_old_image" "$inexc_image_name"
      docker compose up -d --no-build --no-deps api
    fi
  fi
  rm -rf -- "$inexc_stage"
  exit "$inexc_exit"
}
trap inexc_rollback EXIT
curl --fail --silent --show-error --location --retry 2 \
  "https://raw.githubusercontent.com/Anaqweh/re/$inexc_release_ref/scripts/rename-training-package-copy.py" \
  -o "$inexc_stage/rename.py"
python3 "$inexc_stage/rename.py" "$inexc_api_dir" "$inexc_stage/api"
docker run --rm --network none --entrypoint sh -v "$inexc_stage/api:/copy-check:ro" "$inexc_old_image" \
  -c 'for file in /copy-check/*.js; do node --input-type=module --check < "$file" || exit 1; done'
mkdir -p "$inexc_backup"
for inexc_file in "${inexc_files[@]}"; do cp -- "$inexc_file" "$inexc_backup/$inexc_file"; done
inexc_installed=1
for inexc_file in "${inexc_files[@]}"; do cp -- "$inexc_stage/api/$inexc_file" "$inexc_file"; done
docker compose build api
inexc_started=1
docker compose up -d --no-build --no-deps api
inexc_healthy=0
for inexc_attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("trainingPackageLabelsVersion")==1 else 1)' 2>/dev/null; then
    inexc_healthy=1; break
  fi
  sleep 2
done
(( inexc_healthy == 1 )) || { echo 'API wording version could not be verified.' >&2; exit 1; }
echo 'Training-package names are active in the API, new payment sessions and activation/recovery emails.'
echo 'No test purchases, registrations or emails were created. Existing scheduled workers resume their configured schedule.'
echo "Previous API files: $inexc_backup"
