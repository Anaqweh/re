import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseDelimited, contactsFromRows, worksheetRows, readContactFile } from '../message-contacts.js';
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('const alertEmailPattern'), source.indexOf('\nconst unsubscribeUrl'));
function helpers(extra = {}) {
  const context = vm.createContext({
    clean: (v,n=400) => String(v??'').trim().slice(0,n),
    URL, Date, setTimeout: fn => { fn(); }, console,
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
  assert.equal(rows.length,4); assert.equal(rows[0].name,'أحمد، علي'); assert.equal(rows[1].name,'اسم بلا بريد'); assert.equal(rows[3].name,'غادة عناقوة');
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
  assert.ok(markup.content.includes('Line 1<br>'));assert.ok(!markup.content.includes('<script>'));assert.ok(!markup.content.includes('javascript:'));
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
  const rows=[{id:'1',email:'yes@example.com',recipient_name:'Yes'},{id:'2',email:'no@example.com'},{id:'3',email:'old@example.com',attempted_at:new Date(Date.now()-25*3600000)}];
  const h=helpers({pool:{query:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM email_campaigns'))return {rows:[{status:'sending',subject:'Hello',body:'{{name}}'}]};
    if(sql.startsWith('SELECT id,email'))return {rows};
    if(sql.startsWith('SELECT count'))return {rows:[{sent:1,failed:1}]};updates.push({sql,args});return {rows:[]};}},getEmailPreference:async email=>({marketing_opt_out:email==='no@example.com'}),sendEmail:async message=>{sent.push(message);return{id:'mail-1'}}});
  await h.deliverMessageCampaign('campaign');assert.equal(sent.length,1);assert.equal(sent[0].idempotencyKey,'message/1');
  assert.ok(updates.some(v=>v.sql.includes("status='skipped'"))); assert.ok(updates.some(v=>v.sql.includes("status='failed'")));
  assert.equal(updates.at(-1).args[0],'partial');
});
