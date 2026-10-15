import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './studio-harness.js';
import {suppressEmail} from '../message-suppression.js';
import {renderMail,mailSettings} from '../message-mail.js';
import {subscriptionUrl} from '../message-subscription-links.js';
const tokenFrom=mail=>mail.text.match(/#confirm=([a-f\d]{64})/)[1];
const request=async(h,path,body)=>{const r=await fetch(h.url+'/api/message-subscriptions/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
const signup=(h,email,extra={})=>request(h,'request',{email,name:'أحمد',consent:true,...extra});

test('public subscriptions require verified possession and preserve permanent exclusion',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const campaign=(await h.query("INSERT INTO email_campaigns(subject,body,audience) VALUES('حملة المعرفة','body','custom') RETURNING id,subscription_code")).rows[0];
 let token;
 await t.test('public config exposes copy only; admin and QR require authentication',async()=>{
  const config=await request(h,'config');assert.equal(config.data.version,1);assert.equal(config.data.available,true);
  for(const suffix of ['/subscriptions','/subscriptions/qr']){const response=await fetch(h.url+'/api/admin/message-studio'+suffix);assert.equal(response.status,401);}
 });
 await t.test('consent and email validation precede mail; honeypots never enqueue',async()=>{
  assert.equal((await signup(h,'invalid')).status,400);assert.equal((await signup(h,'a@example.com',{consent:false})).status,400);
  assert.equal((await signup(h,'a@example.com',{website:'spam'})).status,202);assert.equal(h.sent.length,0);
 });
 await t.test('request normalizes address, attributes campaign and stores only token hash',async()=>{
  const r=await signup(h,' FIRST@Example.com ',{source:campaign.subscription_code});assert.equal(r.status,202);assert.equal(h.sent.length,1);
  token=tokenFrom(h.sent[0]);const row=(await h.query('SELECT * FROM message_subscriptions')).rows[0];assert.equal(row.email,'first@example.com');assert.equal(row.campaign_id,campaign.id);assert.equal(row.confirmed_at,null);assert.notEqual(row.token_hash,token);assert.equal(row.token_hash.length,64);assert.equal(row.consent_text.length>20,true);
  assert.equal((await h.query('SELECT * FROM message_contacts')).rows.length,0);assert.equal((await h.request('/subscriptions')).data.stats.pending,1);
 });
 await t.test('opening an email link never confirms; repeat requests do not send duplicate mail',async()=>{
  await fetch(h.url+'/subscribe.html#confirm='+token);assert.equal((await h.query('SELECT confirmed_at FROM message_subscriptions')).rows[0].confirmed_at,null);
  await signup(h,'first@example.com');assert.equal(h.sent.length,1);
  assert.equal((await request(h,'confirm',{token:'f'.repeat(64)})).status,400);
 });
 await t.test('explicit confirmation creates one contact and membership; repeats are idempotent',async()=>{
  assert.equal((await request(h,'confirm',{token})).status,200);assert.equal((await request(h,'confirm',{token})).data.alreadyConfirmed,true);
  const contacts=(await h.query('SELECT * FROM message_contacts')).rows;assert.equal(contacts.length,1);assert.equal(contacts[0].email,'first@example.com');assert.equal(contacts[0].full_name,'أحمد');assert.ok(contacts[0].tags.includes('اشتراك مؤكد'));
  assert.equal((await h.query('SELECT * FROM message_recipient_list_members')).rows.length,1);
  const admin=(await h.request('/subscriptions')).data;assert.equal(admin.stats.confirmed,1);assert.equal(admin.stats.pending,0);assert.equal(admin.campaigns[0].confirmed,1);assert.ok(admin.listId);assert.match(admin.campaigns[0].url,new RegExp(campaign.subscription_code));
  assert.match((await h.request('/contacts-export')).data,/first@example.com/);
 });
 await t.test('confirmation never replaces an existing contact profile',async()=>{
  await h.query("INSERT INTO message_contacts(full_name,email,normalized_email,tags,source) VALUES('Original','existing@example.com','existing@example.com',ARRAY['VIP'],'import')");
  await signup(h,'existing@example.com',{name:'Changed by stranger'});await request(h,'confirm',{token:tokenFrom(h.sent.at(-1))});
  const row=(await h.query("SELECT * FROM message_contacts WHERE email='existing@example.com'")).rows[0];assert.equal(row.full_name,'Original');assert.equal(row.source,'import');assert.ok(row.tags.includes('VIP'));assert.ok(row.tags.includes('اشتراك مؤكد'));
 });
 await t.test('unsubscribe blocks future requests and old confirmation tokens, even after contact deletion',async()=>{
  await suppressEmail(h.pool,'first@example.com');const before=h.sent.length;
  const result=await signup(h,'FIRST@example.com');assert.equal(result.status,202);assert.equal(h.sent.length,before);assert.equal((await request(h,'confirm',{token})).status,400);
  assert.doesNotMatch((await h.request('/contacts-export')).data,/first@example.com/);
  await h.query("DELETE FROM message_contacts WHERE email='first@example.com'");await signup(h,'first@example.com');assert.equal((await request(h,'confirm',{token})).status,400);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='first@example.com'")).rows.length,0);
  const imported=await h.request('/import/inspect','POST',{rows:[{email:'first@example.com'}]});assert.equal(imported.data.counts.suppressed,1);
  assert.equal((await h.request('/subscriptions')).data.stats.blocked,1);
 });
 await t.test('unsubscribe while pending prevents confirmation and excludes it from pending statistics',async()=>{
  await signup(h,'pending@example.com');const pendingToken=tokenFrom(h.sent.at(-1));await suppressEmail(h.pool,'pending@example.com');assert.equal((await request(h,'confirm',{token:pendingToken})).status,400);assert.equal((await h.request('/subscriptions')).data.stats.pending,0);
 });
 await t.test('expired tokens fail; renewal rotates token and invalidates the old link',async()=>{
  await signup(h,'expired@example.com');const oldToken=tokenFrom(h.sent.at(-1));await h.query("UPDATE message_subscriptions SET expires_at=now()-interval '1 hour',sent_at=now()-interval '2 hours' WHERE email='expired@example.com'");assert.equal((await request(h,'confirm',{token:oldToken})).status,400);assert.equal((await h.request('/subscriptions')).data.stats.expired,1);
  await signup(h,'expired@example.com');const freshToken=tokenFrom(h.sent.at(-1));assert.notEqual(freshToken,oldToken);assert.equal((await request(h,'confirm',{token:oldToken})).status,400);assert.equal((await request(h,'confirm',{token:freshToken})).status,200);
 });
 await t.test('remote suppression failure closes request and export paths without sending',async()=>{
  const before=h.sent.length;process.env.MESSAGE_SUPPRESSION_REMOTE_URL='http://not-permitted.invalid';process.env.MESSAGE_SUPPRESSION_SYNC_KEY='x'.repeat(40);
  try{assert.equal((await signup(h,'remote@example.com')).status,503);assert.equal((await h.request('/contacts-export')).status,503);assert.equal(h.sent.length,before);}finally{delete process.env.MESSAGE_SUPPRESSION_REMOTE_URL;delete process.env.MESSAGE_SUPPRESSION_SYNC_KEY;}
 });
 await t.test('settings persist safely, disabling intake also disables pending confirmations',async()=>{
  await signup(h,'pause@example.com');const pendingToken=tokenFrom(h.sent.at(-1));
  const saved=await h.request('/subscriptions/settings','PUT',{enabled:false,title:'عنوان جديد <script>',emailSubject:'تأكيدك'});assert.equal(saved.status,200);assert.equal((await request(h,'config')).data.settings.title,'عنوان جديد <script>');
  assert.equal((await signup(h,'paused@example.com')).status,503);assert.equal((await request(h,'confirm',{token:pendingToken})).status,503);
  await h.request('/subscriptions/settings','PUT',{enabled:true});
 });
 await t.test('QR is generated locally from the selected public campaign link',async()=>{
  const qr=await h.request('/subscriptions/qr?source='+campaign.subscription_code);assert.equal(qr.status,200);assert.match(qr.data,/<svg/);assert.doesNotMatch(qr.data,/example.com/);
 });
 await t.test('database backed request throttling survives requests without adding contacts',async()=>{
  await h.query("UPDATE message_subscription_limits SET hits=120 WHERE key LIKE 'ip:%'");assert.equal((await signup(h,'rate@example.com')).status,429);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='rate@example.com'")).rows.length,0);
 });
});

test('email sharing preserves existing mail and exposes campaign code without recipient data',()=>{
 const base={subject:'مرحبًا',body:'فكرة جديدة',person:{name:'أحمد',email:'private@example.com'},settings:{designVersion:3},unsubscribeUrl:'https://example.com/unsubscribe'};
 assert.doesNotMatch(renderMail(base).html,/subscribe.html/);
 const source='12345678-1234-1234-1234-123456789012';
 for(const designVersion of [1,2,3]){
  const config=mailSettings({designVersion,shareEnabled:true,shareText:'المعرفة <للجميع>',shareLabel:'شارك الآن'});assert.equal(config.shareEnabled,true);
  const mail=renderMail({...base,shareUrl:subscriptionUrl(source,true),settings:config});assert.match(mail.html,/المعرفة &lt;للجميع&gt;/);assert.match(mail.html,/subscribe.html\?source=12345678/);assert.doesNotMatch(mail.html,/private@example.com/);assert.match(mail.text,/شارك الآن/);assert.match(mail.html,/example.com\/unsubscribe/);
 }
 assert.doesNotMatch(renderMail({...base,shareUrl:'javascript:alert(1)',settings:{designVersion:3,shareEnabled:true}}).html,/javascript|subscribe.html/);
 assert.equal(subscriptionUrl('not-a-campaign'),subscriptionUrl());
});
