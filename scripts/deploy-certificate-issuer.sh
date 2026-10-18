#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
(( $# == 1 )) || { echo "Supply one full commit SHA." >&2; exit 1; }
inexc_issuer_ref="${1:?Usage: bash deploy-certificate-issuer.sh FULL_COMMIT_SHA}"
[[ "$inexc_issuer_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_issuer_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_issuer_dir"
docker compose config --services | grep -qx api || { echo 'Existing API service was not found.' >&2; exit 1; }
inexc_issuer_container="$(docker compose ps -q api)"
[[ -n "$inexc_issuer_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
inexc_issuer_old_image="$(docker inspect --format '{{.Image}}' "$inexc_issuer_container")"
inexc_issuer_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_issuer_container")"
inexc_issuer_stage="$(mktemp -d)"
inexc_issuer_backup="$(mktemp -d "$inexc_issuer_dir/.certificate-issuer-backup-XXXXXXXX")"
inexc_issuer_installed=0
inexc_issuer_started=0
inexc_issuer_files=(server.js certificate-requests.js)
cleanup(){
  inexc_issuer_exit=$?
  trap - EXIT
  if (( inexc_issuer_exit != 0 && inexc_issuer_installed == 1 )); then
    echo 'Update failed; restoring previous API files and image.' >&2
    for inexc_issuer_file in "${inexc_issuer_files[@]}"; do
      if [[ -f "$inexc_issuer_backup/$inexc_issuer_file" ]]; then cp -- "$inexc_issuer_backup/$inexc_issuer_file" "$inexc_issuer_file";
      elif [[ -f "$inexc_issuer_backup/$inexc_issuer_file.absent" ]]; then rm -f -- "$inexc_issuer_file"; fi
    done
    if (( inexc_issuer_started == 1 )); then docker tag "$inexc_issuer_old_image" "$inexc_issuer_image_name"; docker compose up -d --no-build --no-deps api; fi
  fi
  rm -rf -- "$inexc_issuer_stage"
  exit "$inexc_issuer_exit"
}
trap cleanup EXIT
for inexc_issuer_file in "${inexc_issuer_files[@]}"; do
  test -s "$inexc_issuer_file" || { echo "Missing $inexc_issuer_file" >&2; exit 1; }
  cp -- "$inexc_issuer_file" "$inexc_issuer_stage/$inexc_issuer_file"
done
for inexc_issuer_asset in scripts/patch-certificate-issuer.py scripts/certificate-issuer-patches.json scripts/certificate-contact-patches.json; do
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_issuer_ref/$inexc_issuer_asset" -o "$inexc_issuer_stage/${inexc_issuer_asset##*/}"
done
if ! grep -Fq 'contactDetails:true' "$inexc_issuer_stage/certificate-requests.js"; then
  python3 "$inexc_issuer_stage/patch-certificate-issuer.py" "$inexc_issuer_stage" "$inexc_issuer_stage/certificate-contact-patches.json"
fi
python3 "$inexc_issuer_stage/patch-certificate-issuer.py" "$inexc_issuer_stage" "$inexc_issuer_stage/certificate-issuer-patches.json"
for inexc_issuer_file in "${inexc_issuer_files[@]}"; do
  docker compose exec -T api node --input-type=module --check < "$inexc_issuer_stage/$inexc_issuer_file"
done
for inexc_issuer_file in "${inexc_issuer_files[@]}"; do
  if [[ -f "$inexc_issuer_file" ]]; then cp -- "$inexc_issuer_file" "$inexc_issuer_backup/$inexc_issuer_file"; else touch "$inexc_issuer_backup/$inexc_issuer_file.absent"; fi
done
inexc_issuer_installed=1
for inexc_issuer_file in "${inexc_issuer_files[@]}"; do cp -- "$inexc_issuer_stage/$inexc_issuer_file" "$inexc_issuer_file"; done
docker compose build api
inexc_issuer_started=1
docker compose up -d --no-build --no-deps api
for inexc_issuer_attempt in {1..25}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/certificate-requests/capabilities | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("certificateIssuer") is True else 1)' 2>/dev/null; then
    inexc_issuer_installed=0
    echo 'Certificate issuer can now be saved per course and appears in new certificate request emails.'
    echo 'No course issuer was filled automatically. No test email, registration or payment was created. Existing workers resume their schedule.'
    echo "Protected source backup: $inexc_issuer_backup"
    exit 0
  fi
  sleep 2
done
echo 'API health check failed.' >&2
exit 1
