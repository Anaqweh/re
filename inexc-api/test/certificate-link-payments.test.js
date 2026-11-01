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
async function harness(options={}){
 const db=new PGlite();
 await db.exec(`CREATE TABLE courses(id uuid PRIMARY KEY,name text,price numeric DEFAULT 0,certificate_mode text DEFAULT 'optional',certificate_name text DEFAULT 'LOCAL CERTIFICATE',certificate_price numeric DEFAULT 199);CREATE TABLE registrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reference text,name text,email text,course_id uuid,status text,payment_method text DEFAULT 'membership',total numeric DEFAULT 199,certificate text,certificate_fee_amount numeric,certificate_fee_status text,request_kind text DEFAULT 'individual',updated_at timestamptz DEFAULT now());`);
 let failUpdate=false,tail=Promise.resolve();
 const query=async(sql,args)=>{if(failUpdate&&sql.startsWith('UPDATE registrations')){failUpdate=false;throw Error('LOCAL TRANSACTION FAILURE')}return db.query(sql,args)};
 const pool={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}};
 await setupCertificateRequests(pool);await setupCertificateLinkPayments(pool);await setupCertificateLinkPayments(pool);
 await query('INSERT INTO courses(id,name) VALUES($1,$2)',[course,'LOCAL COURSE']);
 const add=async(email='learner@example.invalid')=>{
  const r=(await query("INSERT INTO registrations(reference,name,email,course_id,status,certificate,certificate_fee_amount,certificate_fee_status) VALUES($1,'TRAINEE NAME',$2,$3,'مسجل بالبطاقة','LOCAL CERTIFICATE',199,'awaiting_payment') RETURNING id",['INX-LOCAL123-'+crypto.randomBytes(5).toString('hex').toUpperCase(),email,course])).rows[0];
  const q=(await query("INSERT INTO certificate_requests(registration_id,access_token,amount,arabic_name,english_name) VALUES($1,$2,19900,'اسم المتدرب المعتمد','Approved Trainee Name') RETURNING *",[r.id,crypto.randomUUID()])).rows[0];return q;
 };
 const service=createCertificateLinkPayments({pool,logger:{error(){}},...options});
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

async function withoutCertificate(h,email='trainee@example.invalid'){
 const q=await h.add(email);
 await h.query('DELETE FROM certificate_requests WHERE id=$1',[q.id]);
 await h.query("UPDATE registrations SET certificate='لا',total=0,certificate_fee_amount=0,certificate_fee_status='not_required' WHERE id=$1",[q.registration_id]);
 return (await h.query('SELECT * FROM registrations WHERE id=$1',[q.registration_id])).rows[0];
}
test('reviewed different-email payment creates one paid certificate request on the exact existing free booking without mail',async t=>{
 const h=await harness();t.after(()=>h.close());const r=await withoutCertificate(h);
 const s=session({customer_details:{email:'payer@example.invalid',name:r.name}});
 const reviewedMatch={paymentIntent:s.payment_intent,registrationId:r.id,reference:r.reference,registrationEmail:r.email,payerEmail:'payer@example.invalid',payerName:r.name};
 assert.equal((await h.service.record(s,proof)).reason,'no_registration');
 for(const change of [{registrationId:crypto.randomUUID()},{registrationEmail:'other@example.invalid'},{payerEmail:'another@example.invalid'},{payerName:'Wrong Name'},{reference:'INX-LOCAL123-0000000000'}]){
  if(change.registrationId){assert.equal((await h.service.record(s,{...proof,reviewedMatch:{...reviewedMatch,...change}})).state,'review');continue}
  await assert.rejects(h.service.record(s,{...proof,reviewedMatch:{...reviewedMatch,...change}}));
 }
 const dry=await h.service.record(s,{...proof,reviewedMatch,apply:false});assert.equal(dry.createdRequest,true);assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,0);
 const result=await h.service.record(s,{...proof,reviewedMatch});assert.equal(result.state,'matched');assert.equal(result.matchBasis,'operator_reviewed');assert.equal(result.createdRequest,true);
 const saved=(await h.query('SELECT * FROM certificate_requests')).rows[0];assert.equal(saved.state,'paid');assert.equal(saved.amount,19900);assert.equal(saved.email_status,'skipped');assert.equal(saved.email_attempts,0);assert.equal(saved.arabic_name,'');assert.equal(saved.english_name,'');assert.equal(saved.registration_id,r.id);
 const registration=(await h.query('SELECT * FROM registrations')).rows[0];assert.equal(registration.email,r.email);assert.equal(registration.status,r.status);assert.equal(registration.reference,r.reference);assert.equal(Number(registration.total),199);assert.equal(registration.certificate_fee_status,'paid');
 const receipt=(await h.query('SELECT * FROM certificate_link_payments')).rows[0];assert.equal(receipt.before_state.requestId,null);assert.equal(receipt.before_state.certificate,'لا');assert.equal(receipt.payer_email,'payer@example.invalid');
 assert.equal((await h.service.record(s,{...proof,reviewedMatch})).unchanged,true);assert.equal((await h.service.record(s,proof)).unchanged,true);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,1);
 await assert.rejects(h.service.record(s,{...proof,reviewedMatch:{...reviewedMatch,registrationId:crypto.randomUUID()}}));
});
test('submitted registration number links a different payer email; wrong reference never falls back to email',async t=>{
 const h=await harness();t.after(()=>h.close());const r=await withoutCertificate(h);
 const s=session({customer_details:{email:'payer@example.invalid',name:'PAYER'},custom_fields:[{key:'inexcregistrationreference',type:'text',text:{value:r.reference.toLowerCase()}},{key:'inexcarabicname',text:{value:'أحمد محمد عناقوة'}},{key:'inexcenglishname',text:{value:'Ahmad Mohammad Anakwa'}}]});
 const result=await h.service.record(s,proof);assert.equal(result.state,'matched');assert.equal(result.createdRequest,true);assert.equal(result.matchBasis,'registration_reference');
 const names=(await h.query('SELECT arabic_name,english_name,names_confirmed_at FROM certificate_requests')).rows[0];assert.equal(names.arabic_name,'أحمد محمد عناقوة');assert.equal(names.english_name,'Ahmad Mohammad Anakwa');assert.ok(names.names_confirmed_at);
 const q=await h.add('same@example.invalid');
 const wrong=session({id:'cs_live_WRONGREF',payment_intent:'pi_WRONGREF',customer_details:{email:'same@example.invalid'},custom_fields:[{key:'inexcregistrationreference',text:{value:'INX-LOCAL123-0000000000'}}]});
 assert.equal((await h.service.record(wrong,proof)).reason,'reference_not_found');
 wrong.id='cs_live_INVALIDREF';wrong.payment_intent='pi_INVALIDREF';wrong.custom_fields[0].text.value='not-a-reference';
 assert.equal((await h.service.record(wrong,proof)).reason,'invalid_reference');assert.equal((await h.query('SELECT state FROM certificate_requests WHERE id=$1',[q.id])).rows[0].state,'requested');
 const existing=(await h.query('SELECT reference FROM registrations WHERE id=$1',[q.registration_id])).rows[0];
 await h.query('UPDATE certificate_requests SET names_confirmed_at=now() WHERE id=$1',[q.id]);
 const next=structuredClone(s);next.id='cs_live_NAMES';next.payment_intent='pi_NAMES';next.custom_fields[0].text.value=existing.reference;
 assert.equal((await h.service.record(next,proof)).state,'matched');assert.equal((await h.query('SELECT english_name FROM certificate_requests WHERE id=$1',[q.id])).rows[0].english_name,'Approved Trainee Name');
});
test('late certificate creation refuses changed course/booking values and fully rolls back failed updates',async t=>{
 const h=await harness();t.after(()=>h.close());const r=await withoutCertificate(h);
 const s=session({custom_fields:[{key:'inexcregistrationreference',text:{value:r.reference}}]});
 await h.query('UPDATE courses SET certificate_price=299');assert.equal((await h.service.record(s,proof)).reason,'registration_changed');
 assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,0);
 await h.query('UPDATE courses SET certificate_price=199');await h.query("UPDATE registrations SET status='ملغى'");assert.equal((await h.service.record(s,proof)).reason,'cancelled');
 await h.query("UPDATE registrations SET status='مسجل بالبطاقة'");h.failUpdate();await assert.rejects(h.service.record(s,proof));
 assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,0);assert.equal((await h.query('SELECT certificate FROM registrations')).rows[0].certificate,'لا');
 assert.equal((await h.service.record(s,proof)).state,'matched');
});
test('scheduled recovery checks live charge evidence, reports denied access, resumes its cursor, and deduplicates with webhook delivery',async t=>{
 let deny=true,refunded=false,calls=0;
 const s=session(),fetcher=async(url,options)=>{
  calls++;assert.equal(options.method,undefined);assert.equal(options.headers.Authorization,'Bearer rk_live_LOCAL');
  const u=new URL(url);
  if(u.pathname==='/v1/checkout/sessions')return new Response(JSON.stringify({data:[s],has_more:!u.searchParams.has('starting_after')}));
  if(u.pathname.includes('/checkout/sessions/'))return new Response(JSON.stringify(s));
  if(deny)return new Response(JSON.stringify({error:{message:'Missing rak_payment_intent_read'}}),{status:403,headers:{'request-id':'req_LOCAL'}});
  return new Response(JSON.stringify({id:s.payment_intent,livemode:true,status:'succeeded',currency:'aed',amount_received:19900,latest_charge:{livemode:true,paid:true,refunded,amount_refunded:refunded?19900:0,disputed:false,payment_intent:s.payment_intent,amount:19900,currency:'aed',created:1793523855}}));
 };
 const h=await harness({env:{STRIPE_SECRET_KEY:'rk_live_LOCAL',STRIPE_CHECKOUT_ENABLED:'1'},fetcher});t.after(()=>h.close());await h.add();
 const due=()=>h.query("UPDATE certificate_link_sync SET updated_at=now()-interval '6 minutes'");
 await due();await Promise.all([h.service.sync(),h.service.sync()]);
 let sync=(await h.service.list()).synchronization[0];assert.match(sync.error,/read_payment_intent_and_charge/);assert.match(sync.error,/403/);assert.doesNotMatch(sync.error,/rk_live_LOCAL/);assert.equal((await h.service.list()).summary.total,0);
 const after=calls;await h.service.sync();assert.equal(calls,after);
 deny=false;refunded=true;await assert.rejects(h.service.verifySession(s.id));assert.equal((await h.query('SELECT state FROM certificate_requests')).rows[0].state,'requested');
 refunded=false;await due();await h.service.sync();assert.equal((await h.service.list()).summary.matched,1);sync=(await h.service.list()).synchronization[0];assert.equal(sync.error,'');
 assert.equal((await h.query('SELECT cursor FROM certificate_link_sync')).rows[0].cursor,'');
 await h.service.handleWebhook({id:'evt_AFTERRECOVERY',created:1793523855,livemode:true,type:'checkout.session.completed',data:{object:s}});
 assert.equal((await h.service.list()).summary.matched,1);
});
