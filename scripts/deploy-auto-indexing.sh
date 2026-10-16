#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
seo_ref="${1:?Usage: bash deploy-auto-indexing.sh COMMIT_SHA}"
[[ "$seo_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
seo_base="${INEXC_SEO_BASE:-http://127.0.0.1:3000}"
seo_container="$(docker compose ps -q api)"
[[ -n "$seo_container" ]] || { echo 'Existing API container is not running.' >&2; exit 1; }
seo_old_image="$(docker inspect --format '{{.Image}}' "$seo_container")"
seo_image_tag="$(docker inspect --format '{{.Config.Image}}' "$seo_container")"
seo_stage="$(mktemp -d)"
seo_backup="$(mktemp -d "$PWD/seo-backup-20261017-XXXXXX")"
seo_files=(server.js Dockerfile seo-sitemap.js)
seo_installed=0
seo_started=0
seo_phase='preflight'
seo_wait_health(){
 for seo_attempt in {1..30}; do
  if curl -fsS --max-time 3 "$seo_base/api/health" 2>/dev/null | python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' 2>/dev/null; then return 0; fi
  sleep 2
 done
 return 1
}
seo_exit(){
 local code=$?
 trap - EXIT
 if (( code != 0 )); then
  echo "SEO update failed during $seo_phase; diagnostics: $seo_backup/deployment.log" >&2
  if (( seo_installed == 1 )); then
   for file in "${seo_files[@]}"; do
    if [[ -f "$seo_backup/$file" ]]; then cp -p -- "$seo_backup/$file" "$file";
    elif [[ -f "$seo_backup/$file.absent" ]]; then rm -f -- "$file"; fi
   done
   if docker tag "$seo_old_image" "$seo_image_tag"; then
    if (( seo_started == 1 )); then
     if docker compose up -d --no-build --no-deps api && seo_wait_health; then echo 'Previous API restored and healthy.';
     else echo 'ERROR: rollback health could not be confirmed.' >&2; fi
    else echo 'Previous source restored; running container was not replaced.'; fi
   else echo 'ERROR: previous image tag could not be restored.' >&2; fi
  fi
 fi
 rm -rf -- "$seo_stage"
 exit "$code"
}
trap seo_exit EXIT
exec > >(tee -a "$seo_backup/deployment.log") 2>&1
seo_wait_health
cp -p -- server.js Dockerfile "$seo_stage/"
seo_phase='download pinned SEO files'
for file in seo-sitemap.js; do
 curl -fsSL --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$seo_ref/inexc-api/$file" -o "$seo_stage/$file"
done
curl -fsSL --retry 2 "https://raw.githubusercontent.com/Anaqweh/re/$seo_ref/scripts/patch-auto-indexing.py" -o "$seo_stage/patch.py"
seo_phase='prepare targeted source patch'
python3 "$seo_stage/patch.py" "$seo_stage"
for file in server.js seo-sitemap.js; do docker compose exec -T api node --input-type=module --check < "$seo_stage/$file"; done
for file in "${seo_files[@]}"; do
 if [[ -f "$file" ]]; then cp -p -- "$file" "$seo_backup/$file"; else touch "$seo_backup/$file.absent"; fi
done
seo_installed=1
for file in "${seo_files[@]}"; do cp -- "$seo_stage/$file" "$file"; done
seo_phase='build'
docker compose build api
seo_phase='start updated API'
seo_started=1
docker compose up -d --no-build --no-deps api
seo_phase='health and discovery verification'
seo_wait_health
INEXC_SEO_BASE="$seo_base" python3 - <<'PY'
import os,json,urllib.request,urllib.parse,xml.etree.ElementTree as E
base=os.environ['INEXC_SEO_BASE'].rstrip('/');origin='https://www.inexctraining.com'
with urllib.request.urlopen(base+'/api/courses',timeout=15) as r:courses=json.load(r)
assert isinstance(courses,list),'Unexpected course catalogue'
with urllib.request.urlopen(base+'/api/sitemap.xml',timeout=15) as r:
 assert r.headers.get('X-INEXC-Sitemap-Version')=='2','Wrong sitemap version'
 assert 'no-cache' in r.headers.get('Cache-Control',''),'Stale sitemap caching'
 root=E.fromstring(r.read())
locs=[n.text for n in root.findall('{*}url/{*}loc')]
expected={origin+p for p in ['/','/register/','/cards/','/services.html','/subscribe.html']}
expected.update(origin+'/course.html?id='+urllib.parse.quote(c['id'],safe='') for c in courses)
assert len(locs)==len(set(locs)) and set(locs)==expected,'Published catalogue and sitemap differ'
print(f'Verified current sitemap: {len(courses)} published courses and 5 canonical public pages.')
PY
echo 'Automatic search discovery deployed successfully.'
echo 'No registrations, payments, accounts or email campaigns were created by this update.'
echo 'Existing scheduled workers resume their previously configured schedule.'
echo "Previous files and diagnostic log: $seo_backup"
