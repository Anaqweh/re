# Free-card certificate email repair

The free-card booking endpoint previously forced `certificateRequested:false`, and the confirmation email suggested a WhatsApp inquiry. This update carries the explicit certificate choice through verification and booking, displays the server-calculated fee, queues the existing private name/payment link, and removes the certificate WhatsApp inquiry.

The main registration, paid-course payment settings, package discounts, duplicate policy and email suppression remain in effect. New requests keep the existing three-minute delay and minute-by-minute worker. No automatic historical backfill is performed.

The free-card page checks the new API capability. Until the API is updated, it links to the existing certificate-aware registration page instead of submitting to the old endpoint.

## API deployment

Run `deploy-certificate-email-fix.sh FULL_COMMIT_SHA` in the existing server. It stages exact patches for `server.js` and `certificate-requests.js`, preserves unrelated edits, backs up the source, rebuilds only `api`, and restores the prior files/image if startup validation fails. It does not edit environment secrets, courses or payment configuration.

An optional targeted repair is supported:

```sh
bash deploy-certificate-email-fix.sh FULL_COMMIT_SHA REGISTRATION_REFERENCE EMAIL COURSE_UUID REVIEWED_AMOUNT_AED
```

Supply these four extra values only when that learner explicitly requested the certificate. The repair locks and matches one confirmed card registration and its course/recipient, verifies the server-calculated optional-certificate fee against the reviewed amount, and creates a unique request on that existing registration. It does not create a booking, consume card units, or change a paid request. Existing requests are reported without resending. A newly repaired request is due immediately and is sent by the existing worker, with the same suppression and idempotency rules.

If the targeted repair fails, the validated API update remains installed and the repair transaction rolls back. Inspect the reported error; do not bypass its matching or price guards.

## Verification

Disposable PGlite integration tests cover selected/unselected certificates, the 199 AED configured fee, quote mismatch rejection, private checkout, verified payment webhooks, email retries/suppression, and idempotent repair without another card debit. jsdom tests cover the free-card selection/summary/back controls, no-certificate path and old-API fallback. No production test registrations, payments or emails were created.
