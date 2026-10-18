#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_cert_ref="${1:?Usage: bash deploy-certificate-requests.sh FULL_COMMIT_SHA}"
[[ "$inexc_cert_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_cert_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_cert_dir"
docker compose config --services | grep -qx api || { echo 'Existing API service was not found.' >&2; exit 1; }
inexc_cert_container="$(docker compose ps -q api)"
[[ -n "$inexc_cert_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
inexc_cert_old_image="$(docker inspect --format '{{.Image}}' "$inexc_cert_container")"
inexc_cert_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_cert_container")"
inexc_cert_stage="$(mktemp -d)"
inexc_cert_backup="$(mktemp -d "$inexc_cert_dir/.certificate-requests-backup-XXXXXXXX")"
inexc_cert_installed=0
inexc_cert_started=0
inexc_cert_files=(server.js learner-service.js Dockerfile certificate-requests.js)
cleanup(){
  inexc_cert_exit=$?
  trap - EXIT
  if (( inexc_cert_exit != 0 && inexc_cert_installed == 1 )); then
    echo 'Update failed; restoring previous API files and image.' >&2
    for inexc_cert_file in "${inexc_cert_files[@]}"; do
      if [[ -f "$inexc_cert_backup/$inexc_cert_file" ]]; then cp -- "$inexc_cert_backup/$inexc_cert_file" "$inexc_cert_file";
      elif [[ -f "$inexc_cert_backup/$inexc_cert_file.absent" ]]; then rm -f -- "$inexc_cert_file"; fi
    done
    if (( inexc_cert_started == 1 )); then docker tag "$inexc_cert_old_image" "$inexc_cert_image_name"; docker compose up -d --no-build --no-deps api; fi
  fi
  rm -rf -- "$inexc_cert_stage"
  exit "$inexc_cert_exit"
}
trap cleanup EXIT
for inexc_cert_file in server.js learner-service.js Dockerfile; do
  test -s "$inexc_cert_file" || { echo "Missing $inexc_cert_file" >&2; exit 1; }
  cp -- "$inexc_cert_file" "$inexc_cert_stage/$inexc_cert_file"
done
for inexc_cert_asset in scripts/patch-certificate-requests.py scripts/certificate-request-patches.json inexc-api/certificate-requests.js; do
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_cert_ref/$inexc_cert_asset" -o "$inexc_cert_stage/${inexc_cert_asset##*/}"
done
python3 "$inexc_cert_stage/patch-certificate-requests.py" "$inexc_cert_stage" "$inexc_cert_stage/certificate-request-patches.json"
for inexc_cert_file in server.js learner-service.js certificate-requests.js; do
  docker compose exec -T api node --input-type=module --check < "$inexc_cert_stage/$inexc_cert_file"
done
for inexc_cert_file in "${inexc_cert_files[@]}"; do
  if [[ -f "$inexc_cert_file" ]]; then cp -- "$inexc_cert_file" "$inexc_cert_backup/$inexc_cert_file"; else touch "$inexc_cert_backup/$inexc_cert_file.absent"; fi
done
inexc_cert_installed=1
for inexc_cert_file in "${inexc_cert_files[@]}"; do cp -- "$inexc_cert_stage/$inexc_cert_file" "$inexc_cert_file"; done
docker compose build api
inexc_cert_started=1
docker compose up -d --no-build --no-deps api
for inexc_cert_attempt in {1..25}; do
  if curl --fail --silent http://127.0.0.1:3000/api/certificate-requests/capabilities | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("version")==1 and d.get("deferredFreeCourse") is True and d.get("electronicEnabled") is True and d.get("emailEnabled") is True else 1)' 2>/dev/null; then
    inexc_cert_auth="$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/certificate-requests)"
    if [[ "$inexc_cert_auth" == 401 ]]; then
      echo 'Certificate requests are active. New certificate requests are emailed after about 3 minutes.'
      echo 'Existing course prices, payment methods, balances and historical registrations were preserved.'
      echo 'No test payment, registration or email was created. Existing scheduled workers resume their schedule.'
      echo "Protected source backup: $inexc_cert_backup"
      curl --fail --silent http://127.0.0.1:3000/api/certificate-requests/capabilities
      echo
      exit 0
    fi
  fi
  sleep 2
done
echo 'Certificate requests, email/Stripe configuration, or protected admin check failed.' >&2
exit 1
