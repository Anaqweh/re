# Named membership cards and course eligibility

The catalogue and purchase remain training packages. An issued credential uses its package's current name: باقة الريادة → بطاقة الريادة. Card numbers, plan IDs, prices, stock, balances and existing redemptions are unchanged. The separate digital learner ID remains بطاقة المتدرب.

Course editing adds an optional featured badge and three card booking choices: all cards, selected named cards, or disabled. `membership_plan_ids = NULL` means all plans, including future plans. Selected plans use immutable UUIDs. `membership_enabled = false` disables card booking without deleting the selection. Existing courses retain their current enabled flag and initially accept all plans when enabled; no course is automatically featured.

The server checks eligibility both at quote time and under the card transaction lock at confirmation. Ineligible attempts create no registration and debit no units. Retries of a previously completed booking remain idempotent even if the course rules later change. Certificate charges, receipt handling, payment methods, published status, and booking windows continue using their existing checks.

Omitted eligibility fields preserve saved values. Bulk payment controls preserve selected plan IDs. Hidden packages remain selectable for existing holders. Names are resolved from plans, so renaming a package does not change access. A package referenced by a course cannot be deleted until that selection is removed. The new editor fields are disabled on an older API instead of pretending the settings were saved.

Validation: isolated PostgreSQL-compatible tests exercise actual create/update handlers, validation, rejected and accepted card bookings, balance preservation, concurrent/idempotent booking, and old clients. DOM tests exercise the actual admin form, selected/all/disabled choices, old-server fallback, escaping, and payment preservation. Existing checkout transitions, membership purchase, learner recovery, directory and SEO suites were also checked. No live purchase, registration or email was created.

Deploy the commit-pinned `scripts/deploy-course-card-access.sh` on the existing API host. It backs up replaced runtime files, includes the SEO module and new card-access module, rebuilds only the existing API service, checks `courseCardAccessVersion: 1`, and restores files/image if startup fails. Environment files and payment configuration are not replaced. The two additive database columns need no destructive rollback. Existing scheduled workers resume normally.

`previews/course-card-options.html` is a labelled, noindex visual fixture without real account/customer data, credentials, requests or saves. It demonstrates desktop and phone layouts; the production editor remains authenticated.
