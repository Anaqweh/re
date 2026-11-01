#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Pass the full reviewed commit SHA, optionally followed by live Checkout session IDs}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
shift
for inexc_session in "$@"; do [[ "$inexc_session" =~ ^cs_live_[a-zA-Z0-9]+$ || "$inexc_session" == --reviewed-match=* ]] || exit 1; done
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_stage="$(mktemp -d)"
inexc_changed=0
inexc_files=(server.js certificate-requests.js certificate-link-payments.js Dockerfile)
cleanup(){
 inexc_result=$?
 trap - EXIT
 if (( inexc_result != 0 && inexc_changed == 1 )); then
  for file in "${inexc_files[@]}"; do
   if [[ -f "$inexc_backup/$file" ]]; then cp "$inexc_backup/$file" "$file"; else rm -f "$file"; fi
  done
  docker tag "$inexc_old_image" "$inexc_image_name"
  docker compose up -d --no-build --no-deps api
  echo 'Previous API files and image restored. Additive receipt table retained.' >&2
 fi
 rm -rf "$inexc_stage"
 exit "$inexc_result"
}
trap cleanup EXIT
for file in server.js certificate-requests.js certificate-link-payments.js; do
 curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/$file" -o "$inexc_stage/$file"
done
curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/scripts/reconcile-certificate-link-payments.mjs" -o "$inexc_stage/reconcile.mjs"
inexc_server_hash="$(sha256sum server.js | cut -d ' ' -f1)"
inexc_certificate_hash="$(sha256sum certificate-requests.js | cut -d ' ' -f1)"
[[ "$inexc_server_hash" == '0b20481c32af562258fd5b342528be5db8134b68ef1fcbdde0b2fb8d4d168c1c' || "$inexc_server_hash" == 'eba910d054de1029ad52eccedd3db9725d23a60ecd3d6e8be740431f515c7514' || "$inexc_server_hash" == "$(sha256sum "$inexc_stage/server.js" | cut -d ' ' -f1)" ]] || { echo 'server.js differs from the reviewed baseline. Stop and compare.' >&2; exit 1; }
[[ "$inexc_certificate_hash" == 'bb4eb17146e8733f49ea6942f89865b1ffe8cd2a4f000e46db78fc199b325959' || "$inexc_certificate_hash" == 'a46ef58054aba151934a2b944a63a2db6d72b6067d2739c1b720546f3bae2f55' || "$inexc_certificate_hash" == "$(sha256sum "$inexc_stage/certificate-requests.js" | cut -d ' ' -f1)" ]] || { echo 'certificate-requests.js differs from the reviewed baseline. Stop and compare.' >&2; exit 1; }
if [[ -f certificate-link-payments.js ]]; then [[ "$(sha256sum certificate-link-payments.js | cut -d ' ' -f1)" == '8accb1ee866cb214bd91cba5ae4c8c9c770a0b3dd97665111fad28119479c631' ]] || cmp -s certificate-link-payments.js "$inexc_stage/certificate-link-payments.js" || { echo 'Existing receipt module differs. Stop and compare.' >&2; exit 1; }; fi
cp Dockerfile "$inexc_stage/Dockerfile"
if ! grep -Fxq 'COPY certificate-link-payments.js ./' "$inexc_stage/Dockerfile"; then printf '\nCOPY certificate-link-payments.js ./\n' >> "$inexc_stage/Dockerfile"; fi
inexc_container="$(docker compose ps -q api)"
[[ -n "$inexc_container" ]] || { echo 'API container is not running.' >&2; exit 1; }
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_container")"
for file in server.js certificate-requests.js certificate-link-payments.js reconcile.mjs; do docker exec -i "$inexc_container" node --check --input-type=module < "$inexc_stage/$file"; done
inexc_backup="certificate-link-payments-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$inexc_backup"
for file in "${inexc_files[@]}"; do [[ ! -f "$file" ]] || cp "$file" "$inexc_backup/$file"; done
printf '%s\n' "$inexc_old_image" > "$inexc_backup/previous-image.txt"
inexc_changed=1
for file in "${inexc_files[@]}"; do cp "$inexc_stage/$file" "$file"; done
docker compose build api
docker compose up -d --no-build --no-deps api
inexc_ok=0
for attempt in {1..20}; do
 if curl --fail --silent http://127.0.0.1:3000/api/health -o "$inexc_stage/health.json" && python3 - "$inexc_stage/health.json" <<'PYCHECK'
import json,sys
try:
 with open(sys.argv[1]) as f: data=json.load(f)
 sys.exit(0 if data.get('certificateLinkPaymentsVersion')==2 and data.get('courseProjectsVersion')==3 else 1)
except (OSError,ValueError,AttributeError): sys.exit(1)
PYCHECK
 then
  if [[ "$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/certificate-link-payments)" == 401 ]]; then inexc_ok=1; break; fi
 fi
 sleep 2
done
(( inexc_ok == 1 )) || { echo 'New API health/authentication check failed.' >&2; exit 1; }
inexc_changed=0
echo "Certificate Payment Link handling is ready. Backup: $inexc_backup. Publish the reviewed frontend next."
echo 'No test charge, registration, certificate or email was created. Existing scheduled workers resume their configured schedules.'
if (( $# > 0 )); then
 echo 'Checking all supplied sessions and charges with Stripe before recording receipts.'
 if ! docker compose exec -T api node --input-type=module - --apply "$@" < "$inexc_stage/reconcile.mjs"; then
  echo 'The API update remains installed. Receipt reconciliation stopped; inspect the operation/permission diagnostic above. Do not manually mark payments paid.' >&2
  exit 1
 fi
fi
