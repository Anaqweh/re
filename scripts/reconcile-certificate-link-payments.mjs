// Run on the API host through `docker compose exec -T api node --input-type=module - ... < this-file`.
// Default: dry run. --apply records verified receipts and matches only unique, eligible existing requests.
// No Stripe writes, enrolments, certificate issuance, payment retries or email sends.
import pg from 'pg';
import {STRIPE_API_VERSION} from './stripe-payments.js';
import {createCertificateLinkPayments,validateCertificateLinkSession} from './certificate-link-payments.js';

const args = process.argv.slice(2), apply = args.includes('--apply');
const ids = [...new Set(args.filter(value => value !== '--apply'))];
const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
let pool;
async function stripeGet(path,operation) {
  const response = await fetch('https://api.stripe.com/v1/'+path, {
    headers: {Authorization: 'Bearer '+key, 'Stripe-Version': STRIPE_API_VERSION},signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const permissions = [...new Set(String(data?.error?.message || '').match(/\brak_[a-z_]+\b/g) || [])];
    throw new Error(JSON.stringify({operation,httpStatus: response.status,permissions,
      requestId: /^req_[a-zA-Z0-9]+$/.test(response.headers.get('request-id') || '') ? response.headers.get('request-id') : null}));
  }
  return data;
}
try {
  if (!ids.length || ids.length > 50 || ids.some(id => !/^cs_live_[a-zA-Z0-9]+$/.test(id))) throw Error('Provide 1–50 live Checkout session IDs; optionally --apply.');
  if (!/^(rk|sk)_live_/.test(key)) throw Error('Live Stripe server key is not configured.');
  const evidence = [];
  // Complete ALL live verification first. A permission failure cannot partially backfill this batch.
  for (const id of ids) {
    const session = await stripeGet('checkout/sessions/'+encodeURIComponent(id),'read_checkout_session');
    if (session.id !== id || !validateCertificateLinkSession(session)) throw Error('Session is not a paid, approved certificate Payment Link: '+id);
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    const intent = await stripeGet('payment_intents/'+encodeURIComponent(intentId)+'?expand[]=latest_charge','read_payment_intent_and_charge');
    const charge = intent.latest_charge;
    if (intent.id !== intentId || intent.livemode !== true || intent.status !== 'succeeded' || intent.currency !== session.currency ||
        intent.amount_received !== session.amount_total || !charge || charge.livemode !== true || charge.paid !== true ||
        charge.refunded !== false || charge.amount_refunded !== 0 || charge.disputed !== false || charge.payment_intent !== intentId ||
        charge.amount !== session.amount_total || charge.currency !== session.currency || !Number.isSafeInteger(charge.created)) {
      throw Error('Payment requires manual review; no batch changes made: '+intentId);
    }
    evidence.push({session,paidAt: new Date(charge.created*1000).toISOString()});
  }
  pool = new pg.Pool({host: process.env.PGHOST || 'db',port: Number(process.env.PGPORT || 5432),database: process.env.POSTGRES_DB,user: process.env.POSTGRES_USER,password: process.env.POSTGRES_PASSWORD});
  const service = createCertificateLinkPayments({pool}), results = [];
  for (const {session,paidAt} of evidence) {
    const result = await service.record(session,{apply,evidence: 'stripe-api-read',paidAt,paidAtSource: 'charge'});
    results.push(result);
    // Output each committed result immediately; reruns are idempotent even after a lost connection.
    console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({mode: apply ? 'APPLIED_VERIFIED_RECEIPTS' : 'DRY_RUN_NO_CHANGES',
    matched: results.filter(r=>r.state==='matched').length,review: results.filter(r=>r.state==='review').length,
    stripeWrites: 0,emailsSent: 0,registrationsCreated: 0}));
} catch (error) {
  // Never print a provider payload or key. Earlier committed results, if any, are safe to resume.
  console.error('Certificate reconciliation stopped. '+error.message);
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
