# Course board cards

Independent per-course offer settings: name, description, AED display price, HTTPS payment link, sample upload/URL, enabled status. The admin section lists active and archived courses; enabling an offer never republishes the course. Public page: `/board-card.html?course=COURSE_UUID`. Disabled offers return 404. Only authenticated administrators may list or save settings or upload samples.

This feature stores a merchant-provided payment link. It does not create Stripe prices, charge a customer, synchronize payment receipts, or mark a registration paid. Operators must check that the linked checkout matches the displayed amount and AED currency. Offers remain disabled without a payment URL. Existing certificate requests and membership cards are unchanged. No new email jobs or payments are created.

Deploy the frontend from this repository and run `scripts/deploy-board-cards.sh FULL_COMMIT_SHA` on the existing API host. The installer patches the host's existing server and Dockerfile instead of replacing other deployed code. It backs up files and the running image, performs syntax and health checks, and restores the previous application on failure. The additive offer table remains if rollback is required. Scheduled workers continue normal existing behavior after restart.

Validation: `node --test test/board-card-offers.test.js test/board-card-ui.test.js test/certificate-requests.test.js test/course-payment-controls.test.js test/course-card-access.test.js` from `inexc-api`.
