#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
(( $# == 1 || $# == 5 )) || { echo "Supply a commit, optionally followed by the exact reference, email, course ID and certificate amount." >&2; exit 1; }
inexc_certfix_ref="${1:?Usage: bash deploy-certificate-email-fix.sh FULL_COMMIT_SHA [REGISTRATION_REFERENCE EMAIL COURSE_ID AMOUNT_AED]}"
[[ "$inexc_certfix_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_certfix_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_certfix_dir"
docker compose config --services | grep -qx api || { echo 'Existing API service was not found.' >&2; exit 1; }
inexc_certfix_container="$(docker compose ps -q api)"
[[ -n "$inexc_certfix_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
inexc_certfix_old_image="$(docker inspect --format '{{.Image}}' "$inexc_certfix_container")"
inexc_certfix_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_certfix_container")"
inexc_certfix_stage="$(mktemp -d)"
inexc_certfix_backup="$(mktemp -d "$inexc_certfix_dir/.certificate-email-fix-backup-XXXXXXXX")"
inexc_certfix_installed=0
inexc_certfix_started=0
inexc_certfix_files=(server.js certificate-requests.js)
cleanup(){
  inexc_certfix_exit=$?
  trap - EXIT
  if (( inexc_certfix_exit != 0 && inexc_certfix_installed == 1 )); then
    echo 'Update failed; restoring previous API files and image.' >&2
    for inexc_certfix_file in "${inexc_certfix_files[@]}"; do
      if [[ -f "$inexc_certfix_backup/$inexc_certfix_file" ]]; then cp -- "$inexc_certfix_backup/$inexc_certfix_file" "$inexc_certfix_file";
      elif [[ -f "$inexc_certfix_backup/$inexc_certfix_file.absent" ]]; then rm -f -- "$inexc_certfix_file"; fi
    done
    if (( inexc_certfix_started == 1 )); then docker tag "$inexc_certfix_old_image" "$inexc_certfix_image_name"; docker compose up -d --no-build --no-deps api; fi
  fi
  rm -rf -- "$inexc_certfix_stage"
  exit "$inexc_certfix_exit"
}
trap cleanup EXIT
for inexc_certfix_file in "${inexc_certfix_files[@]}"; do
  test -s "$inexc_certfix_file" || { echo "Missing $inexc_certfix_file" >&2; exit 1; }
  cp -- "$inexc_certfix_file" "$inexc_certfix_stage/$inexc_certfix_file"
done
for inexc_certfix_asset in scripts/patch-certificate-email-fix.py scripts/certificate-email-fix-patches.json scripts/repair-requested-certificate.mjs; do
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_certfix_ref/$inexc_certfix_asset" -o "$inexc_certfix_stage/${inexc_certfix_asset##*/}"
done
python3 "$inexc_certfix_stage/patch-certificate-email-fix.py" "$inexc_certfix_stage" "$inexc_certfix_stage/certificate-email-fix-patches.json"
for inexc_certfix_file in server.js certificate-requests.js repair-requested-certificate.mjs; do
  docker compose exec -T api node --input-type=module --check < "$inexc_certfix_stage/$inexc_certfix_file"
done
for inexc_certfix_file in "${inexc_certfix_files[@]}"; do
  if [[ -f "$inexc_certfix_file" ]]; then cp -- "$inexc_certfix_file" "$inexc_certfix_backup/$inexc_certfix_file"; else touch "$inexc_certfix_backup/$inexc_certfix_file.absent"; fi
done
inexc_certfix_installed=1
for inexc_certfix_file in "${inexc_certfix_files[@]}"; do cp -- "$inexc_certfix_stage/$inexc_certfix_file" "$inexc_certfix_file"; done
docker compose build api
inexc_certfix_started=1
docker compose up -d --no-build --no-deps api
for inexc_certfix_attempt in {1..25}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if (lambda d: d.get("ok") is True and d.get("freeCardCertificateVersion")==1)(json.load(sys.stdin)) else 1)' 2>/dev/null; then
    inexc_certfix_installed=0
    echo 'Certificate selection and automatic certificate-payment email are enabled for free-card bookings.'
    echo "Protected source backup: $inexc_certfix_backup"
    if (( $# == 5 )); then
      docker compose exec -T -e INEXC_REPAIR_REFERENCE="$2" -e INEXC_REPAIR_EMAIL="$3" -e INEXC_REPAIR_COURSE="$4" -e INEXC_REPAIR_AMOUNT="$5" api node --input-type=module < "$inexc_certfix_stage/repair-requested-certificate.mjs"
    else
      echo 'No registration was repaired. Existing email workers resume their schedule.'
    fi
    exit 0
  fi
  sleep 2
done
echo 'API health check failed.' >&2
exit 1
