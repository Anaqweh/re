#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_repeat_ref="${1:?Usage: bash deploy-registration-repeat.sh FULL_COMMIT_SHA}"
[[ "$inexc_repeat_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_repeat_dir="${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
cd "$inexc_repeat_dir"
docker compose config --services | grep -qx api || { echo 'Existing API service was not found.' >&2; exit 1; }
inexc_repeat_container="$(docker compose ps -q api)"
[[ -n "$inexc_repeat_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
inexc_repeat_old_image="$(docker inspect --format '{{.Image}}' "$inexc_repeat_container")"
inexc_repeat_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_repeat_container")"
inexc_repeat_stage="$(mktemp -d)"
inexc_repeat_backup="$(mktemp -d "$inexc_repeat_dir/.registration-repeat-backup-XXXXXXXX")"
inexc_repeat_installed=0
inexc_repeat_started=0
inexc_repeat_files=(server.js learner-service.js membership-payments.js Dockerfile registration-policy.js)
cleanup(){
  inexc_repeat_exit=$?
  trap - EXIT
  if (( inexc_repeat_exit != 0 && inexc_repeat_installed == 1 )); then
    echo 'Update failed; restoring previous API files and image.' >&2
    for inexc_repeat_file in "${inexc_repeat_files[@]}"; do
      if [[ -f "$inexc_repeat_backup/$inexc_repeat_file" ]]; then cp -- "$inexc_repeat_backup/$inexc_repeat_file" "$inexc_repeat_file";
      elif [[ -f "$inexc_repeat_backup/$inexc_repeat_file.absent" ]]; then rm -f -- "$inexc_repeat_file"; fi
    done
    if (( inexc_repeat_started == 1 )); then docker tag "$inexc_repeat_old_image" "$inexc_repeat_image_name"; docker compose up -d --no-build --no-deps api; fi
  fi
  rm -rf -- "$inexc_repeat_stage"
  exit "$inexc_repeat_exit"
}
trap cleanup EXIT
for inexc_repeat_file in server.js learner-service.js membership-payments.js Dockerfile; do
  test -s "$inexc_repeat_file" || { echo "Missing $inexc_repeat_file" >&2; exit 1; }
  cp -- "$inexc_repeat_file" "$inexc_repeat_stage/$inexc_repeat_file"
done
for inexc_repeat_asset in scripts/patch-registration-repeat.py scripts/registration-repeat-patches.json inexc-api/registration-policy.js; do
  curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$inexc_repeat_ref/$inexc_repeat_asset" -o "$inexc_repeat_stage/${inexc_repeat_asset##*/}"
done
python3 "$inexc_repeat_stage/patch-registration-repeat.py" "$inexc_repeat_stage" "$inexc_repeat_stage/registration-repeat-patches.json"
for inexc_repeat_file in server.js learner-service.js membership-payments.js registration-policy.js; do
  docker compose exec -T api node --input-type=module --check < "$inexc_repeat_stage/$inexc_repeat_file"
done
for inexc_repeat_file in "${inexc_repeat_files[@]}"; do
  if [[ -f "$inexc_repeat_file" ]]; then cp -- "$inexc_repeat_file" "$inexc_repeat_backup/$inexc_repeat_file"; else touch "$inexc_repeat_backup/$inexc_repeat_file.absent"; fi
done
inexc_repeat_installed=1
for inexc_repeat_file in "${inexc_repeat_files[@]}"; do cp -- "$inexc_repeat_stage/$inexc_repeat_file" "$inexc_repeat_file"; done
docker compose build api
inexc_repeat_started=1
docker compose up -d --no-build --no-deps api
for inexc_repeat_attempt in {1..25}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' 2>/dev/null; then
    docker compose exec -T api node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {allowsRepeatRegistration} from './registration-policy.js';
assert.equal(allowsRepeatRegistration(' AHMADANAKWA@gmail.com '),true);
for(const email of ['other@example.invalid','ahmadanakwa+test@gmail.com','ahmadanakwa@gmail.com.evil'])assert.equal(allowsRepeatRegistration(email),false);
for(const [file,guard] of [['server.js','if(existing.rowCount&&!allowsRepeatRegistration(email))'],['learner-service.js','if(previous&&!allowsRepeatRegistration(card.holder_email))'],['membership-payments.js','if(existing&&!allowsRepeatRegistration(data.email))']])assert.ok(fs.readFileSync(file,'utf8').includes(guard),'Missing policy in '+file);
console.log('Repeat registration is enabled only for ahmadanakwa@gmail.com.');
console.log('Other duplicate checks, card balances, payment rules and suppression remain enforced.');
NODE
    echo 'No test registration, payment or email was created. Existing workers resume their schedule.'
    echo "Protected source backup: $inexc_repeat_backup"
    exit 0
  fi
  sleep 2
done
echo 'API health check failed.' >&2
exit 1
