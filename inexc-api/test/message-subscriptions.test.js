import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createHarness} from './studio-harness.js';
import {suppressEmail} from '../message-suppression.js';
import {renderMail,mailSettings} from '../message-mail.js';
import {subscriptionUrl} from '../message-subscription-links.js';
import {setupMessageSubscriptions,recordBlockedAttempt} from '../message-subscriptions.js';
const request=async(h,path,body)=>{const r=await fetch(h.url+'/api/message-subscriptions/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
const signup=(h,email,extra={})=>request(h,'request',{email,name:'أحمد',consent:true,...extra});
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');

test('immediate subscription joins existing contacts, tracks new signups and preserves exclusions',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const campaign=(await h.query("INSERT INTO email_campaigns(subject,body,audience) VALUES('حملة المعرفة','body','custom') RETURNING id,subscription_code")).rows[0];
 await t.test('public config states instant mode and admin endpoints require authentication',async()=>{
  const config=await request(h,'config');assert.equal(config.data.version,2);assert.equal(config.data.mode,'instant');assert.equal(config.data.available,true);
  for(const suffix of ['/subscriptions','/subscriptions/qr','/subscriptions/new','/subscriptions/blocked-attempts'])assert.equal((await fetch(h.url+'/api/admin/message-studio'+suffix)).status,401);
  assert.equal((await fetch(h.url+'/api/admin/message-studio/subscriptions/new/seen',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"emails":[]}'})).status,401);
 });
 await t.test('invalid addresses, missing consent and honeypots add no contacts or mail',async()=>{
  assert.equal((await signup(h,'invalid')).status,400);assert.equal((await signup(h,'a@example.com',{consent:false})).status,400);assert.equal((await signup(h,'a@example.com',{website:'spam'})).status,202);
  assert.equal((await h.query('SELECT * FROM message_contacts')).rows.length,0);assert.equal(h.sent.length,0);
 });
 await t.test('form submission immediately adds one normalized contact and membership without verification mail',async()=>{
  assert.equal((await signup(h,' FIRST@Example.com ',{source:campaign.subscription_code})).status,202);
  const row=(await h.query('SELECT * FROM message_subscriptions')).rows[0];assert.equal(row.email,'first@example.com');assert.equal(row.campaign_id,campaign.id);assert.ok(row.subscribed_at);assert.equal(row.confirmed_at,null);assert.equal(row.token_hash,null);assert.equal(row.signup_method,'direct');assert.equal(row.added_new_contact,true);assert.equal(row.seen_at,null);assert.equal(row.consent_version,2);
  const contacts=(await h.query('SELECT * FROM message_contacts')).rows;assert.equal(contacts.length,1);assert.equal(contacts[0].email,'first@example.com');assert.ok(contacts[0].tags.includes('اشتراك من الموقع'));assert.ok(!contacts[0].tags.includes('اشتراك مؤكد'));
  assert.equal((await h.query('SELECT * FROM message_recipient_list_members')).rows.length,1);assert.equal(h.sent.length,0);
  const admin=(await h.request('/subscriptions')).data;assert.equal(admin.stats.subscribed,1);assert.equal(admin.stats.new,1);assert.equal(admin.campaigns[0].subscribed,1);assert.match((await h.request('/contacts-export')).data,/first@example.com/);
 });
 await t.test('new-subscriber badge, search and explicit seen state remain separate from contacts',async()=>{
  const list=await h.request('/subscriptions/new?filter=new');assert.equal(list.data.total,1);assert.equal(list.data.rows[0].status,'active');assert.equal((await h.request('/subscriptions/new?search=FIRST')).data.total,1);assert.equal((await h.request('/subscriptions/new?search=nomatch')).data.total,0);
  assert.equal((await h.request('/subscriptions/new?countOnly=1')).data.unread,1);
  await h.request('/subscriptions/new/seen','POST',{emails:['FIRST@EXAMPLE.COM']});assert.equal((await h.request('/subscriptions/new?countOnly=1')).data.unread,0);assert.equal((await h.request('/subscriptions/new?filter=new')).data.total,0);assert.equal((await h.request('/subscriptions/new')).data.total,1);
  const before=(await h.query('SELECT subscribed_at FROM message_subscriptions')).rows[0].subscribed_at;
  await signup(h,'first@example.com',{name:'Duplicate'});const row=(await h.query('SELECT * FROM message_subscriptions')).rows[0];assert.deepEqual(row.subscribed_at,before);assert.equal(row.full_name,'أحمد');assert.ok(row.seen_at);assert.equal(row.campaign_id,campaign.id);assert.equal((await h.query('SELECT * FROM message_contacts')).rows.length,1);
 });
 await t.test('a signup with an existing email preserves its profile and identifies it in the new-subscriber list',async()=>{
  await h.query("INSERT INTO message_contacts(full_name,email,normalized_email,tags,source) VALUES('Original','existing@example.com','existing@example.com',ARRAY['VIP'],'import')");
  await signup(h,'existing@example.com',{name:'Different'});const row=(await h.query("SELECT * FROM message_contacts WHERE email='existing@example.com'")).rows[0];assert.equal(row.full_name,'Original');assert.equal(row.source,'import');assert.ok(row.tags.includes('VIP'));
  const signupRow=(await h.request('/subscriptions/new?search=existing@example.com')).data.rows[0];assert.equal(signupRow.added_new_contact,false);assert.equal(signupRow.contact_id,row.id);assert.equal(signupRow.status,'active');
 });
 await t.test('concurrent repeated signups stay unique and do not duplicate memberships',async()=>{
  const responses=await Promise.all([signup(h,'repeat@example.com'),signup(h,'REPEAT@example.com')]);assert.ok(responses.every(r=>r.status===202));assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='repeat@example.com'")).rows.length,1);assert.equal((await h.query("SELECT * FROM message_recipient_list_members m JOIN message_contacts c ON c.id=m.contact_id WHERE c.email='repeat@example.com'")).rows.length,1);
 });
 await t.test('an opted-out address cannot rejoin even after contact deletion and import',async()=>{
  await suppressEmail(h.pool,'first@example.com');const before=h.sent.length;
  const refused=await signup(h,'FIRST@example.com',{source:campaign.subscription_code});assert.equal(refused.status,409);assert.match(refused.data.error,/إلغاء المتابعة/);
  assert.equal((await signup(h,'first@example.com')).status,409);
  const attempts=await h.request('/subscriptions/blocked-attempts?search=FIRST');assert.equal(attempts.data.total,1);assert.equal(attempts.data.rows[0].attempts,2);assert.equal(attempts.data.rows[0].reason,'unsubscribe');
  await recordBlockedAttempt(h.pool,'first@example.com',{channel:'course',course:'الرخصة الدولية للذكاء الاصطناعي'});
  const courseAttempt=(await h.request('/subscriptions/blocked-attempts?search=FIRST')).data.rows[0];
  assert.equal(courseAttempt.attempts,3);assert.equal(courseAttempt.last_channel,'course');assert.equal(courseAttempt.last_course,'الرخصة الدولية للذكاء الاصطناعي');
  assert.equal(h.sent.length,before);assert.doesNotMatch((await h.request('/contacts-export')).data,/first@example.com/);
  await h.query("DELETE FROM message_contacts WHERE email='first@example.com'");await signup(h,'first@example.com');assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='first@example.com'")).rows.length,0);
  assert.equal((await h.request('/import/inspect','POST',{rows:[{email:'first@example.com'}]})).data.counts.suppressed,1);assert.equal((await h.request('/subscriptions/new?search=first@example.com')).data.rows[0].status,'blocked');
 });
 await t.test('existing pending confirmation links continue to work safely; expired and suppressed links fail',async()=>{
  for(const [email,token,expiry] of [['legacy@example.com','a'.repeat(64),"now()+interval '1 day'"],['expired@example.com','b'.repeat(64),"now()-interval '1 day'"],['blocked@example.com','c'.repeat(64),"now()+interval '1 day'"]])await h.query(`INSERT INTO message_subscriptions(email,token_hash,expires_at,consent_text) VALUES($1,$2,${expiry},'Legacy consent')`,[email,hash(token)]);
  await suppressEmail(h.pool,'blocked@example.com');assert.equal((await request(h,'confirm',{token:'a'.repeat(64)})).status,200);assert.equal((await request(h,'confirm',{token:'a'.repeat(64)})).data.alreadyConfirmed,true);assert.equal((await request(h,'confirm',{token:'b'.repeat(64)})).status,400);assert.equal((await request(h,'confirm',{token:'c'.repeat(64)})).status,400);
  const row=(await h.query("SELECT * FROM message_subscriptions WHERE email='legacy@example.com'")).rows[0];assert.ok(row.confirmed_at);assert.ok(row.subscribed_at);assert.equal(row.signup_method,'verified');
  await signup(h,'expired@example.com');const renewed=(await h.query("SELECT * FROM message_subscriptions WHERE email='expired@example.com'")).rows[0];assert.ok(renewed.subscribed_at);assert.equal(renewed.confirmed_at,null);assert.equal(renewed.token_hash,null);
 });
 await t.test('shared suppression failures prevent direct enrollment and exports',async()=>{
  process.env.MESSAGE_SUPPRESSION_REMOTE_URL='http://not-permitted.invalid';process.env.MESSAGE_SUPPRESSION_SYNC_KEY='x'.repeat(40);
  try{assert.equal((await signup(h,'remote@example.com')).status,503);assert.equal((await h.request('/contacts-export')).status,503);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='remote@example.com'")).rows.length,0);}finally{delete process.env.MESSAGE_SUPPRESSION_REMOTE_URL;delete process.env.MESSAGE_SUPPRESSION_SYNC_KEY;}
 });
 await t.test('additive migration updates default wording and preserves custom group names/settings',async()=>{
  await h.query("UPDATE message_subscription_settings SET value=$1 WHERE id=1",[{title:'My custom title',note:'سنرسل رابطًا لتأكيد بريدك أولًا. يمكنك إلغاء الاشتراك من أي رسالة.'}]);
  await h.query("UPDATE message_recipient_lists SET name='My custom list'");await setupMessageSubscriptions(h.pool);await setupMessageSubscriptions(h.pool);
  assert.equal((await request(h,'config')).data.settings.title,'My custom title');assert.doesNotMatch((await request(h,'config')).data.settings.note,/تأكيد/);assert.equal((await h.query('SELECT name FROM message_recipient_lists')).rows[0].name,'My custom list');
 });
 await t.test('pause is respected and QR remains available to administrators',async()=>{
  await h.request('/subscriptions/settings','PUT',{enabled:false,title:'عنوان جديد <script>'});assert.equal((await signup(h,'paused@example.com')).status,503);assert.equal((await request(h,'config')).data.settings.title,'عنوان جديد <script>');await h.request('/subscriptions/settings','PUT',{enabled:true});
  const qr=await h.request('/subscriptions/qr?source='+campaign.subscription_code);assert.equal(qr.status,200);assert.match(qr.data,/<svg/);
 });
 await t.test('persisted throttling limits new records and no confirmation emails were created',async()=>{
  await h.query("UPDATE message_subscription_limits SET hits=120 WHERE key LIKE 'ip:%'");assert.equal((await signup(h,'rate@example.com')).status,429);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='rate@example.com'")).rows.length,0);assert.equal(h.sent.length,0);
 });
});

test('email sharing preserves existing mail and exposes campaign code without recipient data',()=>{
 const base={subject:'مرحبًا',body:'فكرة جديدة',person:{name:'أحمد',email:'private@example.com'},settings:{designVersion:3},unsubscribeUrl:'https://example.com/unsubscribe'};assert.doesNotMatch(renderMail(base).html,/subscribe.html/);
 const source='12345678-1234-1234-1234-123456789012';
 for(const designVersion of [1,2,3]){const config=mailSettings({designVersion,shareEnabled:true,shareText:'المعرفة <للجميع>',shareLabel:'شارك الآن'});assert.equal(config.shareEnabled,true);const mail=renderMail({...base,shareUrl:subscriptionUrl(source,true),settings:config});assert.match(mail.html,/المعرفة &lt;للجميع&gt;/);assert.match(mail.html,/subscribe.html\?source=12345678/);assert.doesNotMatch(mail.html,/private@example.com/);assert.match(mail.text,/شارك الآن/);assert.match(mail.html,/example.com\/unsubscribe/);}
 assert.doesNotMatch(renderMail({...base,shareUrl:'javascript:alert(1)',settings:{designVersion:3,shareEnabled:true}}).html,/javascript|subscribe.html/);assert.equal(subscriptionUrl('not-a-campaign'),subscriptionUrl());
});
