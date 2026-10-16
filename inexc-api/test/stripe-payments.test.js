// Mock Stripe + disposable PostgreSQL-compatible DB only. No real payments or emails.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {setupStripePayments,createStripePayments,verifyStripeEvent,amountInFils,stripeClient} from '../stripe-payments.js';
const env={STRIPE_SECRET_KEY:'sk_live_LOCAL_FIXTURE_NOT_A_KEY',STRIPE_WEBHOOK_SECRET:'whsec_LOCAL_FIXTURE',STRIPE_CHECKOUT_ENABLED:'1'};
async function harness(){
 const db=new PGlite(),source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 for(const name of ['courses','registrations']){const start=source.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');await db.exec(source.slice(start,source.indexOf('`);',start)))}
 await db.exec('ALTER TABLE courses ADD COLUMN public_booking_opens_at TIMESTAMPTZ;');
 const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 let tail=Promise.resolve();const pool={query,connect:async()=>{let release;const previous=tail;tail=new Promise(resolve=>release=resolve);await previous;return {query,release}}};
 await setupStripePayments(pool);await setupStripePayments(pool);
 const course=(await query("INSERT INTO courses(name,price,certificate_mode,certificate_name,certificate_price,payment_methods) VALUES('LOCAL COURSE',199.25,'optional','LOCAL CERT',50.50,ARRAY['stripe','bank']) RETURNING id")).rows[0].id;
 const sessions=new Map(),requests=[],notifications=[];let loseResponse=false,readCount=0;
 const client={create:async(params,key)=>{requests.push({params,key});if(!sessions.has(key)){const index=sessions.size+1;sessions.set(key,{id:'cs_live_LOCAL'+index,url:'https://checkout.stripe.com/c/pay/cs_live_LOCAL'+index,livemode:true,mode:'payment',currency:'aed',amount_total:Object.entries(params).filter(([key])=>key.endsWith('[unit_amount]')).reduce((sum,entry)=>sum+Number(entry[1]),0),client_reference_id:params.client_reference_id,metadata:{source:params['metadata[source]'],checkout_id:params['metadata[checkout_id]'],registration_id:params['metadata[registration_id]']},status:'open',payment_status:'unpaid',payment_intent:'pi_LOCAL'+index})}if(loseResponse){loseResponse=false;throw Error('SIMULATED LOST RESPONSE')}return structuredClone(sessions.get(key))},retrieve:async id=>{readCount++;const session=[...sessions.values()].find(s=>s.id===id);if(!session)throw Error('MISSING SESSION');return structuredClone(session)}};
 const service=createStripePayments({pool,env,client,notify:async value=>notifications.push(value)});
 const app=express();service.installWebhook(app);app.use(express.json());service.installRoutes(app);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const input={name:'LOCAL LEARNER',email:'local@example.invalid',phone:'000000',course_id:course,certificate:'yes',request_key:crypto.randomUUID(),amount:1,currency:'usd'};
 const call=async(route,body,headers={})=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/payments/stripe/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}};
 const event=(session,type='checkout.session.completed',id='evt_LOCAL')=>{const body=JSON.stringify({id,type,livemode:true,data:{object:session}}),timestamp=Math.floor(Date.now()/1000),signature=crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.'+body).digest('hex');return {body,signature:'t='+timestamp+',v1='+signature}};
 return {db,pool,query,course,input,service,sessions,requests,notifications,call,event,loseNextResponse(){loseResponse=true},get readCount(){return readCount},async close(){await new Promise(resolve=>server.close(resolve));await db.close()}};
}
test('prices come only from the database; repeated checkout requests reserve one registration and session',async t=>{
 const h=await harness();t.after(()=>h.close());
 const first=await h.service.checkout(h.input),second=await h.service.checkout(h.input);assert.deepEqual(second,first);
 assert.equal(h.sessions.size,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,1);
 const registration=(await h.query('SELECT * FROM registrations')).rows[0];assert.equal(Number(registration.total),249.75);assert.equal(registration.status,'بانتظار الدفع');assert.equal(registration.payment_method,'stripe');
 const params=h.requests[0].params;assert.equal(params['line_items[0][price_data][currency]'],'aed');assert.equal(params['line_items[0][price_data][unit_amount]'],'19925');assert.equal(params['line_items[1][price_data][unit_amount]'],'5050');assert.ok(params.success_url.startsWith('https://www.inexctraining.com/payment-status.html#'));assert.equal(h.notifications.length,0);
 await assert.rejects(h.service.checkout({...h.input,email:'changed@example.invalid'}),e=>e.status===409);
 const session=[...h.sessions.values()][0];session.status='complete';assert.equal((await h.service.status({checkout:first.checkoutId,token:h.input.request_key})).state,'open');assert.equal(h.notifications.length,0);
 session.payment_status='paid';const state=await h.service.status({checkout:first.checkoutId,token:h.input.request_key});assert.equal(state.state,'paid');assert.equal(h.notifications.length,1);assert.equal((await h.query('SELECT status FROM registrations')).rows[0].status,'مؤكد');
 await h.service.status({checkout:first.checkoutId,token:h.input.request_key});assert.equal(h.notifications.length,1);
});
test('a lost Stripe response retries the same idempotency key; mismatched identity and payment amount cannot confirm',async t=>{
 const h=await harness();t.after(()=>h.close());h.loseNextResponse();await assert.rejects(h.service.checkout(h.input),/LOST/);
 const result=await h.service.checkout(h.input);assert.equal(h.sessions.size,1);assert.equal(h.requests[0].key,h.requests[1].key);assert.deepEqual(h.requests[0].params,h.requests[1].params);
 await assert.rejects(h.service.status({checkout:result.checkoutId,token:crypto.randomUUID()}),e=>e.status===404);
 const session=[...h.sessions.values()][0];session.payment_status='paid';
 for(const change of [{amount_total:1},{currency:'usd'},{livemode:false},{client_reference_id:crypto.randomUUID()},{id:'cs_live_OTHER'},{metadata:{...session.metadata,registration_id:crypto.randomUUID()}}])await assert.rejects(h.service.reconcile({...session,...change}),e=>e.status===409);
 assert.equal(h.notifications.length,0);assert.equal((await h.query('SELECT status FROM registrations')).rows[0].status,'بانتظار الدفع');
 await Promise.all([h.service.reconcile(session,'evt_FIRST'),h.service.reconcile(session,'evt_SECOND')]);assert.equal(h.notifications.length,1);
 session.payment_status='unpaid';session.status='expired';await h.service.reconcile(session,'evt_OLD');assert.equal((await h.query('SELECT state FROM stripe_checkouts')).rows[0].state,'paid');
});
test('signed raw webhooks verify Stripe and are idempotent; unsigned, replayed and test events cannot fulfill',async t=>{
 const h=await harness();t.after(()=>h.close());await h.service.checkout(h.input);const session=[...h.sessions.values()][0];session.status='complete';session.payment_status='paid';const event=h.event(session);
 assert.equal((await h.call('webhook',event.body)).status,400);assert.equal((await h.call('webhook',event.body,{'Stripe-Signature':'t=1,v1='+'a'.repeat(64)})).status,400);
 assert.equal((await h.call('webhook',event.body,{'Stripe-Signature':event.signature})).status,200);assert.equal(h.notifications.length,1);const reads=h.readCount;
 assert.equal((await h.call('webhook',event.body,{'Stripe-Signature':event.signature})).status,200);assert.equal(h.readCount,reads);assert.equal(h.notifications.length,1);
 assert.equal((await h.call('webhook',event.body+' ',{'Stripe-Signature':event.signature})).status,400);
});
test('unconfigured/test keys, inactive courses, unopened booking and zero charges fail without registering or charging',async t=>{
 const h=await harness();t.after(()=>h.close());
 for(const settings of [{},{...env,STRIPE_SECRET_KEY:'sk_test_LOCAL'},{...env,STRIPE_CHECKOUT_ENABLED:'0'},{...env,STRIPE_WEBHOOK_SECRET:''}]){
  const service=createStripePayments({pool:h.pool,env:settings,client:{create:()=>{throw Error('MUST NOT CALL')}}});assert.equal(service.enabled(),false);await assert.rejects(service.checkout(h.input),e=>e.status===503);
 }
 await h.query("UPDATE courses SET payment_methods=ARRAY['bank']");await assert.rejects(h.service.checkout(h.input),/غير متاح لهذه الدورة/);await h.query("UPDATE courses SET payment_methods=ARRAY['stripe','bank']");
 await h.query('UPDATE courses SET active=false');await assert.rejects(h.service.checkout(h.input),/غير متاحة/);
 await h.query("UPDATE courses SET active=true,public_booking_opens_at=now()+interval '1 day'");await assert.rejects(h.service.checkout(h.input),/لم يبدأ/);
 await h.query('UPDATE courses SET public_booking_opens_at=NULL,price=0,certificate_price=0');await assert.rejects(h.service.checkout(h.input),/المجاني/);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,0);assert.equal(h.sessions.size,0);
});
test('expired checkout remains unpaid; administrator cancellation is never overwritten by late payment',async t=>{
 const h=await harness();t.after(()=>h.close());const result=await h.service.checkout(h.input),session=[...h.sessions.values()][0];session.status='expired';
 const state=await h.service.status({checkout:result.checkoutId,token:h.input.request_key});assert.equal(state.state,'expired');assert.equal(state.paymentLink,'');assert.equal(h.notifications.length,0);
 await h.query("UPDATE registrations SET status='ملغى'");session.payment_status='paid';session.status='complete';await h.service.reconcile(session);assert.equal((await h.query('SELECT status FROM registrations')).rows[0].status,'ملغى');assert.equal(h.notifications.length,0);
});
test('REST adapter uses fixed Stripe endpoint/version and redacts provider errors; fils conversion is exact',async()=>{
 assert.equal(amountInFils('10.01'),1001);assert.equal(amountInFils('0.50'),50);for(const input of [-1,'0.001','NaN'])assert.throws(()=>amountInFils(input));
 const calls=[],client=stripeClient('LOCAL-SECRET',async(...args)=>{calls.push(args);return {ok:false,json:async()=>({error:{message:'SENSITIVE PROVIDER MESSAGE'}})}});
 await assert.rejects(client.create({mode:'payment'},'LOCAL-KEY'),error=>error.status===503&&!error.message.includes('SENSITIVE'));
 assert.equal(calls[0][0],'https://api.stripe.com/v1/checkout/sessions');assert.equal(calls[0][1].headers['Idempotency-Key'],'LOCAL-KEY');assert.equal(calls[0][1].headers['Stripe-Version'],'2026-08-26.dahlia');
 const raw=Buffer.from('{"ok":true}'),timestamp=Math.floor(Date.now()/1000),signature=crypto.createHmac('sha256','LOCAL').update(timestamp+'.').update(raw).digest('hex');
 assert.deepEqual(verifyStripeEvent(raw,'t='+timestamp+',v1='+signature,'LOCAL'),{ok:true});assert.throws(()=>verifyStripeEvent(raw,'t='+timestamp+',v1='+signature,'LOCAL',Date.now()+301000));
});
