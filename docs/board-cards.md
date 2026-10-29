# Course board cards

Admin: select any current or archived course, enter the AED price, upload the card sample, enable and save. The server creates a Stripe Payment Link automatically using the existing live Stripe credentials. Payment URL is read-only in the admin form. No customer messages are sent by saving.

The server creates a fixed AED Price and Payment Link with course metadata. A price/name change creates a replacement and deactivates the previous link. Disabling a card deactivates its managed link. Repeated identical saves reuse the same link. Buyer details and payments are available in the Stripe dashboard; this feature does not mark certificate requests paid or issue cards automatically.

Requires STRIPE_CHECKOUT_ENABLED=1 and the existing live STRIPE_SECRET_KEY with write permissions for Products, Prices and Payment Links. No keys belong in the browser. Provider errors are sanitized. Live payments were not made in automated tests.

Run scripts/deploy-board-cards.sh with the full commit SHA on the API host. It patches the current server, backs up files and restores the previous image on a failed health check. Version 2 of /api/board-cards/capabilities indicates automatic links support.

Tests: node --test test/board-card-auto-payment.test.js test/board-card-offers.test.js test/board-card-ui.test.js
