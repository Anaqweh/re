#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_ref="${1:?Pass the full reviewed commit SHA}"
[[ "$inexc_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
inexc_stage="$(mktemp -d)"
inexc_changed=0
inexc_files=(server.js admin-registration-income.js Dockerfile)
cleanup(){
 inexc_result=$?
 trap - EXIT
 if (( inexc_result != 0 && inexc_changed == 1 )); then
  for file in "${inexc_files[@]}"; do
   if [[ -f "$inexc_backup/$file" ]]; then cp "$inexc_backup/$file" "$file"; else rm -f "$file"; fi
  done
  docker tag "$inexc_old_image" "$inexc_image_name"
  docker compose up -d --no-build --no-deps api
  echo 'Previous API files and image restored.' >&2
 fi
 rm -rf "$inexc_stage"
 exit "$inexc_result"
}
trap cleanup EXIT
for file in server.js admin-registration-income.js; do
 curl --fail --silent --show-error --location "https://raw.githubusercontent.com/Anaqweh/re/$inexc_ref/inexc-api/$file" -o "$inexc_stage/$file"
done
inexc_server_hash="$(sha256sum server.js | cut -d ' ' -f1)"
[[ "$inexc_server_hash" == 'c2153941ca0cd3b844d01061b5036ac956e00b401fc1fb6f244dff873083ad6f' || "$inexc_server_hash" == "$(sha256sum "$inexc_stage/server.js" | cut -d ' ' -f1)" ]] || { echo 'server.js differs from the reviewed baseline. Stop and compare.' >&2; exit 1; }
if [[ -f admin-registration-income.js ]]; then
 cmp -s admin-registration-income.js "$inexc_stage/admin-registration-income.js" || { echo 'Existing income module differs. Stop and compare.' >&2; exit 1; }
fi
cp Dockerfile "$inexc_stage/Dockerfile"
if ! grep -Fxq 'COPY admin-registration-income.js ./' "$inexc_stage/Dockerfile"; then printf '\nCOPY admin-registration-income.js ./\n' >> "$inexc_stage/Dockerfile"; fi
inexc_container="$(docker compose ps -q api)"
[[ -n "$inexc_container" ]] || { echo 'API container is not running.' >&2; exit 1; }
inexc_old_image="$(docker inspect --format '{{.Image}}' "$inexc_container")"
inexc_image_name="$(docker inspect --format '{{.Config.Image}}' "$inexc_container")"
for file in server.js admin-registration-income.js; do docker exec -i "$inexc_container" node --check --input-type=module < "$inexc_stage/$file"; done
inexc_backup="admin-income-backup-$(date -u +%Y%m%dT%H%M%SZ)"
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
 sys.exit(0 if data.get('adminIncomeVersion')==1 and data.get('certificateLinkPaymentsVersion')==2 and data.get('courseProjectsVersion')==3 else 1)
except (OSError,ValueError,AttributeError): sys.exit(1)
PYCHECK
 then
  if [[ "$(curl --silent -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/registrations)" == 401 ]]; then inexc_ok=1; break; fi
 fi
 sleep 2
done
(( inexc_ok == 1 )) || { echo 'New API health/authentication check failed.' >&2; exit 1; }
# Verify the actual report in a read-only transaction. No login or data edits.
docker compose exec -T api node --input-type=module - <<'NODE'
import pg from 'pg';
import {adminRegistrations} from './admin-registration-income.js';
const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
const db=await pool.connect();
try {
 await db.query('BEGIN READ ONLY');
 const rows=await adminRegistrations(db);
 if(rows.some(r=>!Number.isSafeInteger(r.verified_certificate_amount_fils)||r.verified_certificate_amount_fils<0))throw Error('Invalid income report');
 const paid=rows.filter(r=>r.verified_certificate_amount_fils>0);
 console.log(JSON.stringify({audit:'READ_ONLY_VERIFIED_CERTIFICATE_INCOME',paidCertificates:paid.length,amountAed:paid.reduce((n,r)=>n+r.verified_certificate_amount_fils,0)/100,receipts:paid.map(r=>({reference:r.reference,name:r.name,email:r.email,course:r.course_name,amountAed:r.verified_certificate_amount_fils/100}))},null,2));
 await db.query('ROLLBACK');
} finally {db.release();await pool.end()}
NODE
inexc_changed=0
echo "Verified certificate income is ready. Backup: $inexc_backup."
echo 'No registrations, payment records or balances were edited. No test charge or email was created. Existing scheduled workers resume their configured schedules.'
