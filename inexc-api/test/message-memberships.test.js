import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createHarness} from './studio-harness.js';
import {membershipEmailPayload,membershipFeatures} from '../../message-memberships.js';
import {renderMail,mailIdentityDefaults} from '../message-mail.js';
import {richTextPrefix,normaliseMessageBody,messageText,messageDirection} from '../message-format.js';
import {emailFonts,fontStack,fontCSS} from '../message-design.js';

const plans=[
  {id:'launch',name:'بطاقة الانطلاقة',priceUsd:39.5,validMonths:4,featureLines:'ميزة الانطلاقة الأولى\nميزة الانطلاقة الثانية',active:true,remaining:9},
  {id:'mastery',name:'بطاقة التمكّن',priceUsd:79,validMonths:6,featureLines:'ميزة التمكّن',active:true,remaining:5},
  {id:'leadership',name:'بطاقة الريادة',priceUsd:179,validMonths:12,featureLines:'ميزة الريادة',active:true,remaining:0},
  {id:'hidden',name:'بطاقة مخفية',priceUsd:1,active:false}
];
const packageNames={launch:'باقة الانطلاقة',mastery:'باقة التمكّن',leadership:'باقة الريادة',hidden:'باقة مخفية'};
const waitFor=async fn=>{for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected email builder state was not reached');};

test('one, two and all selections preserve current plan data without changing it',()=>{
  const before=structuredClone(plans);
  for(const ids of [['mastery'],['launch','leadership'],plans.map(p=>p.id)]){
    const payload=membershipEmailPayload(plans,ids),text=messageText(payload.message);
    for(const plan of plans)assert.equal(text.includes(packageNames[plan.id]),ids.includes(plan.id)&&plan.active);
    assert.equal(payload.audience,'custom');assert.equal(payload.extraRecipients,'');assert.equal(payload.scheduledAt,'');
    assert.equal(payload.ctaUrl,'');
    const footer=JSON.parse(payload.message.slice(richTextPrefix.length)).blocks.at(-1);assert.equal(footer.href,'https://www.inexctraining.com/cards/');assert.equal(footer.button.align,'center');
  }
  assert.deepEqual(plans,before);
  assert.match(messageText(membershipEmailPayload(plans,['launch']).message),/39.50 USD/);
  assert.match(messageText(membershipEmailPayload(plans,['leadership']).message),/غير متاحة للشراء/);
  assert.throws(()=>membershipEmailPayload(plans,[]),/اختر باقة/);
  assert.throws(()=>membershipEmailPayload([{...plans[0],priceUsd:null}],['launch']),/السعر|سعرها/);
  assert.deepEqual(membershipFeatures({bookingUnits:6,courseUnitCost:2,diplomaUnitCost:3}),['رصيد يتيح حجز حتى 3 من الدورات أو حتى 2 من الدبلومات']);
});

test('email escapes plan content and never uses a legacy payment link',()=>{
  const malicious={...plans[0],name:'<img src=x onerror=alert(1)>',featureLines:'<script>bad()</script>',paymentLink:'javascript:alert(1)'};
  const p=membershipEmailPayload([malicious],['launch']);
  const mail=renderMail({subject:p.subject,body:p.message,settings:p,ctaLabel:p.ctaLabel,ctaUrl:p.ctaUrl});
  assert.match(mail.html,/&lt;img/);assert.doesNotMatch(mail.html,/<script>|<img src=x|javascript:alert/);
});

test('existing API saves and renders selected cards and templates without sending',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  for(const ids of [['launch'],['mastery','leadership'],['launch','mastery','leadership']]){
    const payload={...membershipEmailPayload(plans,ids),extraRecipients:'preview@example.com'};
    const saved=await h.request('/drafts/'+crypto.randomUUID(),'PUT',{version:0,payload});assert.equal(saved.status,200);
    const preview=await h.request('/preview','POST',{payload:saved.data.payload});assert.equal(preview.status,200);
    for(const plan of plans)assert.equal(preview.data.html.includes(packageNames[plan.id]),ids.includes(plan.id));
    assert.match(preview.data.html,/إلغاء الاشتراك/);assert.match(preview.data.html,/inexctraining.com\/cards\//);
    const rendered=new JSDOM(preview.data.html),links=[...rendered.window.document.querySelectorAll('a[href]')];
    for(const plan of plans){
      const details=links.filter(a=>a.getAttribute('href')==='https://www.inexctraining.com/cards/?plan='+plan.id);
      const book=links.filter(a=>a.getAttribute('href')==='https://www.inexctraining.com/cards/?book='+plan.id);
      assert.equal(details.length,ids.includes(plan.id)?1:0);assert.equal(book.length,ids.includes(plan.id)&&plan.remaining>0?1:0);
      if(details.length)assert.equal(details[0].textContent,'استعرض الباقة ومزاياها');
    }
    rendered.window.close();
    const template=await h.request('/templates/'+crypto.randomUUID(),'PUT',{name:'باقات مختارة',payload:saved.data.payload});assert.equal(template.status,200);
    assert.equal(template.data.body,saved.data.payload.message);
    const review=await h.request('/review','POST',{payload:saved.data.payload});assert.equal(review.status,200);assert.deepEqual(review.data.issues,[]);
  }
  assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
  assert.equal((await h.query('SELECT count(*)::int AS n FROM email_campaigns')).rows[0].n,0);
});

async function mountBuilder(t,{api=async()=>plans,onCompose=async()=>{}}={}){
  const dom=new JSDOM('<div id="target"></div>',{url:'https://local.test/',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
  Object.assign(w,{richTextPrefix,normaliseMessageBody,renderMail,mailIdentityDefaults});
  w.eval((await fs.readFile(new URL('../../message-memberships.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify('https://local.test/message-memberships.js')));
  await w.mountMembershipEmail({target:w.document.querySelector('#target'),api,onCompose});
  return {w,$:s=>w.document.querySelector(s)};
}

test('selector supports one, two, all and zero; preview is read-only and handoff is single-shot',async t=>{
  const calls=[],handed=[];let finish;
  const e=await mountBuilder(t,{api:async(path,options)=>{calls.push({path,options});return plans},onCompose:p=>{handed.push(p);return new Promise(r=>finish=r)}}),{$,w}=e;
  const select=id=>{const node=$(`[data-membership-id="${id}"]`);node.checked=!node.checked;node.dispatchEvent(new w.Event('change',{bubbles:true}));};
  assert.equal(w.document.querySelectorAll('[data-membership-id]').length,3);
  select('launch');assert.equal($('[data-membership-all]').indeterminate,true);
  assert.doesNotMatch($('[data-membership-preview]').srcdoc,/ميزة الانطلاقة/);
  select('leadership');assert.match($('[data-membership-subject]').value,/باقة التمكّن/);
  select('mastery');assert.equal($('[data-membership-continue]').disabled,true);assert.equal($('[data-membership-preview]').srcdoc,'');
  $('[data-membership-all]').click();assert.equal($('[data-membership-count]').textContent,'3 / 3');
  $('[data-membership-subject]').value='دعوة خاصة';$('[data-membership-subject]').dispatchEvent(new w.Event('input'));select('launch');assert.equal($('[data-membership-subject]').value,'دعوة خاصة');
  $('[data-membership-device="phone"]').click();assert.equal($('.membership-mail-preview-surface').classList.contains('phone'),true);
  $('form').dispatchEvent(new w.Event('submit',{cancelable:true}));$('form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(handed.length,1);finish();
  assert.equal(handed[0].subject,'دعوة خاصة');assert.doesNotMatch(messageText(handed[0].message),/بطاقة الانطلاقة/);
  assert.deepEqual(calls.map(c=>c.path),['/memberships/plans']);assert.equal(calls[0].options.cache,'no-store');
});

test('fetch errors offer retry and empty catalogs cannot create a message',async t=>{
  let attempt=0;const {$}=await mountBuilder(t,{api:async()=>{if(++attempt===1)throw Error('غير متصل');return []}});
  assert.match($('#target').textContent,/غير متصل/);$('[data-membership-retry]').click();
  await waitFor(()=>$('#target').textContent.includes('لا توجد باقات'));assert.equal($('[data-membership-continue]'),null);
});

test('studio entry preserves an existing draft and opens the selected cards in the existing composer',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  const dom=new JSDOM('<div class="tabs"><button id="main"></button></div><div class="wrap"></div>',{url:h.url,runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
  Object.assign(w,{AbortSignal,INEXC_REGISTRATION_ENDPOINT:h.url+'/api',emailFonts,fontStack,fontCSS,renderMail,mailIdentityDefaults,richTextPrefix,normaliseMessageBody,messageText,messageDirection,presets:[],newSubscriberIcon:'',createMessageEditor:element=>({element,setTypography(){}}),fetch:(url,opt={})=>{
    const path=new URL(url).pathname;if(/\/(test|submit|send|retry|release|send-now)$/.test(path))throw Error('Sending is forbidden in this test');
    if(path==='/api/memberships/plans')return Promise.resolve(new Response(JSON.stringify(plans),{status:200,headers:{'Content-Type':'application/json'}}));return fetch(url,opt);
  }});
  w.sessionStorage.setItem('inexc_do_admin','LOCAL-TEST-ONLY');
  for(const filename of ['message-subscriptions-ui.js','message-memberships.js','message-studio-ui.js']){
    const source=await fs.readFile(new URL('../../'+filename,import.meta.url),'utf8');w.eval(source.replace(/^import .*\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(h.url+'/'+filename)));
  }
  const $=s=>w.document.querySelector(s),open=await w.mountMessageStudio($('#main'));await open();
  $('[data-action="new"]').click();await waitFor(()=>!$('[data-panel="compose"]').hidden);
  $('#ms-subject').value='مسودة سابقة';$('#ms-subject').dispatchEvent(new w.Event('input',{bubbles:true}));
  $('#mc-body').value='نص سابق محفوظ';$('#mc-body').dispatchEvent(new w.Event('input',{bubbles:true}));
  await open('membership-email');await waitFor(()=>$('[data-membership-id="launch"]'));
  $('[data-membership-all]').click();$('[data-membership-id="mastery"]').click();$('[data-membership-continue]').click();
  await waitFor(()=>$('#ms-subject').value.includes('باقة التمكّن'));
  assert.equal($('[data-panel="compose"]').hidden,false);assert.match(messageText($('#mc-body').value),/ميزة التمكّن/);assert.doesNotMatch(messageText($('#mc-body').value),/ميزة الانطلاقة/);
  assert.equal($('#ms-recipients').value,'');assert.equal($('#ms-schedule').value,'');
  const drafts=(await h.request('/drafts')).data;assert.equal(drafts.some(d=>d.payload.subject==='مسودة سابقة'&&d.payload.message==='نص سابق محفوظ'),true);
  assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
});
