# Navigation responsiveness — 2026-10-18

The approved styles, forms and payment rules are preserved. This is a frontend-only release; no API deployment, database changes, live registrations, payments or messages are required.

## Findings and changes

- Draft recovery previously queried every saved scope after any child DOM mutation. With a synthetic 1,000-row registration table, changing a counter scanned 2,008 controls. The observer now restores only newly inserted controls and changed select options; the same counter update scans zero controls. Keystrokes update the changed field while explicit form capture and synchronous persistence continue to protect edits.
- Registration rendering is bounded to 50 rows per page. Search and metrics still cover all matching records; select-all still selects every matching record, across pages. Selection no longer rebuilds the table. Keyboard focus survives pagination.
- Independent initial course/registration reads run concurrently. Concurrent reads share one request; registration refreshes update course counts locally. A post-mutation refresh supersedes older reads, and stale responses cannot overwrite it. Opening a course editor uses its already loaded axes/outcomes rather than fetching the whole course catalog again.
- Public scripts download without blocking HTML parsing while preserving execution order and registration configuration dependencies. Both registration routes use the current shared branding script.

## Verification

38 focused automated checks passed, covering draft recovery/session expiry, navigation, large-list pagination and selection, request races, course editing/eligibility, safe deletion, bank/link/Stripe controls, card checkout and certificates. Public-page integration tests execute the actual deferred scripts using local resources and mocked read-only API responses.

A local jsdom diagnostic with 1,000 synthetic registrations took approximately 831 ms to build the old table and 72 ms with pagination and a reused date formatter. These are fixture timings, not measurements of a visitor's browser or the live server. No graphical browser was available for visual/performance profiling.

Run the focused checks from the repository root:

```sh
node --test inexc-api/test/navigation-performance.test.js inexc-api/test/admin-workspace.test.js inexc-api/test/admin-shell.test.js inexc-api/test/registration-deletion-ui.test.js inexc-api/test/course-payments-admin-ui.test.js inexc-api/test/course-payment-ui.test.js inexc-api/test/course-card-access-ui.test.js inexc-api/test/learner-ui.test.js inexc-api/test/stripe-ui.test.js
```
