#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_services_ref="${1:?Usage: bash deploy-service-catalog.sh COMMIT_SHA}"
[[ "$inexc_services_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_services_container="$(docker compose ps -q api)"
[[ -n "$inexc_services_container" ]] || { echo 'Existing api container is not running.' >&2; exit 1; }
inexc_services_image="$(docker inspect --format '{{.Image}}' "$inexc_services_container")"
inexc_services_tag="$(docker inspect --format '{{.Config.Image}}' "$inexc_services_container")"
inexc_services_stage="$(mktemp -d)"
inexc_services_backup="$PWD/services-backup-$(date -u +%Y%m%dT%H%M%S)-$$"
inexc_services_installed=0
inexc_services_started=0
inexc_services_files=(server.js Dockerfile service-catalog.js)
cleanup(){
 local result=$?
 trap - EXIT
 if (( result != 0 && inexc_services_installed == 1 )); then
  echo 'Update failed; restoring previous API files and image.' >&2
  for file in "${inexc_services_files[@]}"; do
   if [[ -f "$inexc_services_backup/$file" ]]; then cp -- "$inexc_services_backup/$file" "$file";
   elif [[ -f "$inexc_services_backup/$file.absent" ]]; then rm -f -- "$file"; fi
  done
  docker tag "$inexc_services_image" "$inexc_services_tag"
  if (( inexc_services_started == 1 )); then docker compose up -d --no-build --no-deps api; fi
 fi
 rm -rf -- "$inexc_services_stage"
 exit "$result"
}
trap cleanup EXIT
cp -- server.js Dockerfile "$inexc_services_stage/"
curl -fsSL --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_services_ref/inexc-api/service-catalog.js" -o "$inexc_services_stage/service-catalog.js"
curl -fsSL --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_services_ref/scripts/patch-service-catalog.py" -o "$inexc_services_stage/patch.py"
python3 "$inexc_services_stage/patch.py" "$inexc_services_stage"
# Parse with the existing container's Node, before changing host files.
for file in server.js service-catalog.js; do docker compose exec -T api node --input-type=module --check < "$inexc_services_stage/$file"; done
mkdir -p "$inexc_services_backup"
for file in "${inexc_services_files[@]}"; do
 if [[ -f "$file" ]]; then cp -- "$file" "$inexc_services_backup/$file"; else touch "$inexc_services_backup/$file.absent"; fi
done
inexc_services_installed=1
for file in "${inexc_services_files[@]}"; do cp -- "$inexc_services_stage/$file" "$file"; done
docker compose build api
inexc_services_started=1
docker compose up -d --no-build --no-deps api
inexc_services_healthy=0
for attempt in {1..20}; do
 if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 &&
    curl -fsS http://127.0.0.1:3000/api/services | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("version")==1 and isinstance(d.get("items"),list) else 1)' 2>/dev/null &&
    [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/services)" == 401 ]]; then
  inexc_services_healthy=1; break
 fi
 sleep 2
done
(( inexc_services_healthy == 1 )) || { echo 'Service catalogue health check failed.' >&2; exit 1; }
echo 'INEXC services enabled. Add services from Administration > Services.'
echo 'No services, registrations, payments or emails were created by this update.'
echo 'Existing scheduled workers resume their previously configured schedule.'
echo "Previous files: $inexc_services_backup"
