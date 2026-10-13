import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHarness } from './studio-harness.js';
import { richTextPrefix, renderMessageBody, normaliseMessageBody } from '../message-format.js';
import { renderMail } from '../message-mail.js';
const uid=()=>crypto.randomUUID();
const content={subject:'مرحبًا {{name}}',message:'رسالة عربية\nWelcome to INEXC',extraRecipients:'Example, one@example.com',audience:'custom',preheader:'تمهيد الرسالة'};

test('Studio database and HTTP integration, with all mail intercepted',async t=>{
 const h=await createHarness();t.after(()=>h.close());const api=h.request;
 await t.test('authentication required; additive migration preserves original records',async()=>{assert.equal((await api('/settings','GET',undefined,{headers:{Authorization:''}})).status,401);assert.equal((await api('/settings')).data.timezone,'Asia/Dubai')});
 const draftId=uid();let version;
 await t.test('draft persists/reopens, repeated save is idempotent, stale edit cannot overwrite',async()=>{
  const saved=await api('/drafts/'+draftId,'PUT',{version:0,payload:content});assert.equal(saved.status,200,JSON.stringify(saved));version=saved.data.version;
  const repeated=await api('/drafts/'+draftId,'PUT',{version:0,payload:content});assert.equal(repeated.status,200);assert.equal(repeated.data.version,version);
  assert.equal((await api('/drafts/'+draftId)).data.payload.preheader,content.preheader);
  assert.equal((await api('/drafts/'+draftId,'PUT',{version:0,payload:{...content,subject:'stale'}})).status,409);
  const changed=await api('/drafts/'+draftId,'PUT',{version,payload:{...content,subject:'New subject'}});assert.equal(changed.status,200);version=changed.data.version;
  const versions=(await api('/drafts/'+draftId+'/versions')).data;assert.equal(versions.length,2);assert.equal(versions[1].payload.subject,content.subject);
 });
 await t.test('rich Arabic/English/image/button/heading/color/paragraph direction survive preview and plain text',async()=>{
  const message=richTextPrefix+JSON.stringify({direction:'auto',blocks:[{type:'heading',direction:'rtl',align:'center',runs:[{text:'مرحبا {{name}}',bold:true,color:'#0866c6'}]},{type:'paragraph',direction:'ltr',runs:[{text:'English paragraph',italic:true}]},{type:'image',src:'https://example.com/a.png',alt:'صورة الورشة',runs:[]},{type:'button',href:'https://example.com/register',runs:[{text:'Register'}]},{type:'divider',runs:[]}]});
  const result=await api('/preview','POST',{payload:{...content,message,fallbackName:'صديقنا'}});assert.equal(result.status,200);assert.match(result.data.html,/<h2[^>]*text-align:center/);assert.match(result.data.html,/<strong><span[^>]*>مرحبا صديقنا<\/span><\/strong>/);assert.match(result.data.html,/alt="صورة الورشة"/);assert.match(result.data.html,/dir="ltr"/);assert.match(result.data.text,/English paragraph/);assert.match(result.data.html,/تمهيد الرسالة/);assert.ok(!result.data.html.includes('INEXC-RICH-TEXT'));
  assert.equal(renderMessageBody(normaliseMessageBody(message)).direction,'rtl');
 });
 let contactId,listId;
 await t.test('CSV review preserves invalid, duplicate, unnamed and metadata; import never silently saves',async()=>{
  const form=new FormData();form.append('file',new Blob(['Name,Email,Language,Tags\nAhmad,ONE@example.com,ar,teachers\nAgain,one@example.com,en,\nBad,broken@,ar,\nNameless,,ar,\n,two@example.com,en,']), 'contacts.csv');
  const review=await api('/import/inspect','POST',form);assert.equal(review.status,200,JSON.stringify(review));assert.equal(review.data.counts.duplicate,1);assert.equal(review.data.counts.invalid,1);assert.equal(review.data.counts.missing,1);assert.equal((await api('/contacts')).data.total,0);
  assert.equal((await api('/import/commit','POST',{rows:review.data.rows})).status,400);
  review.data.rows[2].email='corrected@example.com';
  const saved=await api('/import/commit','POST',{rows:review.data.rows,listName:'المعلمون',source:'contacts.csv'});assert.equal(saved.status,201,JSON.stringify(saved));assert.equal(saved.data.added,4);listId=saved.data.listId;
  const all=(await api('/contacts')).data.rows;contactId=all.find(r=>r.email==='one@example.com').id;assert.equal(all.find(r=>r.id===contactId).language,'ar');assert.deepEqual(all.find(r=>r.id===contactId).tags,['teachers']);
  const repeated=await api('/import/commit','POST',{rows:[{name:'Overwrite attempt',email:'one@example.com'}]});assert.equal(repeated.data.added,0);assert.equal((await api('/contacts?search=one%40example')).data.rows[0].full_name,'Ahmad');
 });
 await t.test('manual column mapping, XLSX and PDF inspect return reviewed rows',async()=>{
  const mapped=await api('/import/inspect','POST',{table:[['Person','Address'],['Jane','jane@example.com']],mapping:{name:0,email:1,header:true}});assert.equal(mapped.data.rows[0].email,'jane@example.com');
  for(const file of ['prefixed-contacts.xlsx','contacts.docx','contacts.pdf','contacts.png']){const form=new FormData();form.append('file',new Blob([await fs.readFile(new URL('./fixtures/'+file,import.meta.url))]),file);const result=await api('/import/inspect','POST',form);assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.data.rows.length>0);if(file==='contacts.png')assert.equal(result.data.ocrUsed,true);}
 });
 await t.test('filters, global deduplication, contact update and CSV formula protection',async()=>{
  assert.equal((await api('/contacts?language=ar')).data.total,3);assert.equal((await api('/contacts?listId='+listId)).data.total,4);
  assert.equal((await api('/contacts','POST',{name:'Duplicate',email:'one@example.com'})).status,409);
  assert.equal((await api('/contacts/'+contactId,'PUT',{name:'=SUM(A1)',email:'one@example.com',language:'en',tags:['teachers']})).status,200);
  const exported=await api('/contacts-export');assert.match(exported.data,/'=SUM\(A1\)/);
 });
 await t.test('selection freezes exact IDs; newly added matching record is not deleted',async()=>{
  const selection=(await api('/contacts/selection','POST',{all:true,filters:{status:'missing'}})).data;assert.equal(selection.count,1);
  await api('/contacts','POST',{name:'New name only'});
  const deleted=await api('/contacts/bulk','POST',{...selection,action:'delete'});assert.equal(deleted.data.affected,1);assert.equal((await api('/contacts?status=missing')).data.total,1);
  assert.equal((await api('/contacts/bulk','POST',{...selection,action:'delete'})).status,400);
 });
 await t.test('bulk tagging and group membership apply only selected contacts',async()=>{
  const selection=(await api('/contacts/selection','POST',{ids:[contactId]})).data;
  assert.equal((await api('/contacts/bulk','POST',{...selection,action:'tag',tags:'VIP,teachers'})).data.affected,1);
  assert.equal((await api('/contacts?tag=VIP')).data.total,1);
 });
 let campaignId;
 await t.test('submission is idempotent across repeated and concurrent requests',async()=>{
  const results=await Promise.all([api('/drafts/'+draftId+'/submit','POST',{version}),api('/drafts/'+draftId+'/submit','POST',{version})]);
  assert.equal(results[0].status,202,JSON.stringify(results));assert.equal(results[0].data.id,results[1].data.id);campaignId=results[0].data.id;
  assert.equal((await h.query('SELECT count(*)::int AS n FROM email_deliveries WHERE campaign_id=$1',[campaignId])).rows[0].n,1);
  assert.equal((await api('/drafts/'+draftId,'PUT',{version,payload:content})).status,409);
 });
 await t.test('Dubai scheduling/edit/cancel succeeds; enqueued campaigns are not editable',async()=>{
  const draft=uid(),scheduledAt='2099-10-12T22:00:00+04:00';
  const saved=await api('/drafts/'+draft,'PUT',{version:0,payload:{...content,scheduledAt}});
  const queued=await api('/drafts/'+draft+'/submit','POST',{version:saved.data.version});assert.equal(queued.status,202);assert.equal(queued.data.status,'scheduled');assert.match(queued.data.scheduled_at,/18:00:00/);
  assert.equal((await api('/campaigns/'+queued.data.id,'PUT',{payload:{...content,subject:'Edited schedule',scheduledAt:'2099-10-13T18:00:00Z'}})).status,200);
  assert.equal((await api('/campaigns/'+queued.data.id+'/cancel','POST',{})).status,200);
  assert.equal((await api('/campaigns/'+queued.data.id,'PUT',{payload:{...content,scheduledAt}})).status,409);
  assert.equal((await api('/campaigns/'+campaignId,'PUT',{payload:{...content,scheduledAt}})).status,409);
 });
 await t.test('unsubscribe, suppression and previous audience exclusion prevent recipients',async()=>{
  await h.query("INSERT INTO email_preferences(email,unsubscribe_token,marketing_opt_out) VALUES('one@example.com','test-unsub',true)");
  const review=await api('/review','POST',{payload:content});assert.equal(review.data.ready,0);assert.equal(review.data.unsubscribed,1);
  const old=await api('/review','POST',{payload:{...content,audience:'previous',campaignId,excludeCampaignId:campaignId}});assert.equal(old.data.ready,0);
  await h.query("UPDATE message_contacts SET suppressed=true WHERE email='two@example.com'");const suppressed=await api('/review','POST',{payload:{...content,extraRecipients:'two@example.com'}});assert.equal(suppressed.data.ready,0);
 });
 await t.test('retry selects transient failures only within safe window, preserving accepted mail',async()=>{
  await h.query("UPDATE email_campaigns SET status='partial' WHERE id=$1",[campaignId]);
  await h.query("UPDATE email_deliveries SET status='sent',resend_email_id='accepted-1' WHERE campaign_id=$1",[campaignId]);
  await h.query("INSERT INTO email_deliveries(campaign_id,email,status,retryable,attempted_at) VALUES($1,'retry@example.com','failed',true,now()),($1,'stale@example.com','failed',true,now()-interval '25 hours'),($1,'permanent@example.com','failed',false,now())",[campaignId]);
  assert.equal((await api('/campaigns/'+campaignId+'/retry','POST',{})).data.queued,1);
  const rows=(await api('/campaigns/'+campaignId)).data.deliveries;assert.equal(rows.find(r=>r.resend_email_id==='accepted-1').status,'sent');assert.equal(rows.find(r=>r.email==='stale@example.com').status,'failed');
 });
 await t.test('test send is explicit, intercepted and sequential replay does not duplicate',async()=>{
  assert.equal(h.sent.length,0);const req={requestId:uid(),email:'test@example.com',payload:content};
  assert.equal((await api('/test','POST',req)).status,200);assert.equal((await api('/test','POST',req)).status,200);assert.equal(h.sent.length,1);assert.ok(h.sent[0].text);assert.match(h.sent[0].html,/إلغاء الاشتراك/);
  assert.equal((await api('/test','POST',{...req,payload:{...content,subject:'Changed'}})).status,409);
 });
 await t.test('templates, reusable blocks, settings and history persist without reporting fake delivery',async()=>{
  const template=uid(),block=uid();assert.equal((await api('/templates/'+template,'PUT',{name:'قالب',payload:content})).status,200);assert.equal((await api('/templates')).data[0].settings.preheader,content.preheader);
  assert.equal((await api('/blocks/'+block,'PUT',{name:'توقيع',body:'توقيع المدرب'})).status,200);assert.equal((await api('/blocks')).data.length,1);assert.equal((await api('/blocks/'+block,'DELETE')).status,200);
  assert.equal((await api('/settings','PUT',{brandColor:'#0866c6',signature:'INEXC'})).status,200);
  const overview=(await api('/overview')).data;assert.equal(overview.accepted,1);assert.equal(overview.delivered,0);assert.equal(overview.webhookEnabled,false);assert.ok((await api('/contacts/'+contactId+'/history')).data.length>0);
 });
});

test('mail renderer escapes malicious content and default fallback is meaningful',()=>{const result=renderMail({subject:'Hello {{name}}',body:'Welcome {{name}}\n<script>alert(1)</script>',person:{name:'<img src=x>'},settings:{logoUrl:'javascript:bad',brandColor:'red;position:absolute'},unsubscribeUrl:'https://example.com/unsubscribe'});assert.ok(!result.html.includes('<script>'));assert.ok(!result.html.includes('<img src=x>'));assert.match(result.html,/&lt;img/);assert.match(renderMail({subject:'Hello {{name}}',body:'Welcome'}).subject,/friend/)});

test('signed provider events require fresh signatures, remain cumulative, and replay early delivery evidence',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 const key=Buffer.from('LOCAL-WEBHOOK-TEST-ONLY');let handler;
 const context=vm.createContext({app:{post:(_path,_parser,fn)=>{handler=fn}},express:{raw:()=>null},pool:h.pool,crypto,Buffer,Date,console,
  process:{env:{RESEND_WEBHOOK_SECRET:'whsec_'+key.toString('base64')}},clean:(v,n)=>String(v??'').trim().slice(0,n)});
 vm.runInContext(source.slice(source.indexOf("app.post('/api/webhooks/resend'"),source.indexOf('app.use(express.json')),context);
 const invoke=async(type,{emailId='provider-1',timestamp=Math.floor(Date.now()/1000),badSignature=false,id=uid()}={})=>{
  const raw=JSON.stringify({type,data:{email_id:emailId}}),signature=crypto.createHmac('sha256',key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  const result={status:200};const response={status(n){result.status=n;return this},json(data){result.data=data;return this}};
  await handler({body:Buffer.from(raw),headers:{'svix-id':id,'svix-timestamp':String(timestamp),'svix-signature':'v1,'+(badSignature?'invalid':signature)}},response);return result;
 };
 const campaign=(await h.query("INSERT INTO email_campaigns(subject,body,audience) VALUES('Test','Test','custom') RETURNING id")).rows[0].id;
 await h.query("INSERT INTO email_deliveries(campaign_id,email,status,resend_email_id) VALUES($1,'webhook@example.com','sent','provider-1')",[campaign]);
 await h.query("INSERT INTO message_contacts(full_name,email,normalized_email) VALUES('Test','webhook@example.com','webhook@example.com')");
 assert.equal((await invoke('email.delivered',{timestamp:Math.floor(Date.now()/1000)-600})).status,401);
 assert.equal((await invoke('email.delivered',{badSignature:true})).status,401);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM message_webhook_events')).rows[0].n,0);
 const eventId=uid();assert.equal((await invoke('email.clicked',{id:eventId})).status,200);await invoke('email.clicked',{id:eventId});
 await invoke('email.sent');
 let delivery=(await h.query("SELECT * FROM email_deliveries WHERE resend_email_id='provider-1'")).rows[0];
 assert.equal(delivery.status,'clicked');assert.ok(delivery.clicked_at);assert.equal(delivery.delivered_at,null);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM message_webhook_events WHERE id=$1',[eventId])).rows[0].n,1);
 await invoke('email.delivered');delivery=(await h.query("SELECT * FROM email_deliveries WHERE resend_email_id='provider-1'")).rows[0];
 assert.equal(delivery.status,'clicked');assert.ok(delivery.delivered_at);
 await invoke('email.bounced');await invoke('email.sent');
 assert.equal((await h.query("SELECT status FROM email_deliveries WHERE resend_email_id='provider-1'")).rows[0].status,'bounced');
 assert.equal((await h.query("SELECT suppressed FROM message_contacts WHERE email='webhook@example.com'")).rows[0].suppressed,true);
 assert.equal((await h.query("SELECT marketing_opt_out FROM email_preferences WHERE email='webhook@example.com'")).rows[0].marketing_opt_out,true);
 await invoke('email.delivered',{emailId:'early-provider'});
 await h.query("INSERT INTO email_deliveries(campaign_id,email,status,resend_email_id) VALUES($1,'early@example.com','sent','early-provider')",[campaign]);
 for(const event of (await h.query("SELECT type FROM message_webhook_events WHERE email_id='early-provider' ORDER BY received_at")).rows)await context.applyMessageEvent('early-provider',event.type);
 assert.ok((await h.query("SELECT delivered_at FROM email_deliveries WHERE resend_email_id='early-provider'")).rows[0].delivered_at);
});
