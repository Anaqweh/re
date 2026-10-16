#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
inexc_release_ref="${1:?Usage: bash deploy-course-payments.sh COMMIT_SHA}"
[[ "$inexc_release_ref" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
inexc_payment_stage="$(mktemp -d)"
trap 'rm -rf -- "$inexc_payment_stage"' EXIT
curl --fail --silent --show-error --location --retry 2 \
  "https://raw.githubusercontent.com/Anaqweh/re/$inexc_release_ref/scripts/deploy-learner-workspace.sh" \
  -o "$inexc_payment_stage/deploy.sh"
INEXC_REQUIRE_STRIPE=1 INEXC_REQUIRE_PAYMENT_CONTROLS=1 bash "$inexc_payment_stage/deploy.sh" "$inexc_release_ref"
cd "${INEXC_API_DIR:-/opt/inexc-training/inexc-api}"
echo 'Payment controls deployed. Stripe was enabled once for the existing courses; later administrator choices survive updates.'
echo 'Checking creation and immediate expiration of an internal Stripe session. No registration, customer, payment or email is created.'
if ! docker compose exec -T api node /app/check-stripe-readiness.js; then
  echo 'The administration controls are installed. Stripe readiness needs attention; see the safe diagnostic above or run the check from the Payment Methods page.' >&2
  exit 2
fi
echo 'Stripe session creation verified. Manage each course or all courses in admin-portal.html#payments.'
