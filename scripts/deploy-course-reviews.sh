#!/usr/bin/env bash
# Run only on the existing INEXC API server, before merging the frontend PR.
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Pass the full reviewed commit SHA}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
# Refuse to overwrite any production hotfix or a different server revision.
[[ "$(sha256sum server.js | cut -d ' ' -f1)" == "0151d08caf63bbc91fd61725f44cd3f8e36b0b7806b13694c9f5652b07842c40" ]] || { echo 'Server differs from the reviewed baseline. Stop: compare changes before deploying.' >&2; exit 1; }
inexc_container="$(docker compose ps -q api)"
[[ -n "$inexc_container" ]] || exit 1
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_container")"
inexc_backup="course-reviews-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$inexc_backup"
cp server.js "$inexc_backup/server.js"
inexc_stage="$(mktemp)"
inexc_changed=0
rollback() {
  inexc_result=$?
  trap - EXIT
  rm -f "$inexc_stage"
  if (( inexc_result != 0 && inexc_changed == 1 )); then
    cp "$inexc_backup/server.js" server.js
    docker tag "$inexc_old_image" "$inexc_image_name"
    docker compose up -d --no-build --no-deps api
    echo 'Previous API restored. Additive review columns are retained.' >&2
  fi
  exit "$inexc_result"
}
trap rollback EXIT
curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/server.js" -o "$inexc_stage"
docker exec -i "$inexc_container" node --check --input-type=module < "$inexc_stage"
inexc_changed=1
cp "$inexc_stage" server.js
docker compose build api
docker compose up -d --no-build --no-deps api
inexc_ok=0
for attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null && curl --fail --silent http://127.0.0.1:3000/api/courses/00000000-0000-0000-0000-000000000000/testimonials | python3 -c 'import json,sys; assert json.load(sys.stdin)==[]'; then inexc_ok=1; break; fi
  sleep 2
done
(( inexc_ok == 1 )) || exit 1
echo "Course review API is ready. Backup: $inexc_backup. Merge the reviewed frontend changes next."
