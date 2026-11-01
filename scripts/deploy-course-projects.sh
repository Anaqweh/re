#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Pass the full reviewed commit SHA}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
[[ "$(sha256sum server.js | cut -d ' ' -f1)" == "6c8ba85d3ab4d43703da61722b203f269de405c71f814cac09724193e3b479a0" && ( "$(sha256sum Dockerfile | cut -d ' ' -f1)" == "9f2d11f40e96bb85e94e234a3c927c9fd26a321e68655009242b996e30397f00" || "$(sha256sum Dockerfile | cut -d ' ' -f1)" == "d2f7d225968dd116bd99599b7d103d9e346071c062fe1de74d28938f192f8283" ) ]] || { echo 'Production files differ from reviewed baseline. Stop and compare before deployment.' >&2; exit 1; }
inexc_container="$(docker compose ps -q api)"
[[ -n "$inexc_container" ]] || exit 1
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_container")"
inexc_backup="course-projects-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$inexc_backup"
inexc_stage="$(mktemp -d)"
inexc_changed=0
inexc_files=(server.js Dockerfile course-projects.js)
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
 if [[ "$file" == Dockerfile ]]; then
  cp Dockerfile "$inexc_stage/Dockerfile"
  printf '\nCOPY course-projects.js ./\n' >> "$inexc_stage/Dockerfile"
 else
  curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/$file" -o "$inexc_stage/$file"
 fi
done
for file in server.js course-projects.js; do docker exec -i "$inexc_container" node --check --input-type=module < "$inexc_stage/$file"; done
inexc_changed=1
for file in "${inexc_files[@]}"; do cp "$inexc_stage/$file" "$file"; done
docker compose build api
docker compose up -d --no-build --no-deps api
inexc_ok=0
for attempt in {1..20}; do
 if curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null; then
  if curl --silent http://127.0.0.1:3000/api/course-projects/invalid | python3 -c 'import json,sys; assert json.load(sys.stdin).get("error")=="الرابط غير متاح."'; then
   [[ "$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/course-projects/11111111-1111-4111-8111-111111111111)" != 401 ]] || { inexc_ok=1; break; }
  fi
 fi
 sleep 2
done
(( inexc_ok == 1 )) || exit 1
echo "Private course project API is ready. Backup: $inexc_backup. Publish the reviewed frontend next."
echo 'No messages, registrations, payments or project submissions were created. Existing scheduled workers resume their configured schedules.'
