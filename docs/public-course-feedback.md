# Direct trainee feedback

Public page: `/course-feedback.html?course_id=COURSE_UUID`.
Admin: «تجارب المتدربين» → choose a course → «نسخ رابط التقييم».

The public form collects a display name, opinion, 1–5 rating, and consent to display/reuse with original course attribution. No email, card number or registration is required. It does not verify attendance. All submissions are unverified drafts regardless of client input; an admin must publish them. Original course and display placement are set on the server. Existing homepage and course visibility rules are retained.

Requests have a unique retry key. A failed response can be retried without a second record; changed data cannot reuse an existing key. Honeypot, length checks and a database-backed 100 submissions/network/hour limit reduce abuse without preventing ordinary shared-classroom use. No notifications are sent. The API stores a hash of network address for rate limiting, not its raw value.

Deployment: run `scripts/deploy-public-feedback.sh FULL_COMMIT_SHA` on the existing droplet, then merge this branch. The script refuses a different baseline server hash, backs up server.js, builds only the API, and restores the previous image if checks fail. Additive database columns remain on rollback. Existing scheduled workers resume their existing schedules.

Tests: public submission moderation, rejected invalid input, duplicate retry protection, inactive courses, preserved retry key on network failure, escaped review text and admin script syntax. Production submission was not tested to avoid fake opinions.
