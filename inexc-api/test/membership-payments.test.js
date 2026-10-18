// Isolated database and mocked Stripe only: no real customers, payments or emails.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {setupMembershipPayments,createMembershipPayments} from '../membership-payments.js';
import {setupStripePayments,createStripePayments} from '../stripe-payments.js';
const env={STRIPE_SECRET_KEY:'sk_live_LOCAL_FIXTURE_NOT_A_KEY',STRIPE_WEBHOOK_SECRET:'whsec_LOCAL_FIXTURE',STRIPE_CHECKOUT_ENABLED:'1'};
async function harness(){
 const db=new PGlite(),source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 for(const name of ['courses','registrations','membership_plans','membership_orders','membership_cards']){const start=source.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');await db.exec(source.slice(start,source.indexOf('`);',start)))}
 await db.exec(`ALTER TABLE membership_plans ADD COLUMN payment_methods TEXT[] NOT NULL DEFAULT ARRAY['bank'];ALTER TABLE membership_orders ADD COLUMN verified_reference TEXT NOT NULL DEFAULT '';ALTER TABLE membership_orders ADD COLUMN verified_currency TEXT NOT NULL DEFAULT '';ALTER TABLE membership_orders ADD COLUMN verified_amount NUMERIC(10,2);ALTER TABLE membership_orders ADD COLUMN verified_at TIMESTAMPTZ;CREATE UNIQUE INDEX membership_orders_verified_payment_unique ON membership_orders(lower(verified_reference),verified_currency) WHERE verified_reference<>'';`);
 const rawQuery=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 // PGlite has one connection; serialize connections, including single-query pool users.
 let tail=Promise.resolve();const connect=async()=>{let release;const previous=tail;tail=new Promise(resolve=>release=resolve);await previous;return {query:rawQuery,release}};
 const query=async(...args)=>{const conn=await connect();try{return await conn.query(...args)}finally{conn.release()}};
 const pool={query,connect};await setupStripePayments(pool);
 await query("INSERT INTO courses(name,price,payment_methods,bank_name,bank_account,bank_iban) VALUES('LOCAL COURSE',123,ARRAY['bank'],'اسم البنك: LOCAL BANK | صاحب الحساب: LOCAL HOLDER','LOCAL-ACCOUNT','LOCAL-IBAN')");
 const before=(await query('SELECT * FROM courses')).rows;
 const plan=(await query("INSERT INTO membership_plans(slug,name,price_usd,max_cards,valid_months,booking_units,payment_link,payment_methods) VALUES('launch','LOCAL PLAN',39.25,20,4,2,'https://example.invalid/legacy',ARRAY['link']) RETURNING id")).rows[0].id;
 await setupMembershipPayments(pool);await setupMembershipPayments(pool);
 const sessions=new Map(),requests=[],notifications=[];let loseResponse=false,deny=false;
 const client={create:async(params,key)=>{requests.push({params,key});if(deny){deny=false;throw Object.assign(Error('PROVIDER DENIED'),{stripeDiagnostic:{httpStatus:403}})}if(!sessions.has(key)){const index=sessions.size+1;sessions.set(key,{id:'cs_live_LOCAL'+index,url:'https://checkout.stripe.com/c/pay/cs_live_LOCAL'+index,livemode:true,mode:'payment',currency:'usd',amount_total:Number(params['line_items[0][price_data][unit_amount]']),client_reference_id:params.client_reference_id,metadata:{source:params['metadata[source]'],checkout_id:params['metadata[checkout_id]'],order_id:params['metadata[order_id]']},status:'open',payment_status:'unpaid',payment_intent:'pi_LOCAL'+index})}if(loseResponse){loseResponse=false;throw Error('LOST RESPONSE')}return structuredClone(sessions.get(key))},retrieve:async id=>{const session=[...sessions.values()].find(s=>s.id===id);if(!session)throw Error('MISSING SESSION');return structuredClone(session)}};
 const service=createMembershipPayments({pool,env,client,notify:async card=>notifications.push(card)}),courseService=createStripePayments({pool,env,client,handleOtherCheckout:service.handleWebhook});
 const app=express();courseService.installWebhook(app);app.use(express.json());service.install(app,(_q,_r,next)=>next());
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const call=async(path,body,headers={})=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});return {status:response.status,data:await response.json()}};
 const event=(session,type='checkout.session.completed',overrides={})=>{const body=JSON.stringify({id:'evt_LOCAL',type,livemode:true,data:{object:session},...overrides}),timestamp=Math.floor(Date.now()/1000),signature=crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.'+body).digest('hex');return {body,signature:'t='+timestamp+',v1='+signature}};
 const input={plan_id:plan,name:'LOCAL BUYER',email:'local@example.invalid',phone:'000000',request_key:crypto.randomUUID(),amount:1,currency:'aed'};
 return {pool,query,plan,before,input,service,sessions,requests,notifications,call,event,loseNextResponse(){loseResponse=true},denyNext(){deny=true},async close(){await new Promise(resolve=>server.close(resolve));await db.close()}};
}
test('owner email may repeat free package orders, while retries and other addresses remain unique',async t=>{
 const h=await harness();t.after(()=>h.close());
 await h.query('ALTER TABLE membership_cards ADD COLUMN deleted_at TIMESTAMPTZ');
 await h.query('UPDATE membership_plans SET price_usd=0 WHERE id=$1',[h.plan]);
 const input={...h.input,email:' AHMADANAKWA@gmail.com '};
 const first=await h.call('/memberships/free',input);assert.equal(first.status,200);assert.equal(first.data.ok,true);
 const retry=await h.call('/memberships/free',input);assert.equal(retry.data.reference,first.data.reference);assert.equal(retry.data.ok,true);
 const second=await h.call('/memberships/free',{...input,request_key:crypto.randomUUID()});assert.equal(second.data.ok,true);assert.notEqual(second.data.reference,first.data.reference);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_cards')).rows[0].n,2);assert.equal(h.notifications.length,2);
 assert.equal((await h.call('/memberships/free',{...input,name:'CHANGED'})).status,409);
 const normal=await h.call('/memberships/free',{...h.input,request_key:crypto.randomUUID()});assert.equal(normal.data.ok,true);
 const duplicate=await h.call('/memberships/free',{...h.input,request_key:crypto.randomUUID()});assert.equal(duplicate.data.alreadyRegistered,true);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_cards')).rows[0].n,3);assert.equal(h.notifications.length,3);
 assert.equal(h.requests.length,0);
});
test('membership-only migration preserves every course field, USD prices and later admin method choices',async t=>{
 const h=await harness();t.after(()=>h.close());
 assert.deepEqual((await h.query('SELECT * FROM courses')).rows,h.before);
 const plan=(await h.query('SELECT * FROM membership_plans')).rows[0];assert.deepEqual(plan.payment_methods,['stripe','bank']);assert.equal(Number(plan.price_usd),39.25);assert.equal(plan.payment_link,'https://example.invalid/legacy');
 assert.deepEqual((await h.service.options()).bank,{title:'LOCAL BANK',name:'LOCAL HOLDER',account:'LOCAL-ACCOUNT',iban:'LOCAL-IBAN'});
 await h.query("UPDATE membership_plans SET payment_methods=ARRAY['bank']");await setupMembershipPayments(h.pool);assert.deepEqual((await h.query('SELECT payment_methods FROM membership_plans')).rows[0].payment_methods,['bank']);await assert.rejects(h.service.checkout(h.input),/غير متاح/);
 await h.query("UPDATE membership_plans SET payment_methods=ARRAY[]::text[]");await setupMembershipPayments(h.pool);await assert.rejects(h.service.offlineOrder({...h.input,payment_method:'bank'},'/uploads/local.pdf'),/غير متاحة/);
 const off=createMembershipPayments({pool:h.pool,env:{...env,STRIPE_SECRET_KEY:'sk_test_LOCAL'},client:{create(){throw Error('MUST NOT CALL')}}});assert.equal((await off.options()).electronicEnabled,false);await assert.rejects(off.checkout(h.input),e=>e.status===503);
 assert.deepEqual((await h.query('SELECT * FROM courses')).rows,h.before);
});
test('checkout freezes server price and benefits; retry and concurrent duplicate requests create one order/session',async t=>{
 const h=await harness();t.after(()=>h.close());h.loseNextResponse();await assert.rejects(h.service.checkout(h.input),/LOST RESPONSE/);
 const results=await Promise.all([h.service.checkout(h.input),h.service.checkout(h.input)]);assert.deepEqual(results[0],results[1]);assert.equal(h.sessions.size,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_orders')).rows[0].n,1);
 const params=h.requests[0].params;assert.equal(params['line_items[0][price_data][currency]'],'usd');assert.equal(params['line_items[0][price_data][unit_amount]'],'3925');assert.ok(!Object.keys(params).some(k=>k.includes('payment_method_types')));assert.match(params.integration_identifier,/^inexc-membership-[a-z]{8}$/);assert.deepEqual(h.requests[1].params,params);assert.equal(h.requests[1].key,h.requests[0].key);
 await assert.rejects(h.service.checkout({...h.input,email:'other@example.invalid'}),e=>e.status===409);
 assert.equal(h.notifications.length,0);await h.query('UPDATE membership_plans SET price_usd=99,booking_units=8,valid_months=12');
 const session=[...h.sessions.values()][0];session.payment_status='paid';session.status='complete';await h.service.reconcile(session);
 const order=(await h.query('SELECT * FROM membership_orders')).rows[0],card=(await h.query('SELECT * FROM membership_cards')).rows[0];assert.equal(Number(order.total),39.25);assert.equal(order.verified_currency,'USD');assert.equal(card.units_total,2);assert.equal(h.notifications.length,1);
 await h.service.reconcile(session);assert.equal(h.notifications.length,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_cards')).rows[0].n,1);
 await assert.rejects(h.service.status({checkout:results[0].checkoutId,token:crypto.randomUUID()}),e=>e.status===404);
 const state=await h.service.status({checkout:results[0].checkoutId,token:h.input.request_key});assert.equal(state.state,'paid');assert.equal(state.amount,39.25);assert.equal(state.cardNumber,card.card_number);assert.ok(state.cardUrl.endsWith(card.access_token));
 assert.deepEqual((await h.query('SELECT * FROM courses')).rows,h.before);
});
test('shared webhook requires a signature and verifies amount/currency/identity before atomic, once-only issuance',async t=>{
 const h=await harness();t.after(()=>h.close());await h.service.checkout(h.input);const session=[...h.sessions.values()][0];session.status='complete';let event=h.event(session);
 assert.equal((await h.call('/payments/stripe/webhook',event.body)).status,400);assert.equal((await h.call('/payments/stripe/webhook',event.body,{'Stripe-Signature':event.signature})).status,200);assert.equal(h.notifications.length,0);
 session.payment_status='paid';
 for(const change of [{amount_total:1},{currency:'aed'},{livemode:false},{client_reference_id:crypto.randomUUID()},{id:'cs_live_OTHER'},{metadata:{...session.metadata,order_id:crypto.randomUUID()}}])await assert.rejects(h.service.reconcile({...session,...change}),e=>e.status===409);
 event=h.event(session,'checkout.session.async_payment_succeeded',{livemode:false});assert.equal((await h.call('/payments/stripe/webhook',event.body,{'Stripe-Signature':event.signature})).status,400);
 await h.query("ALTER TABLE membership_cards ADD CONSTRAINT local_force_failure CHECK(units_total<0)");event=h.event(session,'checkout.session.async_payment_succeeded');assert.equal((await h.call('/payments/stripe/webhook',event.body,{'Stripe-Signature':event.signature})).status,500);
 assert.equal((await h.query('SELECT state FROM membership_stripe_checkouts')).rows[0].state,'open');assert.equal((await h.query('SELECT verified_at FROM membership_orders')).rows[0].verified_at,null);assert.equal(h.notifications.length,0);
 await h.query('ALTER TABLE membership_cards DROP CONSTRAINT local_force_failure');for(let i=0;i<2;i++)assert.equal((await h.call('/payments/stripe/webhook',event.body,{'Stripe-Signature':event.signature})).status,200);
 assert.equal(h.notifications.length,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_cards')).rows[0].n,1);
 session.payment_status='unpaid';session.status='expired';await h.service.reconcile(session);assert.equal((await h.query('SELECT state FROM membership_stripe_checkouts')).rows[0].state,'paid');
});
test('bank requires a receipt and real saved account; approval matches amount and cannot issue twice or manually approve electronic payments',async t=>{
 const h=await harness();t.after(()=>h.close());const input={...h.input,payment_method:'bank'};
 await assert.rejects(h.service.offlineOrder(input,''),/وصل/);await h.query("UPDATE courses SET bank_account='',bank_iban=''");await assert.rejects(h.service.offlineOrder(input,'/uploads/local.pdf'),/غير جاهزة/);await h.query("UPDATE courses SET bank_account='LOCAL-ACCOUNT'");
 const first=await h.service.offlineOrder(input,'/uploads/local.pdf'),repeat=await h.service.offlineOrder(input,'/uploads/local.pdf');assert.equal(first.orderId,repeat.orderId);assert.equal(h.notifications.length,0);
 await assert.rejects(h.service.approveOffline(first.orderId,{confirmedFromBank:true,verifiedReference:'LOCAL-BANK-1',verifiedAmount:1,verifiedCurrency:'USD'}),/طابق/);
 const approved={confirmedFromBank:true,verifiedReference:'LOCAL-BANK-1',verifiedAmount:39.25,verifiedCurrency:'USD'};await Promise.all([h.service.approveOffline(first.orderId,approved),h.service.approveOffline(first.orderId,approved)]);assert.equal(h.notifications.length,1);
 await h.service.checkout({...h.input,request_key:crypto.randomUUID()});const electronic=(await h.query("SELECT id FROM membership_orders WHERE payment_method='stripe'")).rows[0];await assert.rejects(h.service.approveOffline(electronic.id,approved),/تلقائيًا/);
});
test('stock reservations are shared across payment methods, expire safely, and rejected orders stay rejected after payment',async t=>{
 const h=await harness();t.after(()=>h.close());await h.query('UPDATE membership_plans SET max_cards=1');
 const results=await Promise.allSettled([h.service.checkout(h.input),h.service.offlineOrder({...h.input,request_key:crypto.randomUUID(),payment_method:'bank'},'/uploads/local.pdf')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 // Either contender may win: release it, then exercise electronic expiration.
 await h.query("UPDATE membership_orders SET status='مرفوض'");const created=await h.service.checkout({...h.input,request_key:crypto.randomUUID()}),session=[...h.sessions.values()].at(-1);session.status='expired';await h.service.reconcile(session);await assert.rejects(h.service.checkout({...h.input,request_key:(await h.query('SELECT request_key FROM membership_stripe_checkouts WHERE id=$1',[created.checkoutId])).rows[0].request_key}),e=>e.status===410);
 const bank=await h.service.offlineOrder({...h.input,request_key:crypto.randomUUID(),payment_method:'bank'},'/uploads/local.pdf');assert.ok(bank.orderId);
 await h.query("UPDATE membership_orders SET status='مرفوض' WHERE id=$1",[session.client_reference_id]);session.payment_status='paid';session.status='complete';await h.service.reconcile(session);assert.equal(h.notifications.length,0);assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_cards')).rows[0].n,0);assert.equal((await h.query('SELECT status FROM membership_orders WHERE id=$1',[session.client_reference_id])).rows[0].status,'مرفوض');
});
test('a definite provider permission failure releases stock and can retry the same order safely',async t=>{
 const h=await harness();t.after(()=>h.close());h.denyNext();await assert.rejects(h.service.checkout(h.input),/DENIED/);assert.equal((await h.query('SELECT status FROM membership_orders')).rows[0].status,'تعذّر تجهيز الدفع');
 await h.service.checkout(h.input);assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_orders')).rows[0].n,1);assert.equal((await h.query('SELECT status FROM membership_orders')).rows[0].status,'بانتظار الدفع');assert.equal(h.notifications.length,0);
});
