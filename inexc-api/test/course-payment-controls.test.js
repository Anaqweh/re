import {courseCardInput,attachCourseCardNames} from '../course-card-access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {setupCoursePaymentControls,createCoursePaymentControls,coursePaymentInput,validateCoursePayment} from '../course-payment.js';
import {probeStripeCheckout,stripeClient} from '../stripe-payments.js';
const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();const start=source.indexOf('CREATE TABLE IF NOT EXISTS courses (');await db.exec(source.slice(start,source.indexOf('`);',start)));
 await db.exec('ALTER TABLE courses ADD COLUMN membership_enabled BOOLEAN NOT NULL DEFAULT true, ADD COLUMN membership_plan_ids UUID[], ADD COLUMN featured BOOLEAN NOT NULL DEFAULT false; CREATE TABLE membership_plans(id UUID PRIMARY KEY,name TEXT)');
 const query=async(sql,args)=>{const result=await db.query(sql,args);return {...result,rowCount:result.rows.length||result.affectedRows||0}},pool={query,connect:async()=>({query,release(){}})};
 const a=(await query("INSERT INTO courses(name,price,payment_methods) VALUES('LOCAL A',249,ARRAY['bank']) RETURNING id")).rows[0].id;
 const b=(await query("INSERT INTO courses(name,price,payment_methods,payment_link,active) VALUES('LOCAL B',399,ARRAY['bank','link'],'https://example.invalid/pay',false) RETURNING id")).rows[0].id;
 await setupCoursePaymentControls(pool);
 const stripe={enabled:()=>true,readiness:()=>({ready:null}),checkReadiness:async()=>({ready:true})};
 const control=createCoursePaymentControls({pool,stripe,publicCourse:r=>({id:r.id,name:r.name,payments:r.payment_methods,membershipEnabled:r.membership_enabled,active:r.active})});
 return {db,pool,query,a,b,control};
}
test('one-time activation covers all courses; per-course choices and empty payment sets survive restart',async t=>{
 const f=await fixture();t.after(()=>f.db.close());let settings=await f.control.settings();assert.ok(settings.courses.every(c=>c.payments.includes('stripe')));
 await f.control.update({courseId:f.a,payments:[],membershipEnabled:false});await setupCoursePaymentControls(f.pool);
 const row=(await f.query('SELECT * FROM courses WHERE id=$1',[f.a])).rows[0];assert.deepEqual(row.payment_methods,[]);assert.equal(row.membership_enabled,false);assert.throws(()=>validateCoursePayment(row,{method:'bank',total:249,hasReceipt:true}));
 const inherited=await coursePaymentInput(f.pool,{},row);assert.deepEqual(inherited,{methods:[],membershipEnabled:false});
 const cleared=await coursePaymentInput(f.pool,{payments:[],membershipEnabled:false},row);assert.deepEqual(cleared.methods,[]);
});
test('actual course create/update handlers preserve disabled methods and apply new-course defaults',async t=>{
 const f=await fixture();t.after(()=>f.db.close());await f.db.exec("ALTER TABLE courses ADD COLUMN share_slug TEXT NOT NULL DEFAULT ''");
 await f.control.update({scope:'all',payments:['stripe'],membershipEnabled:false,applyToNew:true});
 const app=express();app.use(express.json());const start=source.indexOf("app.post('/api/admin/courses',"),end=source.indexOf("app.delete('/api/admin/courses/:id',",start);
 const clean=(v,max=400)=>String(v??'').trim().slice(0,max),publicCourse=r=>({id:r.id,name:r.name,payments:r.payment_methods,membershipEnabled:r.membership_enabled,active:r.active});
 new Function('app','auth','pool','coursePaymentInput','clean','courseAxes','courseOutcomes','asNumber','courseSlug','publicCourse','queueCourseAlertEmails','courseCardInput','attachCourseCardNames',source.slice(start,end))(app,(_q,_s,next)=>next(),f.pool,coursePaymentInput,clean,()=>[],()=>[],v=>Number(v)||0,id=>'local-'+id,publicCourse,()=>{throw Error('NO MAIL FOR HIDDEN FIXTURE')},courseCardInput,attachCourseCardNames);
 app.use((error,_q,res,_n)=>res.status(error.status||500).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=async(method,suffix,body)=>{const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/courses'+suffix,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'LOCAL CRUD',active:false,...body})});return {status:res.status,data:await res.json()}};
 const created=await request('POST','',{certificate:{issuer:'  LOCAL ISSUER  '}});assert.equal(created.status,201,JSON.stringify(created));assert.deepEqual(created.data.payments,['stripe']);assert.equal(created.data.membershipEnabled,false);
 assert.equal((await f.query('SELECT certificate_issuer FROM courses WHERE id=$1',[created.data.id])).rows[0].certificate_issuer,'LOCAL ISSUER');
 const disabled=await request('PUT','/'+created.data.id,{payments:[],membershipEnabled:false});assert.equal(disabled.status,200);assert.deepEqual(disabled.data.payments,[]);assert.equal(disabled.data.membershipEnabled,false);
 const unchanged=await request('PUT','/'+created.data.id,{name:'LOCAL RENAMED'});assert.deepEqual(unchanged.data.payments,[]);assert.equal(unchanged.data.membershipEnabled,false);
 const three=await request('PUT','/'+created.data.id,{payments:['stripe','bank'],membershipEnabled:true});assert.deepEqual(three.data.payments,['stripe','bank']);assert.equal(three.data.membershipEnabled,true);
 assert.equal((await request('PUT','/'+created.data.id,{payments:['link'],membershipEnabled:true})).status,400);
 assert.equal((await f.query('SELECT certificate_issuer FROM courses WHERE id=$1',[created.data.id])).rows[0].certificate_issuer,'LOCAL ISSUER');
 await request('PUT','/'+created.data.id,{certificate:{issuer:'  NEW ISSUER  '}});assert.equal((await f.query('SELECT certificate_issuer FROM courses WHERE id=$1',[created.data.id])).rows[0].certificate_issuer,'NEW ISSUER');
 await request('PUT','/'+created.data.id,{certificate:{issuer:''}});assert.equal((await f.query('SELECT certificate_issuer FROM courses WHERE id=$1',[created.data.id])).rows[0].certificate_issuer,'');
 const plan='11111111-1111-4111-8111-111111111111';await f.query('INSERT INTO membership_plans VALUES($1,$2)',[plan,'باقة الريادة']);
 const restricted=await request('PUT','/'+created.data.id,{featured:true,membershipPlanIds:[plan]});assert.equal(restricted.status,200,JSON.stringify(restricted));
 let saved=(await f.query('SELECT * FROM courses WHERE id=$1',[created.data.id])).rows[0];assert.equal(saved.featured,true);assert.deepEqual(saved.membership_plan_ids,[plan]);assert.deepEqual(saved.payment_methods,['stripe','bank']);
 await request('PUT','/'+created.data.id,{name:'LOCAL WITH OLD CLIENT'});await f.control.update({scope:'all',payments:['stripe'],membershipEnabled:false});
 saved=(await f.query('SELECT * FROM courses WHERE id=$1',[created.data.id])).rows[0];assert.equal(saved.featured,true);assert.deepEqual(saved.membership_plan_ids,[plan]);
 assert.equal((await request('PUT','/'+created.data.id,{membershipPlanIds:[]})).status,400);
 assert.equal((await request('PUT','/'+created.data.id,{membershipPlanIds:null,featured:false})).status,200);
 saved=(await f.query('SELECT * FROM courses WHERE id=$1',[created.data.id])).rows[0];assert.equal(saved.featured,false);assert.equal(saved.membership_plan_ids,null);
});
test('bulk replacement is atomic, saves new-course defaults, and supports 1, 2, 3 or no methods',async t=>{
 const f=await fixture();t.after(()=>f.db.close());
 for(const [payments,membershipEnabled]of [[['stripe'],false],[['stripe','bank'],false],[['stripe','bank'],true],[[],false]]){
  const result=await f.control.update({scope:'all',payments,membershipEnabled,applyToNew:true});assert.equal(result.updated,2);for(const c of result.courses){assert.deepEqual(c.payments,payments);assert.equal(c.membershipEnabled,membershipEnabled)}
  assert.deepEqual(await coursePaymentInput(f.pool,{}),{methods:payments,membershipEnabled});
 }
 await assert.rejects(f.control.update({scope:'all',payments:['bank','link'],membershipEnabled:true}),/LOCAL A/);
 assert.ok((await f.control.settings()).courses.every(c=>c.payments.length===0));
 const enabled=await f.control.update({scope:'all',action:'enable-stripe',applyToNew:true});assert.ok(enabled.courses.every(c=>c.payments.join()==='stripe'&&!c.membershipEnabled));
 await f.control.update({scope:'all',action:'disable-stripe',applyToNew:true});await setupCoursePaymentControls(f.pool);assert.ok((await f.control.settings()).courses.every(c=>!c.payments.includes('stripe')));
 await assert.rejects(f.control.update({courseId:f.a,payments:['unknown'],membershipEnabled:true}),/غير صالحة/);
});
test('all payment settings and readiness routes require administrator authentication',async t=>{
 const f=await fixture();t.after(()=>f.db.close());const app=express();app.use(express.json());f.control.install(app,(req,res,next)=>req.headers.authorization==='Bearer LOCAL'?next():res.sendStatus(401));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port+'/api/admin/course-payments';
 for(const [method,suffix]of [['GET',''],['PUT',''],['POST','/stripe-check']])assert.equal((await fetch(base+suffix,{method})).status,401);
 assert.equal((await fetch(base,{headers:{Authorization:'Bearer LOCAL'}})).status,200);
});
test('readiness creates then expires a session without customers or registrations and diagnoses a restricted key safely',async()=>{
 const env={STRIPE_CHECKOUT_ENABLED:'1',STRIPE_SECRET_KEY:'rk_live_LOCAL',STRIPE_WEBHOOK_SECRET:'whsec_LOCAL'},calls=[];
 const result=await probeStripeCheckout({env,client:{account:async()=>({charges_enabled:true}),create:async(params)=>{calls.push(params);return {id:'cs_live_LOCAL',livemode:true}},expire:async id=>{assert.equal(id,'cs_live_LOCAL');return {status:'expired'}}}});
 assert.equal(result.ready,true);assert.equal(calls[0].customer_email,undefined);assert.equal(calls[0]['metadata[source]'],'inexc-readiness-probe');assert.equal(calls[0]['payment_method_types[0]'],undefined);assert.equal(calls[0]['adaptive_pricing[enabled]'],'false');assert.match(calls[0].integration_identifier,/^inexc-probe-[a-z]{8}$/);
 const client=stripeClient('rk_live_LOCAL',async()=>({status:403,ok:false,json:async()=>({error:{code:'permission_missing',message:'Requires rak_product_write SENSITIVE_DETAIL'}})}));
 const failed=await probeStripeCheckout({env,client});assert.equal(failed.ready,false);assert.deepEqual(failed.diagnostic.permissions,['rak_product_write']);assert.doesNotMatch(JSON.stringify(failed),/SENSITIVE_DETAIL|rk_live_LOCAL/);
 const noCharges=await probeStripeCheckout({env,client:{account:async()=>({charges_enabled:false}),create:()=>{throw Error('NO')}}});assert.equal(noCharges.ready,false);
});
