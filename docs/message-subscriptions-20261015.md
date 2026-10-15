# INEXC subscription links — instant signup, revision 2

## Current behavior

- Public URL: `https://www.inexctraining.com/subscribe.html`.
- The approved logo is the exact uploaded file, copied without any image modification to `assets/inexc-approved-logo.jpg`. The supplied file has JPEG bytes despite its original `.png` filename. The visitor header, favicon and link-preview image use this original. The invented icon/geometric wordmark and administrative English step labels are removed from the page.
- A valid form submission with consent immediately adds the eligible address to `message_contacts` and the **مشتركو الرسائل** group. No confirmation email is sent. The contact becomes available to normal contact export and campaign group selection immediately.
- Existing contacts keep their name, source and existing tags. Addresses are normalized and deduplicated. Submitting an address again does not reset its signup date, campaign source or review status. First signups with an existing contact are identified separately in the admin table.
- A distinct **المشتركون الجدد** button with a person-plus icon appears in the main admin navigation and inside the message center. Its badge counts unreviewed, non-suppressed signups. The dedicated view provides search, filtering, pagination, source/date/status, opening contacts, composing for the subscribers' group, and explicitly marking only currently displayed records as reviewed.
- **رابط الاشتراك والمشاركة** edits visitor copy, pauses signup, selects general or campaign source links, copies/WhatsApp-shares them, downloads QR, and displays campaign counts. Legacy confirmation-email settings are no longer part of this new-signup editor.
- New messages retain the editable optional share invitation. Campaign links expose only public campaign source codes; no email address, delivery token or confirmation token is shared. Sending a campaign still requires the existing review and confirmation flow.

## Persistence and backward compatibility

Additive fields: `subscribed_at`, `seen_at`, `signup_method`, `contact_id` and `added_new_contact`. Direct signups have `signup_method=direct`, `consent_version=2`, a stored consent string, and a subscription timestamp. `confirmed_at` remains null for direct signup, so the database does not claim mailbox ownership was verified.

Previously confirmed signups migrate into subscription history. Previously issued, unexpired confirmation links still work, under the existing suppression guards. Expired or suppressed links fail. A pending user who submits the current form is enrolled directly and the obsolete token is cleared. Existing custom group names are preserved; only the original default verified-group name is updated. The old default confirmation note is replaced, while custom page copy is retained.

Signup works even if sending service configuration is temporarily absent. It does not create a campaign, send a welcome message, or enrol anyone in the separate automatic course-alert system.

## Permanent exclusion

Local and optional shared suppression ledgers are checked before enrollment; the local decision, contact insertion and group membership occur under the same per-email advisory lock as suppression writes. A suppressed address cannot rejoin through this form, confirmation, import or contact deletion. The existing sender rechecks suppression. Shared-ledger failure stops enrollment and safe exports.

Contact CSV omits suppressed addresses. Registration CSV preserves transaction rows but blanks suppressed email fields. The separate suppression JSON transfer remains available and must accompany migration (or connect the shared ledger).

The public acknowledgement is generic for existing and excluded addresses and does not disclose their status. Admin history can display excluded signups, but they are excluded from active/new counts and export.

## Operations and checks

- API health: `messageStudioVersion:5`, `subscriptionsVersion:2`.
- Update the existing DigitalOcean API with the pinned `scripts/deploy-message-center.sh FULL_COMMIT_SHA`. It backs up files, installs additive changes, verifies the health version, and rolls code/image back on failure. The script creates no test campaigns or emails; previously authorised queues resume normally.
- Until API update, the new public page and dedicated admin views show unavailable/update-required states.
- Persisted IP rate limits, a global daily enrollment cap, honeypot and explicit consent remain. Forwarding headers are not trusted; proxy installations may share the peer-IP limit.
- Tests use disposable PGlite and stubbed mail. They cover immediate insertion, uniqueness/concurrency, attribution, old-profile preservation, new/unread/seen states, auth, legacy migration/tokens, QR, suppression and exports. DOM interaction tests cover visitor submission, original-logo wiring, removed admin labels, content editing, source selection and new-subscriber review.
- Native visual browser QA remains unavailable because the required managed browser capability is absent. No visual or physical-device test is claimed.
