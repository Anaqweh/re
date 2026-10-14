# INEXC Blue Edition — 15 October 2026

Seven email-native designs share cobalt, navy and blue-tinted surfaces: Afaq (course), Lab (workshop), Signed Letter, Editorial, Impact (thanks), Partnership Dossier, and the English Learning Brief. Geometric marks use presentation tables and borders. Text is HTML, not part of an image; no downloaded fonts, scripts, SVG or remote image are required for the default templates. Existing UI fonts remain unchanged. Email clients use their available Arabic/Latin fallback fonts.

## Editing

The content map opens identity, cover, information cards, body, action/signature and footer. All authored words have editable fields, including brand name/tagline, eyebrow/headline/intro, card labels/titles/text, rich body, CTA, signature, footer text/site label, and unsubscribe link label. Empty optional fields remain empty. Visibility toggles control optional regions. Cards support add, remove and reorder (maximum six). The single signature flag is shared with inserting a signature into the body.

The unsubscribe link remains operational when the footer is hidden. Empty unsubscribe wording is rejected before send. Uploaded logos are images: editing their lettering requires replacing the image or using the editable text brand instead, explained beside the logo field.

`designVersion: 2` opts into the new renderer. Version 1 and campaigns without this flag use `message-mail-legacy.js`, preserving prior rendering and retry snapshots. Old drafts remain on that renderer until edited; the editor explains the transition and the existing draft revision mechanism preserves the preceding payload. Using an old saved template creates a new editable design. The v4 frontend is capability-gated; the frozen v3/v2 interfaces remain available while the API is upgraded.

## Server deployment

API version/capability is 4. Existing additive schema and suppression enforcement are unchanged. New content settings are stored in the existing JSON columns, used consistently by drafts, templates, review, preview, plain text and real send. The deployment script copies `message-mail-legacy.js` as an additional runtime dependency and verifies version 4. It creates no test campaigns or test emails. The worker may resume previously authorized queued or scheduled campaigns.

## Verification

- Unit/database/HTTP tests: all editable regions, retained empty values, hidden regions, escaping, token validation, exact legacy renderer output, draft and template round-trip, reviewed and intercepted test message.
- Browser tests: editing all regions, add/reorder/delete cards, colors, draft reload, template reuse, clearing words, hidden regions and unsubscribe continuity. Seven server-rendered layouts checked at desktop, 390px and 320px, including long Arabic text/URLs and English LTR.
- Existing suite covers composer, saved revisions, offline recovery, imports/contacts, scheduling/edit/cancel, and suppression/preview regression tests.
- All testing uses disposable databases and intercepted messages. Actual inbox rendering in Outlook/Gmail was not tested in this session.
