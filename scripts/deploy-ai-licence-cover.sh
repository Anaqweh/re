#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_cover_ref="${1:?Usage: bash deploy-ai-licence-cover.sh COMMIT_SHA}"
[[ "$inexc_cover_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_cover_container="$(docker compose ps -q api)"
[[ -n "$inexc_cover_container" ]] || { echo 'The existing API container is not running.' >&2; exit 1; }
inexc_cover_stage="$(mktemp -d)"
trap 'rm -rf -- "$inexc_cover_stage"' EXIT
mkdir -p "$inexc_cover_stage/assets"
inexc_cover_base="https://raw.githubusercontent.com/Anaqweh/re/$inexc_cover_ref"
for inexc_cover_file in update-ai-licence-cover.js ai-licence-cover-20261018.json; do
 curl --fail --silent --show-error --location --retry 2 "$inexc_cover_base/inexc-api/$inexc_cover_file" -o "$inexc_cover_stage/$inexc_cover_file"
done
curl --fail --silent --show-error --location --retry 2 "$inexc_cover_base/assets/courses/international-ai-licence-20261018.webp" -o "$inexc_cover_stage/assets/international-ai-licence-20261018.webp"
python3 - "$inexc_cover_stage" <<'PY'
import pathlib,json,hashlib,sys
stage=pathlib.Path(sys.argv[1])
data=json.loads((stage/'ai-licence-cover-20261018.json').read_text())
assert data['batch']=='inexc-ai-licence-cover-20261018'
assert data['courseId']=='ea14c5bd-ab64-4e77-8b1b-b5c09aa8eed0' and data['expectedPrice']==0
assert hashlib.sha256((stage/'assets/international-ai-licence-20261018.webp').read_bytes()).hexdigest()==data['imageSha256']
print('AI licence course artwork verified.')
PY
# Reuse the running container's database configuration and pg package without starting workers.
inexc_cover_remote="/app/ai-licence-cover-$inexc_cover_ref"
docker compose exec -T api mkdir -p "$inexc_cover_remote"
docker cp "$inexc_cover_stage/." "$inexc_cover_container:$inexc_cover_remote/"
docker compose exec -T api node "$inexc_cover_remote/update-ai-licence-cover.js"
