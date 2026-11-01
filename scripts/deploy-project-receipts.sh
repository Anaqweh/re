#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Pass the full reviewed commit SHA}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
[[ "$(sha256sum server.js | cut -d ' ' -f1)" == "7aefdc5a16c7f5426b1c9af0cfb67603c64ae329fed033b60c968e4a7257eecd" && "$(sha256sum course-projects.js | cut -d ' ' -f1)" == "2de7868f446c7e44177170d41e985dcf12a7f89f9e375cf33212e894f26c6cc0" ]] || { echo 'API files differ from reviewed baseline. Stop and compare.' >&2; exit 1; }
case "$(sha256sum Dockerfile | cut -d ' ' -f1)" in
 8224fe6c66c211699824777752576041067566550457f2698211a89810ee4a60|69d9c0358d016b514f7f273a344374235b927b5865036a2222d515f2e1357c45|ef0e8475bbabb978384e4fa9a8718a8cebb4973d154197986b120e865bea2731) ;;
 *) echo 'Dockerfile differs from reviewed variants. Stop and compare.' >&2; exit 1;;
esac
inexc_container="$(docker compose ps -q api)"
[[ -n "$inexc_container" ]] || exit 1
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_container")"
inexc_backup="course-project-receipts-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$inexc_backup"
inexc_stage="$(mktemp -d)"
inexc_changed=0
inexc_files=(server.js Dockerfile course-projects.js project-receipt.js)
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
  printf '\nCOPY project-receipt.js ./\n' >> "$inexc_stage/Dockerfile"
 else
  curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/$file" -o "$inexc_stage/$file"
 fi
done
for file in server.js course-projects.js project-receipt.js; do docker exec -i "$inexc_container" node --check --input-type=module < "$inexc_stage/$file"; done
inexc_changed=1
for file in "${inexc_files[@]}"; do cp "$inexc_stage/$file" "$file"; done
docker compose build api
docker compose up -d --no-build --no-deps api
inexc_ok=0
for attempt in {1..20}; do
 if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; assert json.load(sys.stdin).get("courseProjectsVersion")==2'; then
  if curl --silent http://127.0.0.1:3000/api/course-projects/invalid | python3 -c 'import json,sys; assert json.load(sys.stdin).get("error")=="الرابط غير متاح."'; then
   [[ "$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/course-projects/11111111-1111-4111-8111-111111111111)" != 401 ]] || { inexc_ok=1; break; }
  fi
 fi
 sleep 2
done
(( inexc_ok == 1 )) || exit 1
echo "Project receipt queue is ready. Backup: $inexc_backup. Publish the reviewed frontend next."
echo 'No test submission or preview email was created. Existing scheduled workers and new-submission receipts resume on the server.'
