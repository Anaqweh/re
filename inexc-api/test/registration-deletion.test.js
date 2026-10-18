// Disposable database and mocked UI only. No real recipients or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {setupLearnerService,createCardRegistration} from '../learner-service.js';
import {setupStripePayments} from '../stripe-payments.js';
import {setupRegistrationDeletion,deleteRegistration} from '../registration-deletion.js';
import {RESET,resetAiLicenceRegistrations,resetMessage,resetSummary} from '../ai-licence-reset.js';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 for(const name of ['courses','registrations','membership_plans','membership_orders','membership_cards','membership_redemptions']){const start=source.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');await db.exec(source.slice(start,source.indexOf('`);',start)))}
 await db.exec("ALTER TABLE registrations ADD COLUMN membership_card_id UUID,ADD COLUMN membership_redemption_id UUID; ALTER TABLE courses ADD COLUMN membership_plan_ids UUID[],ADD COLUMN membership_enabled BOOLEAN DEFAULT TRUE,ADD COLUMN membership_kind TEXT DEFAULT 'course',ADD COLUMN member_booking_opens_at TIMESTAMPTZ;");
 await db.exec(`CREATE TABLE email_campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),subject TEXT,body TEXT,audience TEXT,status TEXT,total_recipients INTEGER,course_name TEXT,submission_key TEXT UNIQUE);CREATE TABLE email_deliveries(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id UUID REFERENCES email_campaigns(id),email TEXT,recipient_name TEXT,status TEXT,payload_snapshot JSONB);`);
 const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 let tail=Promise.resolve();const pool={query,connect:async()=>{let release;const old=tail;tail=new Promise(r=>release=r);await old;return {query,release}}};
 await setupLearnerService(pool);await setupStripePayments(pool);await setupRegistrationDeletion(pool);
 const plan=(await query("INSERT INTO membership_plans(slug,name,price_usd,max_cards,valid_months,booking_units,course_unit_cost) VALUES('local','Local',0,100,6,10,2) RETURNING id")).rows[0].id;
 const card=(await query("INSERT INTO membership_cards(card_number,access_token,plan_id,holder_name,holder_email,holder_phone,units_total,units_remaining,expires_at) VALUES('INX-LOCAL','LOCAL-TOKEN',$1,'Local','learner@example.invalid','0000',10,10,now()+interval '1 year') RETURNING id",[plan])).rows[0].id;
 await query("INSERT INTO courses(id,name,price,certificate_mode,certificate_name,certificate_price,payment_methods) VALUES($1,$2,0,'optional','Local certificate',199,ARRAY['stripe'])",[RESET.courseId,RESET.courseName]);
 const registration=await createCardRegistration(pool,{courseId:RESET.courseId,name:'Local <img src=x>',email:'learner@example.invalid',phone:'0000',code:'INX-LOCAL',certificateRequested:true,shareConsent:true});
 await query("UPDATE registrations SET created_at='2026-10-18T16:00:00Z' WHERE id=$1",[registration.registrationId]);
 return {db,query,pool,card,id:registration.registrationId};
}
test('course reset returns card units, invalidates certificate link, deduplicates email and preserves later/other registrations',async t=>{
 const h=await fixture(t);
 await h.query("INSERT INTO registrations(reference,name,email,phone,course_id,course_name,created_at) VALUES('LOCAL-DUP','Local','LEARNER@example.invalid','0',$1,$2,'2026-10-18T16:00:00Z'),('LOCAL-LATER','Later','later@example.invalid','0',$1,$2,'2026-10-18T17:03:00Z'),('LOCAL-OTHER','Other','other@example.invalid','0',NULL,'Other','2026-10-18T16:00:00Z')",[RESET.courseId,RESET.courseName]);
 const result=await resetAiLicenceRegistrations(h.pool);assert.equal(result.deleted,2);assert.equal(result.restoredUnits,2);assert.equal(result.recipients,1);
 assert.equal((await h.query('SELECT units_remaining FROM membership_cards WHERE id=$1',[h.card])).rows[0].units_remaining,10);
 assert.equal((await h.query('SELECT * FROM certificate_requests')).rowCount,0);
 assert.deepEqual((await h.query('SELECT reference FROM registrations ORDER BY reference')).rows.map(r=>r.reference),['LOCAL-LATER','LOCAL-OTHER']);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM registration_deletions')).rows[0].n,2);
 const d=(await h.query('SELECT status,registration_id FROM membership_redemptions')).rows[0];assert.equal(d.status,'reversed');assert.equal(d.registration_id,null);
 const email=(await h.query('SELECT * FROM email_deliveries')).rows[0];assert.equal(email.email,'learner@example.invalid');assert.equal(email.status,'queued');assert.match(email.payload_snapshot.text,/نعتذر لكم عن حذف تسجيلكم/);
 const again=await resetAiLicenceRegistrations(h.pool);assert.equal(again.alreadyApplied,true);assert.equal(again.campaignId,result.campaignId);assert.equal((await h.query('SELECT * FROM email_deliveries')).rowCount,1);
 assert.equal((await resetSummary(h.pool)).campaignStatus,'queued');
});
test('payment evidence and a certificate checkout prevent the entire reset before mail or balance changes',async t=>{
 const h=await fixture(t),request=(await h.query('SELECT id FROM certificate_requests')).rows[0].id;
 await h.query("INSERT INTO certificate_payment_attempts(request_id,params,amount,state,expires_at) VALUES($1,'{}',19900,'creating',now()+interval '1 hour')",[request]);
 await assert.rejects(resetAiLicenceRegistrations(h.pool),/مرتبط بدفع/);
 assert.equal((await h.query('SELECT units_remaining FROM membership_cards')).rows[0].units_remaining,8);
 for(const table of ['registration_deletions','registration_reset_batches','email_deliveries','email_campaigns'])assert.equal((await h.query('SELECT * FROM '+table)).rowCount,0);
 assert.equal((await h.query('SELECT * FROM registrations')).rowCount,1);
 await assert.rejects(deleteRegistration(h.pool,h.id),/مرتبط بدفع/);
 await h.query('DELETE FROM certificate_payment_attempts');await h.query("UPDATE certificate_requests SET state='paid'");
 await assert.rejects(deleteRegistration(h.pool,h.id),/مرتبط بدفع/);
});
test('single deletion is retry-safe; active certificate mail and mismatched balance roll back without deleting',async t=>{
 const h=await fixture(t);
 await h.query("UPDATE certificate_requests SET email_status='sending',email_locked_until=now()+interval '2 minutes'");
 await assert.rejects(deleteRegistration(h.pool,h.id),/انتظر دقيقة/);
 await h.query("UPDATE certificate_requests SET email_status='pending',email_locked_until=NULL");
 await h.query('UPDATE membership_cards SET units_remaining=10');await assert.rejects(deleteRegistration(h.pool,h.id),/أرصدة البطاقات/);
 await h.query('UPDATE membership_cards SET units_remaining=8');
 const results=await Promise.all([deleteRegistration(h.pool,h.id),deleteRegistration(h.pool,h.id)]);
 assert.equal(results.reduce((n,r)=>n+r.restoredUnits,0),2);assert.equal(results.filter(r=>r.alreadyDeleted).length,1);
 assert.equal((await h.query('SELECT units_remaining FROM membership_cards')).rows[0].units_remaining,10);
 assert.equal((await h.query('SELECT * FROM email_deliveries')).rowCount,0);
 assert.ok(!(await h.query('SELECT snapshot FROM registration_deletions')).rows[0].snapshot.certificateRequest.access_token);
 await assert.rejects(deleteRegistration(h.pool,'invalid'),e=>e.status===400);
});
test('apology is complete Arabic text with escaped recipient names and no payment or registration promises',()=>{
 const message=resetMessage('<img src=x onerror=alert(1)>');assert.ok(!message.html.includes('<img src=x'));assert.ok(message.html.includes('&lt;img'));
 assert.match(message.text,/إذا كنتم مشتركين في قائمتنا البريدية/);assert.match(message.text,/التعليمات والخطوات الصحيحة للتسجيل/);
});
