# Optional certificates after free-course card registration

Free-course card registrations now complete whether the optional certificate is selected or declined. Existing card eligibility, expiry, balance checks, quote verification, free-card sharing consent and transactional debits remain in force. Paid-course card registrations retain their existing bank-receipt flow.

When a certificate is selected for a free course, its request and email queue entry are created in the same database transaction as registration and card redemption. Declining the certificate creates neither a certificate request nor a payment demand. Included or zero-price certificates require name confirmation without charging. Prices and card discounts come from server records; this update does not modify course prices, payment methods or existing registrations.

The persisted queue becomes due after three minutes and is checked every minute by the API process. It uses atomic leases, bounded retries and a stable email-provider idempotency key. Cancelled registrations, already completed requests and suppressed recipients are skipped. Mail-disabled deployments do not falsely mark email as sent. No historical registrations are automatically enqueued or mailed.

The private `/certificate-request.html` link uses a random 256-bit bearer token in the URL fragment. Private API calls use POST bodies and `Cache-Control: no-store`; the page uses `no-referrer` and `noindex`. Names are supplied in the page, not in the URL. The Arabic name requires at least three components, and the English name requires a full name in Latin letters. Both appear in administration and in Checkout's submit message. An open payment attempt freezes the names until that attempt expires or definitively fails.

Stripe Checkout uses the existing account and shared signed webhook, a distinct metadata source, server-priced AED amounts and stored attempt parameters with idempotency. The handler retrieves the session from Stripe and checks request/registration/session identity, amount, currency and live mode before marking paid. Pending asynchronous payments cannot open another attempt. Failed/expired attempts may be renewed. Payment does not issue a certificate or reverse an administrator's registration cancellation.

The admin sidebar has a separate `طالبو الشهادات` section with course/status/search filters, counters, pagination, Arabic/English names, email state, payment state, private-link copying and existing learner-record access. Legacy certificate registrations are displayed but not re-billed or emailed. Where a legacy record lacks an independent certificate-price snapshot, it is labelled as part of registration fees rather than inventing a separate price. The old learner-record payment selector is read-only for payments managed by this feature.

## Verification

- Disposable PGlite database and mocked Stripe/mail tests cover atomic registration/outbox/debit, declined and zero-fee certificates, private tokens, name validation, server prices, lost-response retry, signed webhook verification, duplicate delivery, asynchronous success/failure, expiry, cancellation and mail delay/retry/suppression.
- JSDOM checks cover free-course submission without a receipt, the name page, admin filters, data clearing on logout and preserving the other payment-method transitions.
- Relevant existing learner, card-eligibility, Stripe, membership-payment and admin-shell tests were run. The previous receipt test now explicitly uses a paid course, while a new test covers the requested free-course behavior.
- JavaScript syntax, shell syntax and Git whitespace checks pass. The targeted deployment patch was applied twice to a disposable copy and verified byte-for-byte against the intended source.
- Visual browser QA was unavailable: this managed workspace has no control-browser skill. No live registration, payment, or email was created for testing.

## Deployment

Frontend files follow the existing repository publication. The existing DigitalOcean API requires `scripts/deploy-certificate-requests.sh FULL_COMMIT_SHA`. There is no connected shell for that server in this session.

The pinned installer patches staged copies of only `server.js`, `learner-service.js` and the Dockerfile, adds `certificate-requests.js`, checks syntax, saves protected source backups and rebuilds only the API service. Unknown source anchors stop before installation. A failed health/configuration/admin-auth check restores the previous source and image. Environment secrets, Compose configuration, uploaded files, payment settings and course data are preserved. New tables are additive and retained on rollback. Existing scheduled workers resume their configured schedules on API restart.

Frontend publication does not establish API activation. The feature is active only after the installer confirms `certificate-requests/capabilities` and admin access protection on the actual server.
