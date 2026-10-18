# AI licence registration reset

Owner request: remove the earlier registrations for the free AI licence course and send a formal apology explaining the administrative ambiguity and later instructions for mailing-list subscribers. Also expose a clear delete action next to each registrant.

The operation is restricted to course `ea14c5bd-ab64-4e77-8b1b-b5c09aa8eed0`, its expected Arabic name and zero course price. It affects registrations created at or before **18 October 2026, 21:02:51 Dubai time** (`17:02:51Z`), the request timestamp. Later registrations and all other courses are preserved.

The reset is one transaction: archive the selected registration records, return used card units, remove those registrations and their unpaid certificate requests, and queue one exact apology payload per normalized email. A batch marker makes re-running the command safe. A deletion failure rolls back both data changes and queued messages. Payment-linked records, receipts, issued certificates, or a currently sending certificate email stop the operation for review. No refunds are issued, and membership cards themselves are retained.

The existing message worker sends the queued campaign and enforces existing email suppression preferences. Delivery statistics are available in the message center and through `node /app/run-ai-licence-reset.js --status`. A provider-accepted message is not proof of inbox delivery. The existing worker retains exact payloads and idempotency keys; uncertain attempts older than its safe retry window require review, as [Resend retains idempotency keys for 24 hours](https://resend.com/changelog/idempotency-keys).

The ordinary per-registrant delete action does not queue an apology. It uses the same card restoration and financial guards and requires authenticated administration. The UI checks the new server capability before calling DELETE, so an old server cannot silently use its unsafe legacy handler.

Deployment patches only the known server entry points and Docker copy instruction. It preserves unrelated deployed source and environment settings, backs up changed files, and restores the previous API image if installation fails. The batch action runs only with `--reset-existing-ai-registrations`, after health verification.

Validation uses a disposable PGlite database and local DOM fixtures: no production registrations, test charges or test emails are created. Browser rendering is unavailable in this managed environment.
