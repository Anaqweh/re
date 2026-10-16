#!/usr/bin/env python3
"""Apply only the known sitemap handler and public share-page canonical fixes."""
from pathlib import Path
import sys

root=Path(sys.argv[1]); p=root/'server.js'; source=p.read_text(); changed=source
old="""app.get('/api/sitemap.xml', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT id,updated_at FROM courses WHERE active = true ORDER BY updated_at DESC');
    const urls = result.rows.map(row => '<url><loc>https://www.inexctraining.com/course.html?id=' + row.id + '</loc><lastmod>' + row.updated_at.toISOString().slice(0, 10) + '</lastmod></url>').join('');
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.inexctraining.com/</loc></url><url><loc>https://www.inexctraining.com/register.html</loc></url>' + urls + '</urlset>');
  } catch (error) { next(error); }
});"""
new='installSeoSitemap(app, {pool});'
imp="import {installSeoSitemap} from './seo-sitemap.js';"
if changed.count(new)==1 and old not in changed and changed.count(imp)==1:
 pass
elif changed.count(old)==1 and new not in changed and imp not in changed:
 changed=imp+'\n'+changed.replace(old,new,1)
else: raise SystemExit('Unrecognized sitemap handler; no source was changed.')
title='<title>${escapeHtml(course.name)} | INEXC Training</title>'
canonical='<link rel="canonical" href="https://www.inexctraining.com/course.html?id=${encodeURIComponent(course.id)}">'
if changed.count(canonical)==0:
 if changed.count(title)!=2:raise SystemExit('Unexpected public course templates; no source was changed.')
 changed=changed.replace(title,canonical+title)
elif changed.count(canonical)!=2:raise SystemExit('Unexpected canonical markup; no source was changed.')
d=root/'Dockerfile';docker=d.read_text();docker_changed=docker
if 'seo-sitemap.js' not in docker:
 lines=docker.splitlines(True);matches=[i for i,l in enumerate(lines) if l.startswith('COPY ') and 'server.js' in l.split()]
 if len(matches)!=1:raise SystemExit('Unexpected Docker copy list; no source was changed.')
 i=matches[0];lines[i]=lines[i].replace('server.js','seo-sitemap.js server.js',1);docker_changed=''.join(lines)
if source!=changed:p.write_text(changed)
if docker!=docker_changed:d.write_text(docker_changed)
print('Prepared current-data sitemap and canonical share pages; unrelated source preserved.')
