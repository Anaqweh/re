// Run on the API host through `docker compose exec -T api node --input-type=module - ... < this-file`.
// Default: dry run. --apply records verified receipts and matches only unique, eligible existing requests.
// No Stripe writes, enrolments, certificate issuance, payment retries or email sends.
import pg from 'pg';
import {createCertificateLinkPayments} from './certificate-link-payments.js';

const args = process.argv.slice(2), apply = args.includes('--apply');
const mappings = new Map();
const ids = [...new Set(args.filter(value => value !== '--apply' && !value.startsWith('--reviewed-match=')))];
let pool;
function parseMappings() {
 for(const argument of args.filter(value=>value.startsWith('--reviewed-match='))){
  const parts=argument.slice('--reviewed-match='.length).split('|');
  if(parts.length!==6)throw Error('Reviewed mapping requires paymentIntent|registrationId|reference|registrationEmail|payerEmail|payerName.');
  const [paymentIntent,registrationId,reference,registrationEmail,payerEmail,payerName]=parts;
  if(mappings.has(paymentIntent))throw Error('Duplicate reviewed mapping.');
  mappings.set(paymentIntent,{paymentIntent,registrationId,reference,registrationEmail,payerEmail,payerName});
 }
}
try {
  if (!ids.length || ids.length > 50 || ids.some(id => !/^cs_live_[a-zA-Z0-9]+$/.test(id))) throw Error('Provide 1–50 live Checkout session IDs; optionally --apply.');
  parseMappings();
  pool = new pg.Pool({host: process.env.PGHOST || 'db',port: Number(process.env.PGPORT || 5432),database: process.env.POSTGRES_DB,user: process.env.POSTGRES_USER,password: process.env.POSTGRES_PASSWORD});
  const service = createCertificateLinkPayments({pool});
  const evidence = [];
  // Complete ALL live verification first. A permission failure cannot partially backfill this batch.
  for (const id of ids) {
    evidence.push(await service.verifySession(id));
  }
  const verifiedIntents=new Set(evidence.map(({session})=>typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id));
  if([...mappings.keys()].some(id=>!verifiedIntents.has(id)))throw Error('Reviewed mapping does not belong to a supplied verified session.');
  const results = [];
  for (const {session,paidAt} of evidence) {
    const result = await service.record(session,{apply,evidence: 'stripe-api-read',paidAt,paidAtSource: 'charge',reviewedMatch:mappings.get(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id)});
    results.push(result);
    // Output each committed result immediately; reruns are idempotent even after a lost connection.
    console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({mode: apply ? 'APPLIED_VERIFIED_RECEIPTS' : 'DRY_RUN_NO_CHANGES',
    matched: results.filter(r=>r.state==='matched').length,review: results.filter(r=>r.state==='review').length,
    stripeWrites: 0,emailsSent: 0,registrationsCreated: 0}));
} catch (error) {
  // Never print a provider payload or key. Earlier committed results, if any, are safe to resume.
  console.error('Certificate reconciliation stopped. '+(error.diagnostic?JSON.stringify(error.diagnostic):error.message));
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
