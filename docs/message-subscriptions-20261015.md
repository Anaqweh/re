# INEXC subscription links and safe exports

## Use

- Public subscription page: `https://www.inexctraining.com/subscribe.html`.
- Message center → **رابط الاشتراك والمشاركة**: edit page and confirmation copy, pause intake, copy general or campaign links, download an SVG QR code, see confirmed/pending/expired/blocked counts and the latest 50 requests. The campaign selector shows the latest 100 campaigns.
- The share view (`?share=1`) offers WhatsApp, clipboard, and device sharing where supported. Links contain only an optional public campaign source code, never recipient email, delivery unsubscribe tokens, or confirmation tokens.
- New messages default to an editable share invitation. Existing drafts/campaigns remain unchanged until the operator enables sharing. A new campaign's rendered email uses its own source code, including when scheduled. Retry snapshots are unchanged.
- Confirmation creates/updates one contact without overwriting an existing profile and adds it to **مشتركو الرسائل — اشتراك مؤكد**. Admin “إنشاء رسالة للمشتركين” only opens the composer; sending still requires review and confirmation.
- Intake does not enqueue campaigns or enrol subscribers into separate automatic course alerts. The group is available in the existing campaign audience selector.

## Confirmation and suppression

The public form requires a valid address and explicit consent. Confirmation tokens are random 32-byte values, stored as SHA-256 hashes, expire after 24 hours, and are removed from the address bar by the page. GET requests and email scanners cannot activate subscriptions: an explicit POST is required. Replays do not create duplicate contacts or memberships. Renewal rotates the token. Confirmation never re-adds deleted contacts on a replay.

Permanent exclusions are checked before requesting mail, again through the marketing-send guard, and on confirmation under the same per-email database advisory lock used by suppression writes. Remote ledger failures close request, confirmation, and export paths. Pending/expired requests stay out of contact exports and mailing groups. Suppressed signups return the same generic acknowledgement as existing signups and receive no mail. An old confirmation link cannot restore a suppressed address.

Contacts CSV excludes suppressed addresses. Registration CSV retains business rows but blanks suppressed email fields. The explicit suppression-ledger JSON export remains separate and must accompany migrations (or use the existing shared-ledger integration); no software can enforce a private ledger on an unrelated site that has not imported or connected to it.

## Abuse controls

Honeypot, persisted request limits (120 per peer IP / 15 minutes, 3 confirmation attempts per address / day, 2000 total per day), one-hour resend cooldown, and confirmation attempt limits. Forwarding headers are deliberately not trusted, so installations behind a proxy can share the peer-IP limit. These limits are database-backed and survive process restart. No automated resend worker is added. Uncertain provider failures retain a cooldown. Limits are checked before rotating an existing token.

Settings and administrative records require existing admin authentication. QR generation uses pinned `qrcode@1.5.4` locally; no third-party QR service receives the links.

## Deployment

Frontend is GitHub Pages. API is the existing DigitalOcean Docker service. Use `scripts/deploy-message-center.sh FULL_COMMIT_SHA` from this release. It backs up replaced files, adds the two subscription modules and QR dependency, runs additive schema changes at startup, and checks `messageStudioVersion:5` plus `subscriptionsVersion:1`. Rollback restores the old code and image; new additive tables can remain inert. No test messages or campaigns are created. Existing previously authorised queues resume as before.

Until API update, the subscription page shows an unavailable state; existing message-center functions remain usable and the sharing composer controls are hidden.

## Verification

Node/PGlite tests cover confirmation, expiry, renewal, deduplication, existing-profile preservation, campaign attribution, authentication, QR generation, suppression after deletion, pending-to-suppressed transitions, remote-ledger fail-closed behaviour, and rate limits. DOM interaction tests exercise public submit/explicit confirm/share and admin content editing/campaign selection/group composer. All mail calls use local recording stubs. No real email is sent.

Native visual browser QA was unavailable in this session: the required managed browser skill was absent. No browser preview or physical-device verification is claimed. The public page uses responsive CSS at 900px and 650px, semantic forms, RTL text, LTR email fields, focus outlines, and local licensed IBM Plex Sans Arabic fonts.
