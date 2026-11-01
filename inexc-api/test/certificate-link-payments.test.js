// Disposable PostgreSQL-compatible database and signed local fixtures; no live Stripe calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {setupCertificateRequests} from '../certificate-requests.js';
import {createStripePayments} from '../stripe-payments.js';
import {CERTIFICATE_LINKS,setupCertificateLinkPayments,createCertificateLinkPayments} from '../certificate-link-payments.js';
const link=Object.keys(CERTIFICATE_LINKS)[0],course=CERTIFICATE_LINKS[link].courseId;
const proof={evidence:'stripe-api-read',paidAt:'2026-11-01T09:00:00.000Z',paidAtSource:'charge'};
const session=(overrides={})=>({id:'cs_live_LOCAL1',payment_intent:'pi_LOCAL1',payment_link:link,livemode:true,mode:'payment',status:'complete',payment_status:'paid',amount_total:19900,currency:'aed',metadata:{item:'certificate',course:'ai-leadership-licence'},customer_details:{name:'DIFFERENT PAYER NAME',email:'learner@example.invalid'},...overrides});
async function harness(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE courses(id uuid PRIMARY KEY,name text);CREATE TABLE registrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reference text,name text,email text,course_id uuid,status text,certificate text,certificate_fee_amount numeric,certificate_fee_status text,request_kind text DEFAULT 'individual',updated_at timestamptz DEFAULT now());`);
 let failUpdate=false,tail=Promise.resolve();
 const query=async(sql,args)=>{if(failUpdate&&sql.startsWith('UPDATE registrations')){failUpdate=false;throw Error('LOCAL TRANSACTION FAILURE')}return db.query(sql,args)};
 const pool={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}};
 await setupCertificateRequests(pool);await setupCertificateLinkPayments(pool);await setupCertificateLinkPayments(pool);
 await query('INSERT INTO courses VALUES($1,$2)',[course,'LOCAL COURSE']);
 const add=async(email='learner@example.invalid')=>{
  const r=(await query("INSERT INTO registrations(reference,name,email,course_id,status,certificate,certificate_fee_amount,certificate_fee_status) VALUES($1,'TRAINEE NAME',$2,$3,'مسجل بالبطاقة','LOCAL CERTIFICATE',199,'awaiting_payment') RETURNING id",[crypto.randomUUID(),email,course])).rows[0];
  const q=(await query("INSERT INTO certificate_requests(registration_id,access_token,amount,arabic_name,english_name) VALUES($1,$2,19900,'اسم المتدرب المعتمد','Approved Trainee Name') RETURNING *",[r.id,crypto.randomUUID()])).rows[0];return q;
 };
 const service=createCertificateLinkPayments({pool,logger:{error(){}}});
 return {query,pool,service,add,failUpdate:()=>{failUpdate=true},close:()=>db.close()};
}
test('unique same-course email and exact fee reconcile atomically; retries/concurrent events never reassign or duplicate',async t=>{
 const h=await harness();t.after(()=>h.close());const q=await h.add();
 const first=await h.service.record(session(),{...proof,apply:false});assert.equal(first.state,'matched');assert.equal(first.dryRun,true);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_link_payments')).rows[0].n,0);
 assert.equal((await h.query('SELECT state FROM certificate_requests')).rows[0].state,'requested');
 const results=await Promise.all([h.service.record(session(),proof),h.service.record(session(),proof)]);
 assert.equal(results[0].state,'matched');assert.equal(results[1].unchanged,true);
 const saved=(await h.query('SELECT * FROM certificate_requests')).rows[0];
 assert.equal(saved.id,q.id);assert.equal(saved.state,'paid');assert.equal(saved.payment_intent,'pi_LOCAL1');assert.equal(saved.english_name,'Approved Trainee Name');assert.equal(saved.arabic_name,'اسم المتدرب المعتمد');assert.equal(saved.email_status,'pending');assert.equal(saved.email_attempts,0);
 assert.equal(new Date(saved.paid_at).toISOString(),proof.paidAt);
 const r=(await h.query('SELECT * FROM registrations')).rows[0];assert.equal(r.name,'TRAINEE NAME');assert.equal(r.status,'مسجل بالبطاقة');assert.equal(r.certificate_fee_status,'paid');
 assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_link_payments')).rows[0].n,1);
 assert.equal((await h.query('SELECT before_state FROM certificate_link_payments')).rows[0].before_state.requestState,'requested');
 const other=await h.service.record(session({id:'cs_live_LOCAL2',payment_intent:'pi_LOCAL2'}),proof);assert.equal(other.reason,'already_paid');
 const listing=await h.service.list();assert.equal(listing.summary.matched,1);assert.equal(listing.summary.review,1);assert.ok(!JSON.stringify(listing).includes('access_token'));assert.ok(!JSON.stringify(listing).includes('before_state'));
 await assert.rejects(h.service.record(session({id:'cs_live_SAMEINTENT'}),proof));
 await assert.rejects(h.service.record(session({amount_total:20000}),proof));
 assert.equal((await h.query('SELECT payment_intent FROM certificate_requests')).rows[0].payment_intent,'pi_LOCAL1');
});
test('missing, ambiguous, cancelled and mismatched requests stay visible without altering registrations',async t=>{
 const h=await harness();t.after(()=>h.close());let n=0;
 const pay=async(email,overrides={})=>{n++;return h.service.record(session({id:'cs_live_CASE'+n,payment_intent:'pi_CASE'+n,customer_details:{email,name:'PAYER'},...overrides}),proof)};
 assert.equal((await pay('unknown@example.invalid')).reason,'no_registration');
 assert.equal((await pay('')).reason,'missing_email');
 await h.add('duplicate@example.invalid');await h.add('DUPLICATE@example.invalid');assert.equal((await pay('duplicate@example.invalid')).reason,'ambiguous_registration');
 const cancelled=await h.add('cancelled@example.invalid');await h.query("UPDATE registrations SET status='ملغى' WHERE id=$1",[cancelled.registration_id]);assert.equal((await pay('cancelled@example.invalid')).reason,'cancelled');
 const discount=await h.add('discount@example.invalid');await h.query('UPDATE certificate_requests SET amount=15000 WHERE id=$1',[discount.id]);assert.equal((await pay('discount@example.invalid')).reason,'amount_mismatch');
 const noRequest=await h.add('norequest@example.invalid');await h.query('DELETE FROM certificate_requests WHERE id=$1',[noRequest.id]);assert.equal((await pay('norequest@example.invalid')).reason,'no_request');
 await h.add('valid@example.invalid');assert.equal((await pay('valid@example.invalid',{amount_total:100})).reason,'amount_mismatch');
 assert.equal((await pay('valid@example.invalid',{currency:'usd'})).reason,'amount_mismatch');
 assert.equal((await pay('valid@example.invalid',{metadata:{item:'course'}})).reason,'metadata_mismatch');
 const active=await h.add('inflight@example.invalid');await h.query("INSERT INTO certificate_payment_attempts(request_id,params,amount,state,expires_at) VALUES($1,'{}',19900,'processing',now())",[active.id]);assert.equal((await pay('inflight@example.invalid')).reason,'in_flight');
 assert.equal((await h.query("SELECT count(*)::int AS n FROM registrations WHERE certificate_fee_status='paid'")).rows[0].n,0);
 assert.equal((await h.service.list({state:'review'})).summary.total,n);
 assert.equal((await h.service.list({course:crypto.randomUUID()})).summary.total,0);
 assert.equal((await h.service.list({offset:500})).items.length,0);
});
test('ignores unrelated/unpaid sessions and rejects fake/test evidence; failure rolls back receipt and status together',async t=>{
 const h=await harness();t.after(()=>h.close());await h.add();
 for(const overrides of [{payment_status:'unpaid'},{payment_link:'plink_UNRELATED'}])assert.equal((await h.service.record(session(overrides),proof)).state,'ignored');
 for(const overrides of [{livemode:false},{id:'cs_test_LOCAL'},{payment_intent:null},{amount_total:1.5},{status:'open'}])await assert.rejects(h.service.record(session(overrides),proof));
 await assert.rejects(h.service.record(session(),{}));
 h.failUpdate();await assert.rejects(h.service.record(session(),proof));
 assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_link_payments')).rows[0].n,0);assert.equal((await h.query('SELECT state FROM certificate_requests')).rows[0].state,'requested');
 assert.equal((await h.service.record(session(),proof)).state,'matched');
});
test('live signature-verified webhook handles completed/async paid events; unsigned requests and unauthenticated ledger reads fail',async t=>{
 const h=await harness();t.after(()=>h.close());await h.add();
 const env={STRIPE_SECRET_KEY:'rk_live_LOCAL',STRIPE_WEBHOOK_SECRET:'whsec_LOCAL',STRIPE_CHECKOUT_ENABLED:'1'};
 const app=express();createStripePayments({pool:h.pool,env,handleOtherCheckout:h.service.handleWebhook}).installWebhook(app);
 h.service.install(app,(req,res,next)=>req.headers.authorization==='Bearer LOCAL'?next():res.sendStatus(401));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const event={id:'evt_LOCAL',created:Math.floor(Date.now()/1000),livemode:true,type:'checkout.session.completed',data:{object:session({payment_status:'unpaid'})}};
 async function send(signed=true){const body=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),sig=crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.'+body).digest('hex');return fetch(base+'/api/payments/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json',...(signed?{'Stripe-Signature':`t=${timestamp},v1=${sig}`}:{})},body})}
 assert.equal((await send(false)).status,400);assert.equal((await send()).status,200);assert.equal((await h.service.list()).summary.total,0);
 event.type='checkout.session.async_payment_succeeded';event.data.object.payment_status='paid';assert.equal((await send()).status,200);assert.equal((await send()).status,200);
 event.type='checkout.session.expired';event.data.object.payment_status='unpaid';assert.equal((await send()).status,200);
 assert.equal((await h.service.list()).summary.matched,1);
 assert.equal((await fetch(base+'/api/admin/certificate-link-payments')).status,401);
 const response=await fetch(base+'/api/admin/certificate-link-payments',{headers:{Authorization:'Bearer LOCAL'}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).summary.total,1);
});
