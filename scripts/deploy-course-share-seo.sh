#!/usr/bin/env bash
# Targeted patch for the existing INEXC API; no database import or schema change.
set -Eeuo pipefail
umask 077
seo_ref="${1:?Pass a full commit SHA}"
[[ "$seo_ref" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
seo_base='http://127.0.0.1:3000'
seo_container="$(docker compose ps -q api)"
[[ -n "$seo_container" ]] || { echo 'Existing API container was not found.' >&2; exit 1; }
seo_old_image="$(docker inspect --format '{{.Image}}' "$seo_container")"
seo_image_name="$(docker inspect --format '{{.Config.Image}}' "$seo_container")"
seo_stage="$(mktemp -d)"
seo_backup="$(mktemp -d "$PWD/seo-share-backup-XXXXXX")"
seo_changed=0
seo_started=0
health() {
  for attempt in {1..30}; do
    if curl -fsS --max-time 3 "$seo_base/api/health" | python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
finish() {
  seo_result=$?
  trap - EXIT
  if (( seo_result != 0 && seo_changed == 1 )); then
    cp -p "$seo_backup/server.js" server.js
    if docker tag "$seo_old_image" "$seo_image_name"; then
      if (( seo_started == 0 )); then echo 'Previous source restored; existing container retained.';
      elif docker compose up -d --no-build --no-deps api && health; then echo 'Previous source and healthy API restored.';
      else echo 'Automatic recovery needs attention. See the diagnostic log.' >&2; fi
    else echo 'Image rollback needs attention. See the diagnostic log.' >&2; fi
  fi
  rm -rf -- "$seo_stage"
  echo "Backup and log: $seo_backup"
  exit "$seo_result"
}
trap finish EXIT
exec > >(tee -a "$seo_backup/deployment.log") 2>&1
health
cp -p server.js "$seo_backup/server.js"
cp -p server.js "$seo_stage/server.js"
curl -fsS --max-time 20 "$seo_base/api/courses" -o "$seo_backup/courses-before.json"
curl -fsSL --max-time 30 "https://raw.githubusercontent.com/Anaqweh/re/$seo_ref/scripts/patch-course-share-seo.py" -o "$seo_stage/patch.py"
python3 "$seo_stage/patch.py" "$seo_stage/server.js"
docker exec -i "$seo_container" node --check --input-type=module < "$seo_stage/server.js"
if cmp -s server.js "$seo_stage/server.js"; then
  echo 'Source already contains this correction; checking the running API.'
else
  seo_changed=1
  cp "$seo_stage/server.js" server.js
  docker compose build api
  seo_started=1
  docker compose up -d --no-build --no-deps api
  health
fi
python3 - "$seo_backup/courses-before.json" <<'PY'
import json,sys,urllib.request,urllib.error,urllib.parse
from html.parser import HTMLParser
base='http://127.0.0.1:3000'
before=json.load(open(sys.argv[1]))
with urllib.request.urlopen(base+'/api/courses',timeout=15) as r: courses=json.load(r)
assert {c['id'] for c in courses}=={c['id'] for c in before},'Published catalogue changed during deployment'
assert courses,'Expected existing published courses'
class Canonical(HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='link' and a.get('rel')=='canonical':self.links.append(a.get('href'))
for c in courses:
 slug=c['shareSlug']
 with urllib.request.urlopen(base+'/'+urllib.parse.quote(slug,safe=''),timeout=15) as r:
  assert r.status==200
  parser=Canonical();parser.feed(r.read().decode())
 assert parser.links==['https://www.inexctraining.com/course/?id='+c['id']],slug
try:
 urllib.request.urlopen(base+'/catalog-seo-missing-verification-7f31c9',timeout=15)
 raise AssertionError('Missing course must return 404')
except urllib.error.HTTPError as e:assert e.code==404
print(f'Verified {len(courses)} published share pages and their canonical URLs; missing courses remain 404.')
PY
echo 'Course share SEO fix deployed successfully.'
