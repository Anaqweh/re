import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHarness } from './studio-harness.js';
import { setupMessageStudio } from '../message-studio-schema.js';
import { blockedEmails, suppressEmail, assertMailAllowed } from '../message-suppression.js';
import { renderMail, mailSettings } from '../message-mail.js';
const uid=()=>crypto.randomUUID();
const payload={subject:'رسالة معاينة',message:'مرحبًا {{name}}',audience:'custom',extraRecipients:'blocked@example.com'};

test('permanent exclusions survive deletion, reimport, old subscription flows and database writes',async t=>{
 const h=await createHarness({beforeSetup:async q=>{
   await q("INSERT INTO email_preferences(email,unsubscribe_token,marketing_opt_out) VALUES('old@example.com','old-link',true)");
   await q("INSERT INTO message_contacts(full_name,email,normalized_email) VALUES('Old','old@example.com','old@example.com')");
   await q("INSERT INTO course_alert_subscribers(email,unsubscribe_token,active,suppressed) VALUES('course@example.com','course-old',false,true)");
   await q("INSERT INTO email_campaigns(subject,body,audience,status,sent_at) VALUES('Old campaign','Body','custom','sent',now())");
 }});t.after(()=>h.close());const api=h.request;
 await t.test('additive migration retains legacy exclusions and honest historical attribution',async()=>{
   assert.deepEqual([...await blockedEmails(h.pool,[' OLD@EXAMPLE.COM ','course@example.com'])].sort(),['course@example.com','old@example.com']);
   assert.equal((await api('/overview')).data.historical,2);
   assert.equal((await api('/campaigns')).data[0].unsubscribe_tracking,false);
   await setupMessageStudio(h.pool);assert.equal((await api('/suppressions')).data.total,2);
 });
 let campaignId,deliveryId,token;
 await t.test('signed-by-possession delivery tokens attribute a unique unsubscribe once',async()=>{
   const c=(await h.query("INSERT INTO email_campaigns(subject,body,audience,status,sent_at) VALUES('Latest campaign','Body','custom','sent',now()) RETURNING id")).rows[0];campaignId=c.id;
   await api('/contacts','POST',{email:'blocked@example.com',name:'Blocked'});
   const d=(await h.query("INSERT INTO email_deliveries(campaign_id,email,status,resend_email_id,attempted_at) VALUES($1,'blocked@example.com','sent','provider-accepted',now()) RETURNING id,unsubscribe_token",[campaignId])).rows[0];deliveryId=d.id;token=d.unsubscribe_token;
   assert.equal((await fetch(h.url+'/api/messages/unsubscribe?token=invalid')).status,400);
   assert.equal((await fetch(h.url+'/api/messages/unsubscribe?token='+token)).status,200);
   assert.equal((await fetch(h.url+'/api/messages/unsubscribe?token='+token,{method:'POST'})).status,200);
   assert.equal((await h.query('SELECT count(*)::int AS n FROM message_unsubscribe_events')).rows[0].n,1);
   const overview=(await api('/overview')).data;assert.equal(overview.unsubscribed,3);assert.equal(overview.latestCampaign.id,campaignId);assert.equal(overview.latestCampaign.unsubscribed,1);
   const details=(await api('/campaigns/'+campaignId)).data;assert.equal(details.campaign.unsubscribed,1);assert.ok(details.deliveries[0].unsubscribed_at);
   const second=(await h.query("INSERT INTO email_deliveries(campaign_id,email) VALUES($1,'blocked@example.com') RETURNING unsubscribe_token",[campaignId])).rows[0];
   await fetch(h.url+'/api/messages/unsubscribe?token='+second.unsubscribe_token);
   assert.equal((await api('/campaigns/'+campaignId)).data.campaign.unsubscribed,1);
 });
 await t.test('all import/manual edit/export paths exclude blocked addresses without recreating contacts',async()=>{
   await h.query("DELETE FROM message_contacts WHERE email='blocked@example.com'");
   assert.equal((await api('/contacts','POST',{name:'Re-add',email:' BLOCKED@EXAMPLE.COM '})).status,409);
   const safe=(await api('/contacts','POST',{email:'safe@example.com'})).data;
   assert.equal((await api('/contacts/'+safe.id,'PUT',{email:'blocked@example.com'})).status,409);
   const review=(await api('/import/inspect','POST',{rows:[{email:'blocked@example.com'},{email:'new@example.com'}]})).data;assert.equal(review.counts.suppressed,1);
   const commit=await api('/import/commit','POST',{rows:review.rows,listName:'Imported'});assert.equal(commit.data.suppressed,1);assert.equal(commit.data.added,1);
   assert.equal((await h.query("SELECT count(*)::int AS n FROM message_contacts WHERE email='blocked@example.com'")).rows[0].n,0);
   const exported=await api('/contacts-export');assert.ok(!exported.data.includes('old@example.com'));assert.ok(exported.data.includes('new@example.com'));
   // A direct legacy insertion cannot bypass application checks.
   assert.equal((await h.query("INSERT INTO message_contacts(email,normalized_email) VALUES('BLOCKED@example.com','BLOCKED@example.com') RETURNING id")).rowCount,0);
   assert.equal((await h.query("INSERT INTO course_alert_subscribers(email,unsubscribe_token) VALUES('blocked@example.com','rejoin') RETURNING id")).rowCount,0);
   await h.query("DELETE FROM email_preferences WHERE email='blocked@example.com'");
   await h.query("INSERT INTO email_preferences(email,unsubscribe_token,marketing_opt_out) VALUES('blocked@example.com','replacement',false)");
   assert.equal((await h.query("SELECT marketing_opt_out FROM email_preferences WHERE email='blocked@example.com'")).rows[0].marketing_opt_out,true);
   await assert.rejects(()=>h.query("DELETE FROM message_suppressions WHERE email='blocked@example.com'"),/Permanent suppression/);
   await assert.rejects(()=>h.query("UPDATE message_suppressions SET reason='legacy' WHERE email='blocked@example.com'"),/Permanent suppression/);
 });
 await t.test('previews and campaign review reject blocked mail without sending',async()=>{
   assert.equal((await api('/test','POST',{requestId:uid(),email:'blocked@example.com',payload})).status,409);assert.equal(h.sent.length,0);
   const review=(await api('/review','POST',{payload})).data;assert.equal(review.ready,0);
   const request={requestId:uid(),email:'preview@example.com',name:'Ahmed',payload:{...payload,layout:'course',headline:'عنوان الغلاف'}};
   assert.equal((await api('/test','POST',request)).status,200);assert.equal((await api('/test','POST',request)).status,200);assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'preview@example.com');assert.match(h.sent[0].subject,/\[TEST\]/);assert.match(h.sent[0].html,/عنوان الغلاف/);
   assert.equal((await api('/test','POST',{...request,name:'Changed'})).status,409);
 });
 await t.test('portable ledger is merge-only and survives transfer to a fresh installation',async()=>{
   const exported=(await api('/suppressions-export')).data;
   const other=await createHarness();try{
     const result=await other.request('/suppressions-import','POST',exported);assert.equal(result.status,200);assert.equal(result.data.added,3);
     assert.equal((await other.request('/suppressions-import','POST',exported)).data.added,0);
     assert.equal((await other.request('/import/commit','POST',{rows:[{email:'blocked@example.com'}]})).data.suppressed,1);
     assert.equal((await other.request('/contacts','POST',{email:'blocked@example.com'})).status,409);
   }finally{await other.close()}
 });
 await t.test('legacy unsubscribe links record optout without assigning an invented campaign',async()=>{
   const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8'),handlers={};
   vm.runInNewContext(source.slice(source.indexOf("for (const [route,table]"),source.indexOf("app.get('/api/testimonials'")),{app:{get:(p,fn)=>handlers[p]=fn},pool:h.pool,suppressEmail,clean:v=>String(v||'')});
   const res={status(){return this},type(){return this},send(){return this}};
   await handlers['/api/course-alerts/unsubscribe']({query:{token:'course-old'}},res,e=>{throw e});
   const event=(await h.query("SELECT * FROM message_unsubscribe_events WHERE email='course@example.com'")).rows[0];assert.equal(event.campaign_id,null);
   assert.equal((await api('/campaigns/'+campaignId)).data.campaign.unsubscribed,1);
 });
 await t.test('provider complaints remain distinct from unsubscribe totals',async()=>{
   const before=(await api('/overview')).data.unsubscribed;
   await suppressEmail(h.pool,'bounce@example.com',{reason:'bounce',source:'provider'});
   assert.equal((await api('/overview')).data.unsubscribed,before);
   assert.equal((await api('/suppressions')).data.rows.find(r=>r.email==='bounce@example.com').reason,'bounce');
 });
});

test('shared ledger enforces authentication and fails closed when unreachable',async t=>{
 const h=await createHarness();t.after(()=>h.close());await suppressEmail(h.pool,'blocked@example.com');
 const old={key:process.env.MESSAGE_SUPPRESSION_SYNC_KEY,url:process.env.MESSAGE_SUPPRESSION_REMOTE_URL};
 t.after(()=>{if(old.key===undefined)delete process.env.MESSAGE_SUPPRESSION_SYNC_KEY;else process.env.MESSAGE_SUPPRESSION_SYNC_KEY=old.key;if(old.url===undefined)delete process.env.MESSAGE_SUPPRESSION_REMOTE_URL;else process.env.MESSAGE_SUPPRESSION_REMOTE_URL=old.url});
 process.env.MESSAGE_SUPPRESSION_SYNC_KEY='local-testing-key-at-least-32-characters';
 const url=h.url+'/api/message-suppressions/check',body=JSON.stringify({emails:['BLOCKED@example.com','safe@example.com']});
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
 const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.MESSAGE_SUPPRESSION_SYNC_KEY},body});assert.deepEqual(await result.json(),{checked:2,blocked:['blocked@example.com']});
 process.env.MESSAGE_SUPPRESSION_REMOTE_URL='http://invalid.example/check';
 await assert.rejects(()=>assertMailAllowed(h.pool,'safe@example.com'),/سجل الحظر المشترك/);
});

test('layout metadata survives settings round-trip; all designs escape unsafe content and support RTL/LTR',()=>{
 for(const layout of ['branded','course','workshop','newsletter','thankyou','letter']){
  const settings=mailSettings({layout,headline:'عنوان <script>bad</script>',intro:'مقدمة',eyebrow:'INEXC',brandColor:'#ffffff'});
  assert.equal(settings.layout,layout);
  const mail=renderMail({subject:'Test',body:'مرحبًا {{name}}',person:{name:'<img src=x>'},settings,unsubscribeUrl:'https://example.com/u'});
  assert.ok(!mail.html.includes('<script>'));assert.ok(!mail.html.includes('<img src=x>'));assert.equal(mail.direction,'rtl');assert.match(mail.html,/@media/);
  const english=renderMail({subject:'Test',body:'Hello {{name}}',settings});assert.equal(english.direction,'ltr');
 }
});
