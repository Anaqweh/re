#!/usr/bin/env python3
"""Add catalogue hooks to existing API files without replacing other modules."""
import pathlib, sys
root=pathlib.Path(sys.argv[1])
server=root/'server.js'; docker=root/'Dockerfile'
s=server.read_text(); d=docker.read_text()
imp="import {setupServiceCatalog, installServiceCatalog} from './service-catalog.js';"
install='installServiceCatalog({app,pool,auth,uploadDir});'
setup='setupDatabase().then(() => setupServiceCatalog(pool))'
if imp not in s:
    if 'service-catalog' in s: raise SystemExit('Unexpected catalogue import; manual review required.')
    s=imp+'\n'+s
if install not in s:
    anchor='installLearnerService({app,pool,auth,uploadDir,sendEmail,emailShell,mailEnabled:!!resendApiKey});'
    if s.count(anchor)!=1: raise SystemExit('Learner install anchor changed; no files modified.')
    s=s.replace(anchor,anchor+'\n'+install)
if setup not in s:
    anchor='setupDatabase().then(() => setupLearnerService(pool))'
    if s.count(anchor)!=1: raise SystemExit('Startup anchor changed; no files modified.')
    s=s.replace(anchor,setup+'.then(() => setupLearnerService(pool))')
if 'COPY service-catalog.js service-link-images.js server.js learner-service.js' not in d and 'COPY service-catalog.js server.js learner-service.js' not in d:
    anchor='COPY server.js learner-service.js'
    if d.count(anchor)!=1: raise SystemExit('Docker copy anchor changed; no files modified.')
    d=d.replace(anchor,'COPY service-catalog.js server.js learner-service.js')
if 'COPY service-catalog.js service-link-images.js server.js learner-service.js' not in d:
    anchor='COPY service-catalog.js server.js learner-service.js'
    if d.count(anchor)!=1: raise SystemExit('Service image Docker anchor changed; no files modified.')
    d=d.replace(anchor,'COPY service-catalog.js service-link-images.js server.js learner-service.js')
server.write_text(s); docker.write_text(d)
print('Only service catalogue hooks added; existing API code retained.')
