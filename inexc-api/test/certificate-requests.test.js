// Disposable SQL database, mocked Stripe and recording mail only. No production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {setupLearnerService,createCardRegistration,cardQuote} from '../learner-service.js';
import {createCertificateRequests,certificateNames,certificateEmail} from '../certificate-requests.js';
import {setupStripePayments,createStripePayments} from '../stripe-payments.js';
const env={STRIPE_SECRET_KEY:'sk_live_LOCAL_FIXTURE',STRIPE_WEBHOOK_SECRET:'whsec_LOCAL_FIXTURE',STRIPE_CHECKOUT_ENABLED:'1'};
async function harness(options={}){
 const db=new PGlite(),source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 for(const name of ['courses','registrations','membership_plans','membership_orders','membership_cards','membership_redemptions']){const start=source.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');await db.exec(source.slice(start,source.indexOf('`);',start)))}
 await db.exec("ALTER TABLE registrations ADD COLUMN membership_card_id UUID,ADD COLUMN membership_redemption_id UUID,ADD COLUMN request_kind TEXT DEFAULT 'individual'; ALTER TABLE courses ADD COLUMN membership_plan_ids UUID[],ADD COLUMN membership_enabled BOOLEAN DEFAULT TRUE,ADD COLUMN membership_kind TEXT DEFAULT 'course',ADD COLUMN member_booking_opens_at TIMESTAMPTZ;");
 let failDebit=false;
 const query=async(sql,args)=>{if(failDebit&&sql.startsWith('UPDATE membership_cards SET units_remaining')){failDebit=false;throw Error('LOCAL ROLLBACK')}const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 let tail=Promise.resolve();const pool={query,connect:async()=>{let release;const previous=tail;tail=new Promise(r=>release=r);await previous;return {query,release}}};
 await setupLearnerService(pool);await setupLearnerService(pool);await setupStripePayments(pool);
 const plan=(await query("INSERT INTO membership_plans(slug,name,price_usd,max_cards,valid_months,booking_units,course_unit_cost,diploma_unit_cost,certificate_discount) VALUES('local','LOCAL PLAN',10,100,12,20,2,3,10) RETURNING id")).rows[0].id;
 const card=(await query("INSERT INTO membership_cards(card_number,access_token,plan_id,holder_name,holder_email,holder_phone,units_total,units_remaining,expires_at) VALUES('INX-LOCAL-CERT',$1,$2,'LOCAL LEARNER','learner@example.invalid','000000',20,20,now()+interval '1 year') RETURNING id",['a'.repeat(48),plan])).rows[0].id;
 const course=(await query("INSERT INTO courses(name,price,certificate_mode,certificate_name,certificate_price,payment_methods) VALUES('LOCAL COURSE',0,'optional','LOCAL CERTIFICATE',100,ARRAY['stripe']) RETURNING id")).rows[0].id;
 const input={courseId:course,name:'LOCAL LEARNER',email:'learner@example.invalid',phone:'000000',code:'INX-LOCAL-CERT',certificateRequested:true};
 const sessions=new Map(),requests=[],emails=[],logs=[];let lose=false,mailFailure=false,allowed=true,clock=Date.now();
 const client={create:async(params,key)=>{requests.push({params,key});if(!sessions.has(key)){const i=sessions.size+1;sessions.set(key,{id:'cs_live_LOCALCERT'+i,url:'https://checkout.stripe.com/c/pay/cs_live_LOCALCERT'+i,livemode:true,mode:'payment',currency:'aed',amount_total:Number(params['line_items[0][price_data][unit_amount]']),client_reference_id:params.client_reference_id,metadata:Object.fromEntries(Object.entries(params).filter(([k])=>k.startsWith('metadata[')).map(([k,v])=>[k.slice(9,-1),v])),status:'open',payment_status:'unpaid',payment_intent:'pi_LOCALCERT'+i})}if(lose){lose=false;throw Error('LOCAL LOST RESPONSE')}return structuredClone(sessions.get(key))},retrieve:async id=>structuredClone([...sessions.values()].find(s=>s.id===id))};
 const service=createCertificateRequests({pool,env,client,now:()=>clock,mailEnabled:options.mailEnabled??true,emailShell:({content})=>'<html dir="rtl">'+content+'</html>',sendEmail:async message=>{emails.push(message);if(mailFailure){mailFailure=false;throw Object.assign(Error('LOCAL MAIL FAILED'),{status:503})}return {id:'email_local_'+emails.length}},mailAllowed:async()=>allowed,logger:{error:(...args)=>logs.push(args)}});
 const payments=createStripePayments({pool,env,client,handleOtherCheckout:service.handleWebhook});
 const app=express();payments.installWebhook(app);app.use(express.json());service.install(app,(req,res,next)=>req.headers.authorization==='Bearer LOCAL_ADMIN'?next():res.sendStatus(401));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,{body,token,headers={}}={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers}};
 const request=async()=>{const registration=await createCardRegistration(pool,input),q=(await query('SELECT * FROM certificate_requests WHERE registration_id=$1',[registration.registrationId])).rows[0];return {registration,q,credentials:{request:q.id,token:q.access_token},names:{arabicName:'أحمد محمد عناقوة',englishName:'Ahmad Mohammad Anakwa'}}};
 const sign=(session,type='checkout.session.completed')=>{const body=JSON.stringify({id:'evt_LOCALCERT',type,livemode:true,data:{object:session}}),at=Math.floor(Date.now()/1000);return {body,headers:{'Stripe-Signature':'t='+at+',v1='+crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(at+'.'+body).digest('hex')}}};
 return {query,pool,service,course,card,plan,input,request,sessions,requests,emails,logs,call,sign,loseNext(){lose=true},failMail(){mailFailure=true},suppress(){allowed=false},advance(ms){clock+=ms},failDebit(){failDebit=true},async close(){await new Promise(r=>server.close(r));await db.close()}};
}
test('free-course card registration defers optional fees, with atomic outbox and no duplicate debit',async t=>{
 const h=await harness();t.after(()=>h.close());const {registration,q}=await h.request();
 assert.equal(registration.certificateFee,90);assert.equal(registration.certificateDeferred,true);assert.equal(registration.remaining,18);assert.equal(q.amount,9000);assert.equal(q.state,'requested');assert.equal(q.email_status,'pending');
 const r=(await h.query('SELECT status,receipt_path,certificate_fee_status FROM registrations')).rows[0];assert.equal(r.status,'مسجل بالبطاقة');assert.equal(r.receipt_path,'');assert.equal(r.certificate_fee_status,'awaiting_payment');
 const replay=await createCardRegistration(h.pool,h.input);assert.equal(replay.alreadyRegistered,true);assert.equal(replay.remaining,18);assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,1);assert.equal(h.requests.length,0);assert.equal(h.emails.length,0);
});
test('no certificate creates no request; failing debit rolls back request and registration; paid-course rules remain',async t=>{
 const h=await harness();t.after(()=>h.close());h.failDebit();await assert.rejects(createCardRegistration(h.pool,h.input),/ROLLBACK/);assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,0);
 const result=await createCardRegistration(h.pool,{...h.input,certificateRequested:false});assert.equal(result.certificateFee,0);assert.equal(result.certificateRequestId,null);assert.equal((await h.query('SELECT count(*)::int AS n FROM certificate_requests')).rows[0].n,0);
 const card={status:'active',expires_at:'2099-01-01',units_remaining:10,course_unit_cost:2,diploma_unit_cost:3,certificate_discount:0};
 assert.throws(()=>cardQuote(card,{active:true,membership_enabled:true,price:50,certificate_mode:'optional',certificate_price:100,payment_methods:['stripe']},true),/بنكي/);
});
test('private checkout requires both names and server price; lost responses reuse one session and secure webhooks settle once',async t=>{
 const h=await harness();t.after(()=>h.close());const {q,credentials,names}=await h.request();
 assert.equal((await h.call('/api/admin/certificate-requests')).status,401);
 assert.equal((await h.call('/api/certificate-requests/status',{body:{...credentials,token:'b'.repeat(64)}})).status,404);
 for(const invalid of [{arabicName:'أحمد',englishName:'Ahmad Anakwa'},{arabicName:'Ahmad Mohammad Anakwa',englishName:'Ahmad Anakwa'},{arabicName:'أحمد محمد عناقوة',englishName:'أحمد محمد'}])await assert.rejects(h.service.checkout({...credentials,...invalid}));
 assert.equal(h.requests.length,0);h.loseNext();await assert.rejects(h.service.checkout({...credentials,...names,amount:1}),/LOST/);
 const result=await h.service.checkout({...credentials,...names,amount:1});assert.match(result.paymentLink,/checkout.stripe.com/);assert.equal(h.sessions.size,1);assert.deepEqual(h.requests[0],h.requests[1]);assert.equal(h.requests[0].params['line_items[0][price_data][unit_amount]'],'9000');assert.equal(h.requests[0].params['custom_text[submit][message]'],'أحمد محمد عناقوة — Ahmad Mohammad Anakwa');
 assert.equal((await h.service.status(credentials)).state,'awaiting_payment');
 const session=[...h.sessions.values()][0];session.status='complete';session.payment_status='paid';
 for(const change of [{amount_total:1},{currency:'usd'},{livemode:false},{client_reference_id:crypto.randomUUID()},{metadata:{...session.metadata,registration_id:crypto.randomUUID()}}])await assert.rejects(h.service.reconcile({...session,...change}),e=>e.status===409);
 assert.equal((await h.call('/api/payments/stripe/webhook',{body:h.sign(session).body})).status,400);
 assert.equal((await h.call('/api/payments/stripe/webhook',h.sign(session))).status,200);assert.equal((await h.call('/api/payments/stripe/webhook',h.sign(session))).status,200);
 assert.equal((await h.service.status(credentials)).state,'paid');assert.equal((await h.query('SELECT certificate_fee_status FROM registrations')).rows[0].certificate_fee_status,'paid');assert.equal((await h.query('SELECT units_remaining FROM membership_cards')).rows[0].units_remaining,18);
 assert.equal((await h.service.checkout({...credentials,...names})).state,'paid');assert.equal(h.sessions.size,1);
 const listing=await h.service.list({course:h.course,state:'paid'});assert.equal(listing.summary.paid,1);assert.equal(listing.items[0].arabic_name,names.arabicName);assert.equal(listing.items[0].english_name,names.englishName);assert.ok(!JSON.stringify(listing).includes(q.access_token));
});
test('expired sessions can be renewed; pending asynchronous payments cannot create another charge; cancellation is retained',async t=>{
 const h=await harness();t.after(()=>h.close());const {credentials,names}=await h.request();await h.service.checkout({...credentials,...names});
 const first=[...h.sessions.values()][0];first.status='expired';await h.service.checkout({...credentials,...names});assert.equal(h.sessions.size,2);
 const second=[...h.sessions.values()][1];second.status='complete';assert.equal((await h.service.checkout({...credentials,...names})).state,'processing');assert.equal(h.sessions.size,2);
 await h.query("UPDATE registrations SET status='ملغى'");await assert.rejects(h.service.checkout({...credentials,...names}),e=>e.status===409);
 second.payment_status='paid';await h.service.reconcile(second);assert.equal((await h.query('SELECT status FROM registrations')).rows[0].status,'ملغى');assert.equal((await h.query('SELECT state FROM certificate_requests')).rows[0].state,'paid');
});
test('asynchronous failure permits a new attempt without regressing a later successful payment',async t=>{
 const h=await harness();t.after(()=>h.close());const {credentials,names}=await h.request();await h.service.checkout({...credentials,...names});const first=[...h.sessions.values()][0];first.status='complete';
 assert.equal((await h.call('/api/payments/stripe/webhook',h.sign(first,'checkout.session.async_payment_failed'))).status,200);
 await h.service.checkout({...credentials,...names});assert.equal(h.sessions.size,2);const second=[...h.sessions.values()][1];second.status='complete';second.payment_status='paid';await h.service.reconcile(second);await h.service.reconcile(first,true);assert.equal((await h.service.status(credentials)).state,'paid');
});
test('zero-price certificate collects names without Stripe; free course works when electronic payment is disabled',async t=>{
 const h=await harness();t.after(()=>h.close());await h.query('UPDATE courses SET certificate_price=0,payment_methods=ARRAY[]::text[]');const {credentials,names}=await h.request();
 assert.equal((await h.service.checkout({...credentials,...names})).state,'no_fee');assert.equal(h.requests.length,0);assert.equal((await h.service.list()).summary.no_fee,1);
});
test('persisted mail queue waits three minutes, retries safely, respects suppression and sends only requested certificates',async t=>{
 const h=await harness();t.after(()=>h.close());const {q}=await h.request();await h.service.processEmailQueue();assert.equal(h.emails.length,0);
 await h.query("UPDATE certificate_requests SET email_due_at=now()-interval '1 minute'");h.failMail();await h.service.processEmailQueue();assert.equal((await h.query('SELECT email_status FROM certificate_requests')).rows[0].email_status,'pending');
 await h.query("UPDATE certificate_requests SET email_due_at=now()-interval '1 minute'");await h.service.processEmailQueue();assert.equal(h.emails.length,2);assert.equal(h.emails[0].idempotencyKey,h.emails[1].idempotencyKey);assert.match(h.emails[1].html,/text-align:center/);assert.match(h.emails[1].text,/الاسم الثلاثي/);assert.equal(h.emails[1].marketing,false);assert.ok(h.emails[1].html.includes('#request='+q.id+'&token='+q.access_token));
 await h.service.processEmailQueue();assert.equal(h.emails.length,2);assert.equal((await h.query('SELECT email_status FROM certificate_requests')).rows[0].email_status,'sent');
 const mail=certificateEmail({id:q.id,access_token:q.access_token,amount:0,name:'<script>bad</script>',course_name:'SAFE',certificate:'CERT',reference:'LOCAL',email:'local@example.invalid'},({content})=>content);assert.ok(!mail.html.includes('<script>'));assert.match(mail.text,/دون رسوم/);
});
test('suppressed/cancelled recipients and disabled mail do not send; course and search filters stay scoped',async t=>{
 const h=await harness();t.after(()=>h.close());await h.request();await h.query("UPDATE certificate_requests SET email_due_at=now()-interval '1 minute'");h.suppress();await h.service.processEmailQueue();assert.equal(h.emails.length,0);assert.equal((await h.query('SELECT email_status FROM certificate_requests')).rows[0].email_status,'skipped');
 assert.equal((await h.service.list({search:'not found'})).summary.total,0);assert.equal((await h.service.list({course:crypto.randomUUID()})).summary.total,0);assert.equal((await h.service.list({search:'learner@'})).summary.total,1);
 const offline=await harness({mailEnabled:false});t.after(()=>offline.close());await offline.request();await offline.query("UPDATE certificate_requests SET email_due_at=now()-interval '1 minute'");await offline.service.processEmailQueue();assert.equal(offline.emails.length,0);assert.equal((await offline.query('SELECT email_status FROM certificate_requests')).rows[0].email_status,'pending');
});
