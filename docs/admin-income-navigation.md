# Certificate income and admin refresh

The dashboard previously summed every registration's requested total. It now
reports **collected certificate fees** and the number of certificates with a
matched live electronic receipt. Course fees, package face values, pending
certificate requests, manually changed enrolment statuses and test-mode Stripe
sessions are not included in this metric.

The read-only registration query requires a paid certificate request, a payment
intent and timestamp, AED amount, and either a matching paid `cs_live_` individual
Checkout attempt or a matched Payment Link receipt verified by Stripe API/event.
Each request contributes once even when both evidence sources exist. A cancelled
registration does not itself refund or erase an existing receipt. This is gross
recorded certificate income, not bank settlement, net of Stripe fees, or a new
refund reconciliation feature. Unmatched Payment Link receipts remain in the
existing review queue and enter this report when matched. No records are reset,
deleted or marked paid by this change.

The registration/overview metric follows the existing course and search filters.
An older backend produces `—` and an update notice instead of a misleading total.
Deploy with `bash scripts/deploy-admin-income.sh FULL_REVIEWED_COMMIT_SHA` on the
API host. The script checks the reviewed baseline, preserves the production
Dockerfile, backs up and restores code/image on a failed build or smoke test,
checks authentication, and prints the actual income report in a read-only DB
transaction. No environment variables, payment settings or worker schedules are
changed. Restarting the API resumes its existing scheduled workers.

Admin navigation saves both the current hash and tab session preference. A direct
section link takes precedence; late-mounted sections are restored when ready.
Asynchronous navigation holds its target until the new section activates. Tab
clicks replace the hash without leaving the page; programmatic section changes
and refresh are also remembered. Login expiry remains 60 minutes and refresh
does not extend it. Existing form-draft recovery is retained.

Message Center also retains its internal page (reports, templates, contacts,
settings and other panels), independently of whether a draft exists. Recovering
unfinished writing restores the editor contents without forcing the compose
panel open. Explicit New Subscribers navigation takes precedence over a stored
panel; moving to another internal panel updates the active top-level tab. Stale
or invalid panel preferences and compose preferences without a recoverable draft
fall back to the overview. This follow-up is frontend-only; it does not require
an API restart or change email delivery, scheduling or draft autosave behavior.

Verification: disposable PGlite report fixtures (including live/test/mismatched
and duplicate evidence), real income UI rendering, session/draft/navigation
regressions, sidebar, existing registration deletion and payment-editor tests.
