# INEXC Training — Message Center Studio

Implementation: 12 October 2026. Existing vanilla JavaScript + Express + PostgreSQL architecture retained.

## What changed

- A six-section Arabic workspace, locally hosted original IBM Plex Sans Arabic weights 400/500/600/700 with OFL license, consistent controls, mobile write/preview tabs and optional desktop preview.
- Structured rich content: headings, bold/italic/underline, lists, limited text colors, links, paragraph alignment and direction, image with alt text, button, divider, block movement, sanitized Word paste, undo/redo. Legacy plain text and rich v1 data remain readable.
- One renderer for authenticated preview and new campaign delivery, including plain-text alternative, preheader, customizable logo/color/signature, personal style, recipient fallback and unsubscribe link.
- Persistent drafts with optimistic version checks, 30 stored revisions, idempotent saves, local recovery, reconnect synchronization and an unsaved-change exit warning.
- Six editable starter designs; saved templates can be updated, duplicated and removed. Reusable rich content blocks have insert/edit/delete operations.
- Reviewed contact import with drag/drop or paste; CSV/XLS/XLSX/TXT/DOC/DOCX/PDF and recognized images. Existing document parsers and OCR retained; Word tables and same-line names can be reviewed. Excel/CSV/Word tables permit manual column mapping. Invalid and duplicate rows are visible before committing. Manual mapping deliberately targets the selected sheet; default extraction includes all sheets.
- Global normalized-email deduplication; existing contact metadata is preserved during reimport. Names without email remain reviewable but cannot receive email. Language, tags, source, search, filters, groups, individual edits, bulk tags/language/group assignment and CSV export (with formula escaping).
- Page selection versus all search results, server-side expiring selection snapshots, explicit count/scope confirmations for individual, selected and full-directory deletion. Registration records and historic delivery records are not deleted.
- Draft submission is transactional and idempotent. Dubai UTC+4 schedules can be edited or cancelled before the worker claims them. Previous campaign audiences can be reused/excluded.
- Existing server queue retained with database worker lock, configurable pacing (minimum 650ms; default 1000ms), provider backoff, immutable per-recipient payload snapshots and stable Resend idempotency keys. Safe retries target retryable unaccepted failures under 23 hours; old uncertain attempts are held for manual provider review.
- Verified webhook signatures, timestamp window and durable event records; early events are replayed once the provider ID is saved. Cumulative delivery/open/click fields do not regress on a later `sent` notification. Bounce/complaint/suppression excludes recipients.
- Settings report configured mail/webhook status. AI writing assistance is explicitly unavailable, not a decorative button. No service credentials appear in the browser.
- Older message-center API versions automatically use a frozen compatible editor until the Studio backend is installed. The original registration-side response now describes queue acceptance accurately.

## Verification performed

`cd inexc-api && npm test`: **41 passing tests**, including the original import/format/worker tests and disposable PostgreSQL-engine HTTP integration tests using PGlite. Tested auth, additive migrations, draft reopen/conflicts/revisions, template/block/settings persistence, CSV/Word/Excel/PDF/image OCR, duplicate/invalid/unnamed contacts, filtered selection snapshots, bulk actions and deletion, unsubscribe/suppression, schedule/edit/cancel, duplicate campaign submissions, safe retry targeting and mail rendering. Signed webhook tests reject stale/invalid signatures, preserve cumulative evidence across late events, replay early events and suppress bounced recipients. Campaigns with every recipient excluded report completion without sending, never provider acceptance.

`npm run test:browser`: passed against the actual admin HTML served locally with a disposable database and a recording mail stub. Tested desktop 1440px and mobile viewports 390px/320px; keyboard formatting/undo, RTL/LTR preview, sanitized Word paste, draft reload, offline recovery, revision restore, template save/use, import correction, contact edits/filter/bulk/delete, schedule/edit/cancel and settings. No horizontal page overflow at the two mobile widths. Font loading checked. All external browser requests were blocked.

The test harness records fake provider requests; **no real email was sent**. Browser and unit tests do not establish real inbox rendering across Outlook/Gmail/Apple Mail. Such an inbox test still requires an explicitly authorized test address. Physical-device tests were not performed.

An additional browser check verified that the old server capability loads the frozen compatible editor, and that image alt text and call-to-action buttons survive insertion, save and reload in Studio.

## Deployment boundary

Implementation and verification were completed locally on 12 October. Publication was initially blocked pending approval to publish the new source to public `Anaqweh/re`; the user authorized continuation on 13 October. A scan of the changed files found no obvious service secrets or recipient datasets. Repository publication and live-server installation are separate steps: consult the associated release/PR for current publication status. This report alone does not establish deployment to the live server.

Source and frontend can be published through the existing `Anaqweh/re` master / GitHub Pages workflow. The frontend capability gate preserves the old center while the server is still on richText v1.

The DigitalOcean backend must receive the same release via the existing `scripts/deploy-message-center.sh FULL_COMMIT_SHA` mechanism. There was no authenticated SSH session/key available in the execution environment; the live database was neither read nor modified during development. Backend deployment must not be reported complete until its health/capability checks have succeeded on the actual server.

The deployment script backs up existing API source, copies one pinned revision, rebuilds the existing API container and rolls back files/image if its health check fails. Migrations only add tables/columns/indexes. Existing Docker Compose configuration, environment secrets and uploaded files are retained. It does not create test campaigns. The existing worker can resume previously authorized queued or due scheduled campaigns after restart.

## External configuration / operational limits

- Existing `RESEND_API_KEY` and `EMAIL_FROM` are required for actual delivery. `RESEND_WEBHOOK_SECRET` plus correctly configured Resend event subscription is required for confirmed delivery events. Merely setting the key is not proof events have arrived.
- `MESSAGE_SEND_INTERVAL_MS` optionally slows the worker; rate-limit responses trigger backoff. Other existing transactional mail streams share the provider quota, so provider throttling remains authoritative.
- OCR uses local Tesseract and Poppler installed by the existing Dockerfile, with English address OCR; review OCR output manually. Maximum upload 5MB, up to 12 OCR pages, bounded text/archive processing, up to 3000 unique contacts per import/campaign. Unsupported/encrypted/complex formats return actionable errors. No claim of universal format support or mailbox-existence verification.
- AI editing is not connected. No new paid or external AI service was activated.
- Draft/message lists display the latest 200 items; revisions retain the latest 30. Contact history displays the latest 100 associated delivery records. Existing records beyond these display limits are retained in the database.
- Local recovery is device-local and offered for up to seven days. It is not a substitute for the confirmed server save. If storage is unavailable, keep the page open until server save succeeds.
- Email clients choose fallback fonts when IBM Plex Sans Arabic is unavailable. Tracking can be affected by privacy features and link scanners; no open/click rates are fabricated.

Provider reference: https://resend.com/docs/dashboard/emails/idempotency-keys (keys retained for 24 hours; implementation uses a conservative 23-hour retry boundary). Webhook reference: https://resend.com/docs/dashboard/webhooks/introduction.
