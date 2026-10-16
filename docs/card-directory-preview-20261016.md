# Card directory and timed learner-card preview

## Admin

`admin-card-directory.js` adds **البطاقات والمتدربون** to the existing admin tabs. A shortcut also appears in the existing memberships view. It is read-only and uses the existing admin session.

- Buyers and orders: existing protected `/admin/memberships/orders` and `/admin/memberships/cards` APIs, search and status filtering, 25 rows per page, and a link to an issued card when present.
- Issued membership cards: holder details, plan, card number, remaining units, expiry-aware Arabic status and existing private card link.
- Digital learner cards: existing `trainee_profiles` source through the existing Supabase configuration, with exact count, stable ordering and server-side pagination/search. The selected fields are only `id,full_name,email,phone,specialty,created_at`. Derived card IDs match `TraineeAuth.buildDigitalId`.

The digital learner card is a profile/training record, not an additional paid product. Its listing is deliberately separate from membership purchases. Existing database grants are unchanged; the directory validates the administrator against a protected membership endpoint before accessing the existing learner source. The UI does not replace database authorization. Rejected source access remains an error, not an empty list or permission bypass.

No records are read before an active admin opens the directory. Logout clears rendered personal data and local arrays; superseded and late responses are ignored. No data is persisted by this module, and directory search fields have no draft persistence keys. Membership card tokens remain in links to the existing card route, with noreferrer/noopener. Data text is escaped and link identifiers validated.

## Public page

The base `/digital-id.html` landing page schedules a native modal after 3,000 ms. It uses the unchanged approved `TraineeCard.render` card, marked as an illustrative, unissued sample. The visitor can close it, return to their card lookup, or browse training cards.

The modal is skipped for actual record links and explicit previews, and cancelled when a visitor starts using the lookup. Hidden tabs defer display until visible. The dialog opens once per page load. No record, payment, email or registration is created.

## Validation

Passed 25 local JSDOM tests across:

- `inexc-api/test/card-directory-ui.test.js`
- `inexc-api/test/trainee-card-ui.test.js`
- `inexc-api/test/membership-payment-ui.test.js`

Coverage includes admin gating, read-only requests, search/status/paging, safe links and text, source errors and retry, logout and in-flight responses, the 3-second timer, dismissal/lookup interaction, and existing checkout/actual card behavior. These use isolated fixtures, not production records.

Frontend-only change; no database migration, API restart or DigitalOcean deployment command is required. Live authenticated buyer data was not inspected because this workspace has no active admin session.
