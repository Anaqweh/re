#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
(( $# == 1 )) || { echo "Supply one full commit SHA." >&2; exit 1; }
inexc_contact_ref="${1:?Usage: bash deploy-certificate-contact.sh FULL_COMMIT_SHA}"
[[ "$inexc_contact_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_contact_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_contact_dir"
docker compose config --services | grep -qx api || { echo 'Existing API service was not found.' >&2; exit 1; }
inexc_contact_container="$(docker compose ps -q api)"
[[ -n "$inexc_contact_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
inexc_contact_old_image="$(docker inspect --format '{{.Image}}' "$inexc_contact_container")"
inexc_contact_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_contact_container")"
inexc_contact_stage="$(mktemp -d)"
inexc_contact_backup="$(mktemp -d "$inexc_contact_dir/.certificate-contact-backup-XXXXXXXX")"
inexc_contact_installed=0
inexc_contact_started=0
inexc_contact_files=(certificate-requests.js)
cleanup(){
  inexc_contact_exit=$?
  trap - EXIT
  if (( inexc_contact_exit != 0 && inexc_contact_installed == 1 )); then
    echo 'Update failed; restoring previous API files and image.' >&2
    for inexc_contact_file in "${inexc_contact_files[@]}"; do
      if [[ -f "$inexc_contact_backup/$inexc_contact_file" ]]; then cp -- "$inexc_contact_backup/$inexc_contact_file" "$inexc_contact_file";
      elif [[ -f "$inexc_contact_backup/$inexc_contact_file.absent" ]]; then rm -f -- "$inexc_contact_file"; fi
    done
    if (( inexc_contact_started == 1 )); then docker tag "$inexc_contact_old_image" "$inexc_contact_image_name"; docker compose up -d --no-build --no-deps api; fi
  fi
  rm -rf -- "$inexc_contact_stage"
  exit "$inexc_contact_exit"
}
trap cleanup EXIT
for inexc_contact_file in "${inexc_contact_files[@]}"; do
  test -s "$inexc_contact_file" || { echo "Missing $inexc_contact_file" >&2; exit 1; }
  cp -- "$inexc_contact_file" "$inexc_contact_stage/$inexc_contact_file"
done
for inexc_contact_asset in scripts/patch-certificate-contact.py scripts/certificate-contact-patches.json; do
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_contact_ref/$inexc_contact_asset" -o "$inexc_contact_stage/${inexc_contact_asset##*/}"
done
python3 "$inexc_contact_stage/patch-certificate-contact.py" "$inexc_contact_stage" "$inexc_contact_stage/certificate-contact-patches.json"
for inexc_contact_file in "${inexc_contact_files[@]}"; do
  docker compose exec -T api node --input-type=module --check < "$inexc_contact_stage/$inexc_contact_file"
done
for inexc_contact_file in "${inexc_contact_files[@]}"; do
  if [[ -f "$inexc_contact_file" ]]; then cp -- "$inexc_contact_file" "$inexc_contact_backup/$inexc_contact_file"; else touch "$inexc_contact_backup/$inexc_contact_file.absent"; fi
done
inexc_contact_installed=1
for inexc_contact_file in "${inexc_contact_files[@]}"; do cp -- "$inexc_contact_stage/$inexc_contact_file" "$inexc_contact_file"; done
docker compose build api
inexc_contact_started=1
docker compose up -d --no-build --no-deps api
for inexc_contact_attempt in {1..25}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/certificate-requests/capabilities | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("contactDetails") is True else 1)' 2>/dev/null; then
    inexc_contact_installed=0
    echo 'The private certificate page can now display the registered email and phone number.'
    echo 'No registration, fee or contact data was changed. No test email or payment was created.'
    echo "Protected source backup: $inexc_contact_backup"
    exit 0
  fi
  sleep 2
done
echo 'API health check failed.' >&2
exit 1
