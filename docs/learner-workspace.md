# Learner workspace — release 2026-10-16

The public frontend is `account.html`. `?preview=1` is an explicitly labelled, isolated sample; it performs no API calls. `?preview=1&mobile=1` renders the same page in a 390px iframe for mobile review.

Real data requires the updated DigitalOcean API. GitHub Pages deployment alone does not activate the backend. Login and card checkout fail closed until the new API is present.

## Production deployment

On the existing INEXC droplet, run `scripts/deploy-learner-workspace.sh COMMIT_SHA` from this release. The script defaults to `/opt/inexc-training/inexc-api`; use `INEXC_API_DIR` only if the existing installation uses a different directory. Use a full, reviewed commit SHA.

The script backs up and replaces only `server.js`, `learner-service.js`, and `Dockerfile`, builds the API, recreates only its container, and rolls back the old files/image if health checks fail. Migrations are additive. It does not alter campaign schedules, email credentials, contacts, PostgreSQL volumes, or card balances. It makes only read-only health/auth checks. Existing scheduled workers resume on their existing schedule after restart.

After deployment, `/api/health` must include `learnerVersion: 1`, `/api/learner/capabilities` must report `cardCheckout: 2`, and an unauthenticated `/api/learner/dashboard` request must return 401. Do not create production registrations or send test emails to verify deployment.

## Behaviour

- Owners sign in with their card number and associated email, or the private access code an administrator creates for a registration. Existing activation-link tokens are accepted by the session endpoint. Session hashes are stored on the server; the bearer token is held in sessionStorage for at most eight hours.
- Records come from the existing API registrations, courses, cards and redemptions. Completion and attended hours come only from administrator-maintained learner progress. Legacy Supabase certificates are not automatically imported or presented as current records.
- The administrator uses **ملف المتدرب** in the registration row to update progress/hours, record receipt of optional certificate fees, upload an issued PDF, or generate a private login code. These operations do not send emails. Text fields are recovered from tab storage after refresh; file inputs must be reselected.
- PDFs are stored in the persisted uploads volume under `.trainee-private`, denied by the public static server. Downloads require an owner session and ownership query. Issuing a certificate does not fabricate a PDF or auto-mark a course completed.
- Card registration locks the card on a dedicated database transaction connection. Registration, redemption and balance debit commit together. Repeating a booking for the same card/course returns the existing reference without debiting again. Concurrent different bookings cannot make the balance negative. A changed quoted unit cost or certificate fee is rejected for re-verification.
- Existing card plan units/prices are preserved. Optional certificate fees use the course's existing AED price after the plan discount; the course itself is paid in card units. Bank payment remains available when card mode is off.
- Existing cancellation/deletion behaviour is preserved: cancellation does not automatically refund card units. Refund policy and historical certificate migration are separate work, not silently introduced here.

## Verification

From the repository root, after installing the API dev dependencies:

```sh
node --test inexc-api/test/learner-service.test.js inexc-api/test/learner-ui.test.js
```

Tests use disposable PGlite databases, loopback HTTP, synthetic accounts and mocked frontend requests. They never import the production server startup or use a real mail provider. PGlite serializes its transaction connections; production uses PostgreSQL `FOR UPDATE OF c` and a guarded debit. Coverage includes duplicate/concurrent requests, rollback, eligibility, changed quotes, certificate fee handling, private downloads, owner isolation, sessions, UI invalidation, hidden receipt validation, and demo isolation.
