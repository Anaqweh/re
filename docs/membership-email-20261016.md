# Training card email builder

Adds an email starter to **بطاقات INEXC → إرسال البطاقات بالبريد**, the message center header, and its template gallery.

The administrator selects one, two, or all published membership plans, edits the subject and introduction, and previews the email at desktop or phone width. Continue opens a new draft in the existing composer. Recipient selection, preview, templates, suppression handling, final review and sending keep using the existing studio workflow.

The starter reads `/memberships/plans` without caching. Prices, validity and feature lines come from the current catalog. If feature lines are empty, benefits are derived from stored booking costs, discount, early access and perks. Sold-out plans are labeled. The public CTA uses `/cards/`, never a legacy plan payment link. No issued card number, customer data or bank details are included.

Emails use the existing rich text format, IBM typography, blue signature layout, plain-text fallback and unsubscribe footer. The selected catalog content becomes an editable snapshot in the draft/template; reopen the starter to obtain later catalog changes. No backend migration or DigitalOcean update is required.

Preserved: checkout appearance and payment handling, course payment settings, memberships API, messaging renderer, existing presets and sending logic. No payment, card issuance, live registration or live email was created.

Validation: `node --test test/message-memberships.test.js test/message-workspace-ui.test.js` passes 9 tests, including selection, escaping, API draft/template/preview round trips, empty/error states, single handoff, existing draft preservation and recovery. Tests use a disposable local database and recording mail stub; none contact an email provider.


## Per-card links

Each selected card has a blue **استعرض البطاقة ومزاياها** button pointing to `/cards/?plan=<id>` and, when available, a smaller **احجز هذه البطاقة مباشرة** link pointing to `/cards/?book=<id>`. The details link scrolls to and focuses the matching existing card; the booking link opens that card's existing checkout. Neither creates an order. Sold-out cards cannot auto-open checkout; missing/hidden cards show a status message above the current catalog. Payment-return resume takes precedence. No stylesheet or checkout markup was changed; only the checkout script version changed in its HTML.

Additional verification covers per-card links after API preview/template round trips, exact-card selection, no POST on navigation, sold-out/missing plans and preserving payment-return drafts.
