# Owner email registration exception

The owner explicitly requested that `ahmadanakwa@gmail.com` be allowed to register repeatedly for testing. The server compares the exact address after trimming whitespace and lowercasing it; aliases, plus-addresses and other recipients are not included.

The exception applies to free public course registrations, authenticated card registrations and new free-package orders. The existing duplicate behavior is preserved for all other addresses. Free-package submissions with the same request key still reuse the existing order, so a lost response does not issue an additional card. A fresh successful order can be followed by another intentional submission.

Card authentication, eligibility, expiry, balances, certificate prices, payment confirmation, stock limits, consent and suppression controls are unchanged. Repeated card bookings use the normal balance and create separate certificate requests when selected. This is not a free-payment or unlimited-balance mode. No front-end design or customer data was changed.

Five targeted checks passed across disposable database fixtures: exact-address matching, the real free-registration handler, repeated owner card bookings with separate certificate requests, ordinary card duplicate prevention, and free-package repetitions with idempotent retries. Messages and payment providers were intercepted locally; no live test registration, payment or email was created.

Deploy with `scripts/deploy-registration-repeat.sh FULL_COMMIT_SHA` on the existing API server. It stages narrow edits to the three affected modules and Dockerfile, adds the policy module, checks syntax and creates protected backups before rebuilding only the API service. Unknown source stops before live writes. Failure restores previous files and the previous image. Verification checks API health and the installed exception without creating registrations. Environment settings and the database are not modified by the installer.
