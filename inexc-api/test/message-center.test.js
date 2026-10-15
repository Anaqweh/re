import {subscriptionUrl} from '../message-subscription-links.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseDelimited, contactsFromRows, worksheetRows, readContactFile } from '../message-contacts.js';
import { richTextPrefix, normaliseMessageBody, renderMessageBody, messageText, messageDirection } from '../message-format.js';
import { blockedEmails, deliveryUnsubscribeUrl } from '../message-suppression.js';
import { renderMail } from '../message-mail.js';
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('const alertEmailPattern'), source.indexOf('\nconst unsubscribeUrl'));
function helpers(extra = {}) {
  const context = vm.createContext({
    clean: (v,n=400) => String(v??'').trim().slice(0,n),
    URL, Date, process, renderMail, subscriptionUrl, blockedEmails, deliveryUnsubscribeUrl, applyMessageEvent:async()=>{}, setTimeout: fn => { fn(); }, console, normaliseMessageBody, renderMessageBody, messageText, messageDirection,
    escapeHtml: v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    emailShell: v => JSON.stringify(v),
    emailPreferenceUnsubscribeUrl: () => 'https://example.com/unsubscribe',
    resendApiKey: 'TEST-ONLY', ...extra
  });
  vm.runInContext(functions, context);
  return context;
}
test('Arabic CSV retains quoted names, BOM, commas, newlines and blank emails', () => {
  const rows = parseDelimited('\ufeffالاسم,البريد\r\n"أحمد، علي",A@EXAMPLE.COM\r\n"غادة\nعناقوة",\r\n"A ""B""",b@example.com', ',');
  assert.deepEqual(contactsFromRows(rows), [{name:'أحمد، علي',email:'A@EXAMPLE.COM'},{name:'غادة\nعناقوة',email:''},{name:'A "B"',email:'b@example.com'}]);
  assert.throws(() => parseDelimited('"unfinished', ','));
});
test('English aliases, tabs and email-only/name-only files import correctly', () => {
  assert.deepEqual(contactsFromRows(parseDelimited('full_name\te-mail\nTest\tuser@example.com', '\t')), [{name:'Test',email:'user@example.com'}]);
  assert.deepEqual(contactsFromRows([['one@example.com'],['اسم منفرد']]), [{name:'',email:'one@example.com'},{name:'اسم منفرد',email:''}]);
});
test('Excel shared strings and multiple sheets preserve names including name-only rows', async () => {
  const rows = await readContactFile({originalname:'test.xlsx',path:fileURLToPath(new URL('./fixtures/shared-contacts.xlsx',import.meta.url))});
  assert.equal(rows.length,3); assert.equal(rows[0].name,'أحمد، علي'); assert.equal(rows[1].name,'اسم بلا بريد'); assert.equal(rows[2].name,'غادة عناقوة');
});
test('Excel inline strings decode text safely and retain sparse columns', async () => {
  const rows = await readContactFile({originalname:'test.xlsx',path:fileURLToPath(new URL('./fixtures/inline-contacts.xlsx',import.meta.url))});
  assert.deepEqual(rows,[{name:'A & B <Team>',email:'team@example.com'},{name:'Name only',email:''}]);
  assert.deepEqual(worksheetRows('<row><c r="C2" t="inlineStr"><is><t>اسم</t></is></c></row>'),[['','','اسم']]);
});
test('Contacts normalize and deduplicate email without dropping name-only records', () => {
  const h=helpers(); const result=h.normaliseMessageContacts([{name:'أحمد',email:'A@example.com'},{name:'duplicate',email:'a@example.com'},{name:'بدون بريد'},{name:'Invalid',email:'broken'}],3000);
  assert.equal(result.length,3); assert.equal(result[0].email,'a@example.com'); assert.equal(result[1].name,'بدون بريد');
  assert.throws(()=>h.normaliseMessageContacts([{name:'a'},{name:'b'}],1),/الحد الأقصى/);
});
test('Recipient resolution deduplicates and respects unsubscribe preferences', async () => {
  const h=helpers({pool:{query:async () => ({rows:[{email:'no@example.com',marketing_opt_out:true}]})}});
  const result=await h.resolveMessageRecipients({audience:'custom',recipientRows:[{name:'A',email:'YES@example.com'},{email:'yes@example.com'},{email:'no@example.com'},{name:'Name only'}]});
  assert.equal(result.totalCandidates,2); assert.equal(result.recipients.length,1); assert.equal(result.skippedUnsubscribed,1);
  await assert.rejects(()=>h.resolveMessageRecipients({audience:'custom',recipientRows:[{name:'Only a name'}]}),/لا يوجد عنوان بريد/);
});
test('Template variables stay plain text, unsafe URLs are rejected', () => {
  const h=helpers(); const rendered=h.messageEmailMarkup({subject:'<b>{{name}}</b>',body:'Line 1\n<script>bad</script>',person:{name:'A & B'},ctaLabel:'open',ctaUrl:'javascript:alert(1)'});
  const markup=JSON.parse(rendered.html);
  assert.equal(markup.title,'&lt;b&gt;A &amp; B&lt;/b&gt;'); assert.ok(markup.preview.includes('&lt;script&gt;'));
  assert.ok(markup.content.includes('Line 1</p>'));assert.ok(!markup.content.includes('<script>'));assert.ok(!markup.content.includes('javascript:'));
});
test('Message emails explicitly align Arabic right and English left in their content', () => {
  const h=helpers();
  for (const [body, direction, align] of [['مرحبًا بكم في برامجنا التدريبية', 'rtl', 'right'], ['Welcome to our training programs', 'ltr', 'left']]) {
    const markup=JSON.parse(h.messageEmailMarkup({subject:'Test',body}).html);
    assert.equal(markup.direction,direction);
    assert.ok(markup.content.includes(`dir="${direction}"`));
    assert.ok(markup.content.includes(`text-align:${align}`));
  }
});
test('Email shell places direction and alignment directly on the content table cell', () => {
  const context=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function emailShell('),source.indexOf('\nasync function sendEmail')),context);
  for (const [direction,align] of [['rtl','right'],['ltr','left']]) {
    const html=context.emailShell({title:'Test',preview:'Test',content:'body',direction});
    assert.ok(html.includes(`<td dir="${direction}" align="${align}"`));
    assert.ok(html.includes(`direction:${direction};text-align:${align}`));
  }
});
test('Worker runs once while busy and releases its database lock', async () => {
  let releaseDue, releases=0, claimed=0, unlocks=0;
  const wait=new Promise(resolve=>releaseDue=resolve);
  const client={query:async sql=>{if(sql.includes('pg_try'))return {rows:[{locked:true}]};if(sql.includes('pg_advisory_unlock')){unlocks++;return {rows:[]}};claimed++;await wait;return {rows:[]};},release:()=>releases++};
  const h=helpers({pool:{connect:async()=>client}});
  const first=h.processScheduledMessageCampaigns();await new Promise(resolve=>setImmediate(resolve));await h.processScheduledMessageCampaigns();releaseDue();await first;
  assert.equal(claimed,1);assert.equal(releases,1);assert.equal(unlocks,1);
});
test('Delivery skips unsubscribed contacts, sends with idempotency key, and marks stale uncertainty failed', async()=>{
  const sent=[], updates=[];
  const richBody=richTextPrefix+JSON.stringify({direction:'auto',blocks:[{type:'paragraph',runs:[{text:'{{name}}',bold:true}]}]});
  const rows=[{id:'1',email:'yes@example.com',recipient_name:'Yes'},{id:'2',email:'no@example.com'},{id:'3',email:'old@example.com',attempted_at:new Date(Date.now()-25*3600000)}];
  const h=helpers({pool:{query:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM email_campaigns'))return {rows:[{status:'sending',subject:'Hello',body:richBody}]};
    if(sql.startsWith('SELECT id,email'))return {rows};
    if(sql.startsWith('SELECT count'))return {rows:[{sent:1,failed:1}]};updates.push({sql,args});return {rows:[]};}},getEmailPreference:async email=>({marketing_opt_out:email==='no@example.com'}),sendEmail:async message=>{sent.push(message);return{id:'mail-1'}}});
  await h.deliverMessageCampaign('campaign');assert.equal(sent.length,1);assert.equal(sent[0].idempotencyKey,'message/1');
  assert.ok(sent[0].html.includes('<strong>Yes</strong>'));assert.ok(!sent[0].html.includes('INEXC-RICH-TEXT'));
  assert.ok(updates.some(v=>v.sql.includes("status='skipped'"))); assert.ok(updates.some(v=>v.sql.includes("status='failed'")));
  assert.equal(updates.at(-1).args[0],'partial');
});
test('All excluded recipients never report provider acceptance', async()=>{
  const updates=[];
  const h=helpers({pool:{query:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM email_campaigns'))return {rows:[{status:'sending',subject:'Test',body:'Test'}]};
    if(sql.startsWith('SELECT id,email'))return {rows:[{id:'excluded',email:'no@example.com'}]};
    if(sql.startsWith('SELECT count'))return {rows:[{sent:0,failed:0}]};
    updates.push({sql,args});return {rows:[]};
  }},getEmailPreference:async()=>({marketing_opt_out:true}),sendEmail:async()=>{assert.fail('Excluded recipients must not reach provider')}});
  await h.deliverMessageCampaign('campaign');
  assert.equal(updates.at(-1).args[0],'completed');
});

test('upgrading preserves previous retry payload and headers while new deliveries retain their own unsubscribe token', async()=>{
  const sent=[];
  const snapshot={subject:'Original',html:'<p>Original</p>',text:'Original'};
  const rows=[{id:'old-attempt',email:'old-attempt@example.com',attempted_at:new Date(),payload_snapshot:snapshot},{id:'new-attempt',email:'new-attempt@example.com',unsubscribe_token:'unique-delivery-token'}];
  const h=helpers({pool:{query:async(sql)=>{
    if(sql.startsWith('SELECT * FROM email_campaigns'))return{rows:[{status:'sending',subject:'New',body:'Welcome'}]};
    if(sql.startsWith('SELECT id,email'))return{rows};if(sql.startsWith('SELECT count'))return{rows:[{sent:2,failed:0}]};return{rows:[]};
  }},getEmailPreference:async()=>({marketing_opt_out:false,unsubscribe_token:'legacy'}),sendEmail:async mail=>{sent.push(mail);return{id:'provider'}}});
  await h.deliverMessageCampaign('campaign');assert.equal(sent.length,2);assert.equal(sent[0].html,snapshot.html);assert.deepEqual(JSON.parse(JSON.stringify(sent[0].headers)),{'List-Unsubscribe':'<https://example.com/unsubscribe>'});
  assert.match(sent[1].headers['List-Unsubscribe'],/unique-delivery-token/);assert.equal(sent[1].headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
});

test('registration CSV hides opted-out addresses while retaining transaction rows and fails closed',async()=>{
  const routeSource=source.split('\n').find(line=>line.startsWith("app.get('/api/admin/export.csv'"));
  let handler,output,error;
  const rows=[{reference:'REG-1',name:'Blocked',email:' BLOCKED@EXAMPLE.COM ',total:100},{reference:'REG-2',name:'Allowed',email:'allowed@example.com',total:200}];
  const pool={query:async(sql)=>({rows:sql.startsWith('SELECT reference')?rows:[{email:'blocked@example.com'}]})};
  const context=vm.createContext({app:{get:(_path,_auth,fn)=>handler=fn},auth:()=>{},pool,blockedEmails,normalizeEmail:value=>String(value||'').trim().toLowerCase()});
  vm.runInContext(routeSource,context);
  const response={set(){return this},send(v){output=v}};
  await handler({},response,e=>error=e);assert.equal(error,undefined);assert.match(output,/REG-1/);assert.match(output,/100/);assert.match(output,/allowed@example.com/);assert.doesNotMatch(output,/blocked@example.com/i);
  process.env.MESSAGE_SUPPRESSION_REMOTE_URL='http://invalid.example';process.env.MESSAGE_SUPPRESSION_SYNC_KEY='x'.repeat(40);
  try{output=null;await handler({},response,e=>error=e);assert.equal(error.status,503);assert.equal(output,null);}finally{delete process.env.MESSAGE_SUPPRESSION_REMOTE_URL;delete process.env.MESSAGE_SUPPRESSION_SYNC_KEY;}
});

test('new campaign sharing uses its campaign source code when the worker renders delivery',async()=>{
  const sent=[],subscription_code='11111111-2222-3333-4444-555555555555';
  const h=helpers({pool:{query:async(sql)=>{
    if(sql.startsWith('SELECT * FROM email_campaigns'))return{rows:[{status:'sending',subject:'Share',body:'Knowledge',subscription_code,settings:{designVersion:3,shareEnabled:true}}]};
    if(sql.startsWith('SELECT id,email'))return{rows:[{id:'new',email:'recipient@example.com',unsubscribe_token:'own-token'}]};
    if(sql.startsWith('SELECT count'))return{rows:[{sent:1,failed:0}]};return{rows:[]};
  }},getEmailPreference:async()=>({marketing_opt_out:false}),sendEmail:async mail=>{sent.push(mail);return{id:'stub'}}});
  await h.deliverMessageCampaign('campaign');assert.equal(sent.length,1);assert.match(sent[0].html,new RegExp('source='+subscription_code));assert.doesNotMatch(sent[0].html,/recipient@example.com/);assert.match(sent[0].headers['List-Unsubscribe'],/own-token/);
});
