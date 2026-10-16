#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_content_ref="${1:?Usage: bash deploy-course-content.sh COMMIT_SHA}"
[[ "$inexc_content_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_content_container="$(docker compose ps -q api)"
[[ -n "$inexc_content_container" ]] || { echo 'The existing API container is not running.' >&2; exit 1; }
inexc_content_stage="$(mktemp -d)"
trap 'rm -rf -- "$inexc_content_stage"' EXIT
mkdir -p "$inexc_content_stage/assets"
inexc_content_base="https://raw.githubusercontent.com/Anaqweh/re/$inexc_content_ref"
for inexc_content_file in update-course-content.js course-content-20261016.json; do
 curl --fail --silent --show-error --location --retry 2 "$inexc_content_base/inexc-api/$inexc_content_file" -o "$inexc_content_stage/$inexc_content_file"
done
python3 - "$inexc_content_stage/course-content-20261016.json" > "$inexc_content_stage/asset-list" <<'PY'
import json,re,sys
data=json.load(open(sys.argv[1]))
assert data['batch']=='inexc-course-content-20261016' and len(data['courses'])==11
for c in data['courses']:
 assert re.fullmatch(r'assets/courses/[a-z0-9-]+-20261016\.webp',c['imageFile'])
 print(c['imageFile'])
PY
while IFS= read -r inexc_content_asset; do
 curl --fail --silent --show-error --location --retry 2 "$inexc_content_base/$inexc_content_asset" -o "$inexc_content_stage/assets/${inexc_content_asset##*/}"
done < "$inexc_content_stage/asset-list"
python3 - "$inexc_content_stage" <<'PY'
import pathlib,json,hashlib,sys
stage=pathlib.Path(sys.argv[1])
for c in json.loads((stage/'course-content-20261016.json').read_text())['courses']:
 assert hashlib.sha256((stage/'assets'/pathlib.Path(c['imageFile']).name).read_bytes()).hexdigest()==c['imageSha256'], c['slug']
print('All 11 course images verified.')
PY
# Reuse the already-running API container only for its pg dependency and DB configuration.
# Do not rebuild/restart services or import the server and its email workers.
inexc_content_remote="/app/course-content-$inexc_content_ref"
docker compose exec -T api mkdir -p "$inexc_content_remote"
docker cp "$inexc_content_stage/." "$inexc_content_container:$inexc_content_remote/"
docker compose exec -T api node "$inexc_content_remote/update-course-content.js"
