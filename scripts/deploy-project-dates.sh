#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Pass the full reviewed commit SHA}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
[[ "$(sha256sum server.js | cut -d ' ' -f1)" == "d887ff1699125e51eeb2f85599d167a0c462ebb768ddeea0344b2a8abc322116" && "$(sha256sum course-projects.js | cut -d ' ' -f1)" == "786f0514fe909abfb702707fac5ad194a7ff87da83763fcf37a944dcb4400c8d" ]] || { echo 'API files differ from reviewed baseline. Stop and compare.' >&2; exit 1; }
inexc_container="$(docker compose ps -q api)"
[[ -n "$inexc_container" ]] || exit 1
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_container")"
inexc_backup="course-project-dates-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$inexc_backup"
inexc_stage="$(mktemp -d)"
inexc_changed=0
inexc_files=(server.js course-projects.js)
rollback(){
 inexc_result=$?
 trap - EXIT
 if (( inexc_result != 0 && inexc_changed == 1 )); then
  for file in "${inexc_files[@]}"; do
   if [[ -f "$inexc_backup/$file" ]]; then cp "$inexc_backup/$file" "$file"; else rm -f "$file"; fi
  done
  docker tag "$inexc_old_image" "$inexc_image_name"
  docker compose up -d --no-build --no-deps api
  echo 'Previous API files and image restored. Additive project tables and stored files retained.' >&2
 fi
 rm -rf "$inexc_stage"
 exit "$inexc_result"
}
trap rollback EXIT
for file in "${inexc_files[@]}"; do
 [[ ! -f "$file" ]] || cp "$file" "$inexc_backup/$file"
 curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/$file" -o "$inexc_stage/$file"
done
for file in server.js course-projects.js; do docker exec -i "$inexc_container" node --check --input-type=module < "$inexc_stage/$file"; done
inexc_changed=1
for file in "${inexc_files[@]}"; do cp "$inexc_stage/$file" "$file"; done
docker compose build api
docker compose up -d --no-build --no-deps api
check_json(){
 python3 - "$1" "$2" "$3" <<'PYCHECK'
import json,sys
try:
 with open(sys.argv[1]) as f: value=json.load(f).get(sys.argv[2])
 sys.exit(0 if str(value)==sys.argv[3] else 1)
except (OSError,ValueError,AttributeError):
 sys.exit(1)
PYCHECK
}
inexc_ok=0
for attempt in {1..20}; do
 if curl --fail --silent http://127.0.0.1:3000/api/health -o "$inexc_stage/health.json" && check_json "$inexc_stage/health.json" courseProjectsVersion 3; then
  if curl --silent http://127.0.0.1:3000/api/course-projects/invalid -o "$inexc_stage/invalid.json" && check_json "$inexc_stage/invalid.json" error 'الرابط غير متاح.'; then
   [[ "$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/course-projects/11111111-1111-4111-8111-111111111111)" != 401 ]] || { inexc_ok=1; break; }
  fi
 fi
 sleep 2
done
(( inexc_ok == 1 )) || exit 1
echo "Project opening and closing dates are ready. Backup: $inexc_backup. Publish the reviewed frontend next."
echo 'No test submission or preview email was created. Existing scheduled workers and new-submission receipts resume on the server.'
