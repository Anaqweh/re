#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_catalog_ref="${1:?Usage: bash deploy-course-catalog.sh COMMIT_SHA}"
[[ "$inexc_catalog_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_catalog_stage="$(mktemp -d)"
trap 'rm -rf -- "$inexc_catalog_stage"' EXIT
curl --fail --silent --show-error --location --retry 2 \
  "https://raw.githubusercontent.com/Anaqweh/re/$inexc_catalog_ref/scripts/deploy-learner-workspace.sh" \
  -o "$inexc_catalog_stage/deploy.sh"
bash "$inexc_catalog_stage/deploy.sh" "$inexc_catalog_ref"
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
# Only this explicit command imports courses; API startup never imports the catalog.
docker compose exec -T api node /app/import-course-catalog.js
