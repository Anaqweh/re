#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_release_ref="${1:?Usage: bash deploy-membership-payments.sh COMMIT_SHA}"
[[ "$inexc_release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
# Do not run the historical course activation migration on an older installation.
curl --fail --silent --show-error http://127.0.0.1:3000/api/payments/stripe/capabilities |
  python3 -c 'import json,sys; c=json.load(sys.stdin); sys.exit(0 if c.get("perCourse") is True and c.get("version",0)>=2 else "Existing course payment controls are required; nothing was changed.")'
inexc_membership_stage="$(mktemp -d)"
trap 'rm -rf -- "$inexc_membership_stage"' EXIT
curl --fail --silent --show-error --location --retry 2 \
  "https://raw.githubusercontent.com/Anaqweh/re/$inexc_release_ref/scripts/deploy-learner-workspace.sh" \
  -o "$inexc_membership_stage/deploy.sh"
INEXC_REQUIRE_STRIPE=1 INEXC_REQUIRE_PAYMENT_CONTROLS=1 INEXC_REQUIRE_MEMBERSHIP_PAYMENTS=1 \
  bash "$inexc_membership_stage/deploy.sh" "$inexc_release_ref"
echo 'Membership electronic payment and bank transfer installed. Saved course payment choices were not changed.'
echo 'Checking an internal USD checkout session and immediately expiring it. No payment, membership order, card or email is created.'
if ! docker compose exec -T api node /app/check-stripe-readiness.js --usd; then
  echo 'The update is installed. Stripe permission or account readiness needs attention; see the safe diagnostic above.' >&2
  exit 2
fi
echo 'Membership checkout is ready: https://www.inexctraining.com/cards/'
echo 'Manage each card plan in admin-portal.html > INEXC cards. Existing plan prices remain in USD.'
