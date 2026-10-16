# Membership purchase payments

`/cards/` offers electronic payment and bank transfer according to each membership plan's saved methods. The administrator can enable either, both, or neither under **الباقات التدريبية → مواصفات الباقات → طرق الدفع**. Course payment methods and course registration pages are unchanged.

The first deployment enables `stripe` and `bank` for existing membership plans only. Original method arrays are retained in `membership_payment_migrations.before_methods`. Later administrator choices, including an empty array, survive restarts. Existing prices, quantities and benefits remain unchanged; membership prices and electronic checkout currency remain **USD**.

Bank details are read from the existing active course accounts without writing course records. A single shared account is required; different saved accounts disable membership bank transfer rather than selecting one arbitrarily. The purchase dialog shows the saved account holder, bank name when available, account number and IBAN, with copy buttons and receipt upload. It does not invent an exchange rate for transfers in another currency.

Electronic purchases create an order using the database price and frozen plan benefits. Retries reuse a persisted Stripe idempotency key. The existing signed `/api/payments/stripe/webhook` routes membership events separately from course events. Both completed and asynchronous success events verify the retrieved Stripe session's live mode, amount, USD currency, order and session identity before issuing a card. Unpaid, expired or failed sessions do not issue cards. Bank transfers require administrator confirmation against the actual payment record. Confirmation and card issuance share one database transaction; repeat confirmations cannot issue another card.

The private return page obtains status from the server. Its bearer token is carried in the URL fragment and cleared from the address bar. Card access appears only after verified payment and issuance. Notification email failure does not invalidate an issued card; the private result page and existing card recovery remain available.

## Deployment on the existing droplet

Run `bash scripts/deploy-membership-payments.sh FULL_COMMIT_SHA` from a downloaded, pinned release. The wrapper requires the existing per-course payment controls before proceeding, backs up previous API files through the deployment helper, installs the new module, rebuilds the API, and checks membership payment readiness. Existing Stripe secrets are reused on the server.

The final readiness check creates and immediately expires an internal USD Checkout session. It does not create a membership order, customer, card, payment or email. A readiness failure prints a redacted diagnostic and exits with code 2; installed controls remain available. The normal application workers resume their existing schedule after the API restarts.

Frontend and API can deploy independently: before the new API is installed, existing bank purchases still work when the public course records provide one account. Electronic payment and membership payment editing become available with the updated API. No paid transaction is claimed as verified by deployment alone.

## Local validation

`node --test test/membership-payments.test.js test/membership-payment-ui.test.js` uses a disposable PGlite database and mocked Stripe/mail only. Coverage includes unchanged course records, one-time activation, administrator choices, server prices, idempotent retries, shared stock reservations, verified webhook dispatch, atomic rollback/issuance, private result access, bank receipt requirements, payment method switching and account copying. Course payment regression tests cover the shared webhook and unchanged course controls.
