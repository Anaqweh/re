# INEXC message previews, templates and permanent exclusions

Release prepared on 15 October 2026. Changes are limited to the message center and the mailing exclusion paths it shares with course alerts. Existing authentication, payments, registrations and other site features are retained.

## Administrator experience

- The composer and its live preview both offer an explicit email preview action. It sends only to the address entered in the dialog, with a TEST subject prefix and the current design/attachment. It neither creates a campaign nor adds that address to contacts. Provider acceptance is reported accurately; delivery is not assumed. Preview recipients are subject to the same exclusion policy. Repeated requests retain provider idempotency; changing personalization requires a new preview request.
- Seven editable starter designs: training program, workshop, personal teacher letter, editorial newsletter, appreciation, institutional outreach and an English learning brief. The gallery displays actual sandboxed email HTML, offers a full-size preview and uses the same renderer as delivery. Layout, cover eyebrow/headline/introduction, color, logo, body, signature and call-to-action persist through drafts/templates/campaigns. Table-based email structure, inline styling, mobile spacing, Outlook width fallback, plain-text version and RTL/LTR remain supported.
- Overview and reports show unique unsubscribes and the latest started campaign's attributed count. Each campaign exposes its own count and individual recorded unsubscribe dates. Repeated use of links is not counted repeatedly. A new permanent-exclusions section supports search, paging and merge-only export/import.

## Permanent exclusion contract

`message_suppressions` is independent of the contact directory. Startup migrates prior preference/contact/course-alert suppression flags. Database guards prevent removal or modification of ledger entries, restoration through preference updates, re-creation of contacts/subscriptions, and adding blocked contacts to groups. A normalized email is checked at review, import, manual add/edit, recipient selection, preview send and final marketing dispatch. Deleting a contact does not remove its ledger record. CSV recipient exports omit blocked addresses.

New campaign deliveries carry opaque unsubscribe tokens linked to their specific delivery. The footer and List-Unsubscribe headers use that token; the POST endpoint supports one-click requests. Existing links continue to opt out globally. Existing retry snapshots and their previous headers remain unchanged so provider idempotency is preserved.

A unique unsubscribe event retains its originating campaign, independent of contacts. Old campaigns without campaign-specific links are explicitly labelled untracked, not given fabricated zero counts. Existing suppression flags have no reliable historical reason/campaign and are labelled legacy; their count is disclosed. New provider bounces, complaints and administrative blocks are distinguished from voluntary opt-outs. Historical campaign attribution cannot be reconstructed reliably from the old stored data.

Unsubscription prevents subsequent dispatch attempts. It cannot recall a message already accepted by a mail provider. Operational registration/account recovery emails remain outside the marketing exclusion scope.

## Transfer and integration with another site

Active-recipient CSV exports exclude suppressed addresses as of export time. Export `inexc-permanent-suppressions.json` from the exclusions section and import it first on the receiving INEXC installation. Import merges exclusions and never reactivates an existing address. The UI transfers large ledgers in batches; the API validates each batch transactionally. A partial transfer can be retried without duplicates.

An unrelated service cannot learn a later unsubscribe from an old standalone CSV. It must import the ledger or consult the authoritative registry before adding/sending. This release offers a server-to-server read check:

- Authoritative INEXC server: configure a long random `MESSAGE_SUPPRESSION_SYNC_KEY` (32+ characters) in server environment. Never place it in frontend code or source control. No key is generated or activated by this release.
- Connected sender using this module: configure `MESSAGE_SUPPRESSION_REMOTE_URL=https://api.inexctraining.com/api/message-suppressions/check` and the same key. The helper batches checks, and fails closed when the remote registry is unavailable or its response is invalid.
- Other implementations: authenticated `POST /api/message-suppressions/check`, `Authorization: Bearer <key>`, JSON `{ "emails": ["person@example.com"] }`, maximum 3000 addresses. Response contains `checked` and `blocked` normalized addresses. Fail closed on any failure.
- This API is a read check, not a bidirectional synchronization service. Other systems must also feed their own new exclusions into the central registry (via its authenticated admin import or their integration). A copied site requires its own correctly configured public unsubscribe URLs and an integration review; this release does not deploy or configure other sites.

No separate site or shared-registry credential was provided in this task. Cross-site enforcement therefore remains an integration option, not an already enabled promise across unrelated services.

## Verification

52 Node tests pass. Real PostgreSQL semantics are exercised through disposable PGlite databases with recording mail stubs. Coverage includes additive/idempotent migration, deletion/reimport/manual-edit/direct-database bypass attempts, recipient export, preserved old links, unique campaign attribution, preview idempotency, provider-reason separation, registry transfer into an empty installation, shared-check authentication/fail-closed behavior, old delivery snapshot compatibility and all renderer layouts.

The existing full browser suite passes on desktop and 390/320px viewports. An additional v3 browser journey passes for the seven actual template previews, full-size selection, single-address preview send, blocked-preview rejection, no campaign creation during preview, and permanent-exclusion screens on mobile. All external requests were blocked and every mail send was intercepted. Gmail/Outlook/Apple Mail inbox rendering and production mail delivery were not tested.

## Publication and deployment

Frontend publication follows the existing `Anaqweh/re` master / GitHub Pages flow. A frozen v2 editor remains available until the server advertises Studio v3, avoiding mixed-version behavior.

Backend installation uses the existing pinned-release `scripts/deploy-message-center.sh COMMIT_SHA`. It includes the new suppression module, retains Docker Compose/environment/uploads, backs up prior source, rebuilds the API and verifies both health version 3 and protected route availability. It rolls back files/image on health failure; additive schema/ledger protections are retained. The script does not create test emails or campaigns. The worker may resume previously authorized queued/scheduled mail.

This development session had no authenticated SSH connection to the DigitalOcean host. A GitHub commit does not establish backend deployment; the server deployment command and successful health check are still required.
