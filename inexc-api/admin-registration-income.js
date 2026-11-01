// Read-only reporting. Requested prices and manually selected enrolment statuses
// are not proof of income. EXISTS keeps each certificate receipt counted once.
export const ADMIN_REGISTRATIONS_SQL = `
SELECT r.*,
 CASE WHEN q.state='paid' AND q.paid_at IS NOT NULL
  AND q.payment_intent ~ '^pi_[a-zA-Z0-9]+$'
  AND q.amount>0 AND q.currency='aed' AND (
   EXISTS (
    SELECT 1 FROM certificate_payment_attempts a
    WHERE a.request_id=q.id AND a.state='paid'
     AND a.stripe_session_id ~ '^cs_live_[a-zA-Z0-9]+$'
     AND a.amount=q.amount AND a.currency=q.currency
   ) OR EXISTS (
    SELECT 1 FROM certificate_link_payments p
    WHERE p.request_id=q.id AND p.state='matched'
     AND p.stripe_session_id ~ '^cs_live_[a-zA-Z0-9]+$'
     AND p.payment_intent=q.payment_intent
     AND p.course_id=r.course_id
     AND p.amount=q.amount AND p.currency=q.currency
     AND (p.evidence='stripe-api-read' OR p.evidence ~ '^evt_[a-zA-Z0-9]+$')
   )
  ) THEN q.amount ELSE 0 END AS verified_certificate_amount_fils
FROM registrations r
LEFT JOIN certificate_requests q ON q.registration_id=r.id
ORDER BY r.created_at DESC`;

export async function adminRegistrations(pool) {
 return (await pool.query(ADMIN_REGISTRATIONS_SQL)).rows;
}
