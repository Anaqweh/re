# INEXC admin layout and services

## Layout

The right-hand sidebar groups the existing administration tabs into work, training/services, cards/learners, communication and settings. `admin-shell.js` moves the original tab elements without cloning or replacing their handlers. Dynamic message-centre tabs are observed and grouped when mounted. Existing form IDs, field values, authentication, API calls and payment modules are retained.

A new overview mirrors the registration counters already loaded by the existing page. Quick actions open the original sections. The layout uses existing licensed IBM Plex Arabic font files, clearer text sizing, responsive forms, scoped table overflow, navigation search, keyboard focus and a dismissible mobile drawer. The locked application remains hidden/inert under the existing session manager.

An isolated, unlinked, noindex layout fixture at `/previews/admin-layout.html` permits desktop and narrow-frame visual review without a production admin login. It has no authentication credentials, production data, API access or saving functionality. It is not evidence of authenticated live workflow validation.

## Services

The service catalogue is independent of courses, registrations, cards, payments and emails. It introduces one table, `service_catalog`, with read-only public listing and existing-admin-protected create/update/image routes. No seed services are inserted. Nothing is deleted: hiding a service retains it as a draft. An incrementing revision prevents overwriting a newer edit, and client-created UUIDs make identical create retries idempotent.

Administration includes name, category, summary, details/deliverables, audience, delivery method, duration, display price, uploaded image or image URL, request label/URL, publication state and ordering. Published services require a summary and request URL. Display price is text only; this does not change payment processing. Images are limited to 5 MB with PNG/JPEG/WebP signatures and generated names. Text is escaped and URL schemes are validated.

`/services.html` renders published services, search/category filters and a details dialog. The homepage navigation link appears only when the API returns published services. Empty or unavailable catalogues never show fabricated service records. Existing checkout, course listings and transaction flows are unchanged.

## Deployment boundary

The frontend is delivered through the existing repository deployment. API activation requires the pinned `scripts/deploy-service-catalog.sh` on the existing DigitalOcean server. There is no connected online execution session for that server in this workspace.

The deployment script stages the new module and patches the existing live `server.js` and Dockerfile with only catalogue import/install/setup/copy hooks. It refuses unexpected anchors, checks Node syntax before installation, backs up all changed files, rebuilds only the existing API service, checks public catalogue and protected admin routing, and restores the old files/image on failure. It does not change `.env`, payment modules, message modules, Docker Compose, or existing business records. Existing authorized scheduled workers resume on API restart. The additive catalogue table is retained even if a rollback occurs.

Existing general deployment manifests include the new module so later updates can still build the Docker image.

## Verification

33 local tests passed across service catalogue API/UI/public rendering, shell navigation, administrator sessions/drafts, course payment controls, membership checkout and card directory. Tests use isolated JSDOM and PGlite fixtures only. Covered auth gates, safe fields/links/images, draft/publish/hide, idempotent creation, revision conflicts, retained form edits, late save responses, search, lazy tabs, mobile drawer, and preservation of original tab nodes/handlers and selected payment fields.

The staging patch was verified against the exact expected source diff and applied twice to confirm idempotence. JavaScript syntax, shell syntax and git whitespace checks passed. Production service saving is not claimed until the server activation command completes. Production private records were not inspected.
