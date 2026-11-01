import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupCertificateRequests} from '../certificate-requests.js';
import {setupCertificateLinkPayments} from '../certificate-link-payments.js';
import {adminRegistrations} from '../admin-registration-income.js';

test('income uses live paid certificate evidence, excludes requests/tests/manual statuses, counts each receipt once and never writes', async t => {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE registrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid,total numeric,status text,certificate_fee_status text,created_at timestamptz DEFAULT now());`);
 await setupCertificateRequests(db);await setupCertificateLinkPayments(db);
 const course=crypto.randomUUID();let serial=0;
 async function add({state='paid',status='مسجل بالبطاقة',amount=19900,currency='aed',paidAt=true,intent=true,attempt,link,linkAmount=amount,linkCurrency=currency,linkState='matched',evidence='stripe-api-read'}={}){
  const n=++serial,pi='pi_LOCAL'+n;
  const r=(await db.query("INSERT INTO registrations(course_id,total,status,certificate_fee_status) VALUES($1,9999,$2,'paid') RETURNING id",[course,status])).rows[0];
  const q=(await db.query('INSERT INTO certificate_requests(registration_id,access_token,amount,currency,state,paid_at,payment_intent) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[r.id,crypto.randomUUID(),amount,currency,state,paidAt?new Date():null,intent?pi:''])).rows[0];
  if(attempt)await db.query("INSERT INTO certificate_payment_attempts(request_id,params,amount,currency,state,stripe_session_id,expires_at) VALUES($1,'{}',$2,$3,'paid',$4,now())",[q.id,amount,currency,attempt+n]);
  if(link)await db.query('INSERT INTO certificate_link_payments(stripe_session_id,payment_intent,payment_link,course_id,amount,currency,paid_at,paid_at_source,evidence,state,request_id) VALUES($1,$2,\'plink_LOCAL\',$3,$4,$5,now(),\'charge\',$6,$7,$8)',[link+n,pi,course,linkAmount,linkCurrency,evidence,linkState,q.id]);
  return r.id;
 }
 const expected=new Map();
 // Individual Checkout, two Payment Link evidence paths, and a receipt seen by both.
 for(const options of [{attempt:'cs_live_'},{link:'cs_live_'},{link:'cs_live_',evidence:'evt_LOCAL'},{attempt:'cs_live_',link:'cs_live_'}])expected.set(await add(options),19900);
 // Cancellation is not a refund and must not erase a real receipt.
 expected.set(await add({status:'ملغى',attempt:'cs_live_',amount:12345}),12345);
 for(const options of [
  {state:'requested',status:'مؤكد'},{state:'awaiting_payment',status:'مدفوع'}, {},
  {attempt:'cs_test_'},{link:'cs_test_'},{attempt:'cs_live_',paidAt:false},
  {attempt:'cs_live_',intent:false},{attempt:'cs_live_',currency:'usd'},
  {link:'cs_live_',linkState:'review'},{link:'cs_live_',linkAmount:1},
  {link:'cs_live_',linkCurrency:'usd'},{link:'cs_live_',evidence:'manual'},
  {state:'no_fee',amount:0,attempt:'cs_live_'}
 ])expected.set(await add(options),0);
 const bare=(await db.query("INSERT INTO registrations(course_id,total,status) VALUES($1,4000,'مؤكد') RETURNING id",[course])).rows[0];expected.set(bare.id,0);
 const snapshots=async()=>JSON.stringify(await Promise.all(['registrations','certificate_requests','certificate_payment_attempts','certificate_link_payments'].map(table=>db.query('SELECT * FROM '+table))));
 const before=await snapshots(),rows=await adminRegistrations(db);
 assert.equal(rows.length,expected.size);
 for(const row of rows)assert.equal(row.verified_certificate_amount_fils,expected.get(row.id),row.id);
 assert.equal(rows.reduce((n,r)=>n+r.verified_certificate_amount_fils,0),91945);
 assert.equal(await snapshots(),before);
});
