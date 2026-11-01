import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createHarness} from './studio-harness.js';
import {emailFonts,fontStack,fontCSS} from '../message-design.js';
import {renderMail,mailIdentityDefaults} from '../message-mail.js';
import {messageText,messageDirection,richTextPrefix} from '../message-format.js';
const source=await fs.readFile(new URL('../../message-studio-ui.js',import.meta.url),'utf8');
const waitFor=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected editor state was not reached');};
async function editor(h,storage={},view){
 const dom=new JSDOM('<div class="tabs"><button id="main" data-view="message-center"></button><button data-view="new-subscribers"></button></div><div class="wrap"></div>',{url:h.url,runScripts:'outside-only'}),w=dom.window,requests=[];
 const checkedFetch=(url,opt={})=>{
  const path=new URL(url).pathname,method=opt.method||'GET';requests.push({path,method});
  if(/\/(test|submit|retry|send|release|send-now)$/.test(path)||method!=='GET'&&/\/campaigns(?:\/|$)/.test(path))throw Error('Email and campaign mutations are forbidden in recovery tests');
  return fetch(url,opt);
 };
 Object.assign(w,{fetch:checkedFetch,AbortSignal,INEXC_REGISTRATION_ENDPOINT:h.url+'/api',emailFonts,fontStack,fontCSS,renderMail,mailIdentityDefaults,messageText,messageDirection,richTextPrefix,presets:[],newSubscriberIcon:'',createMessageEditor:element=>({element,setTypography(){}})});
 w.sessionStorage.setItem('inexc_do_admin','LOCAL-TEST-ONLY');for(const [key,value]of Object.entries(storage))w.sessionStorage.setItem(key,value);
 w.eval((await fs.readFile(new URL('../../message-subscriptions-ui.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replaceAll('export ',''));
 w.eval(source.replace(/^import .*\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(h.url+'/message-studio-ui.js')));
 const $=s=>w.document.querySelector(s),open=await w.mountMessageStudio($('#main'));await open(view);
 return{w,$,open,requests,storage:()=>Object.fromEntries(Object.entries(w.sessionStorage)),input:(selector,value)=>{const el=$(selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}
test('refresh recovers last typed characters, formatting and schedule without saving or sending',async t=>{
 const h=await createHarness();t.after(()=>h.close());const a=await editor(h);
 a.$('[data-action="new"]').click();await waitFor(()=>!a.$('[data-panel="compose"]').hidden);
 const content=richTextPrefix+JSON.stringify({direction:'rtl',blocks:[{type:'paragraph',runs:[{text:'آخر حرف قبل التحديث',bold:true}]}]});
 a.input('#ms-subject','جمعة طيبة');a.input('#mc-body',content);a.input('#ms-recipients','teacher@example.com');a.input('#ms-schedule','2026-12-20T09:15');a.input('#ms-cta-enabled',true);a.input('#ms-cta-label','رابط مخصص');a.input('#ms-cta-url','https://example.test/friday');a.input('#ms-cta-enabled',false);
 const stored=a.storage();a.w.close();const b=await editor(h,stored);t.after(()=>b.w.close());
 assert.equal(b.$('#ms-subject').value,'جمعة طيبة');assert.equal(b.$('#mc-body').value,content);assert.equal(b.$('#ms-schedule').value,'2026-12-20T09:15');assert.equal(b.$('#ms-recipients').value,'teacher@example.com');assert.equal(b.$('#ms-cta-enabled').checked,false);assert.equal(b.$('#ms-cta-label').value,'رابط مخصص');
 await new Promise(r=>setTimeout(r,1250));assert.equal(b.requests.some(r=>r.method==='PUT'),false);assert.equal((await h.query('SELECT count(*)::int AS n FROM message_drafts')).rows[0].n,0);assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
});
test('scheduled campaign stays untouched when its unfinished draft resumes after locking or reload',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const campaign=(await h.query("INSERT INTO email_campaigns(subject,body,audience,status,scheduled_at) VALUES('موعد قائم','نص أصلي','custom','scheduled','2026-12-20T05:15:00Z') RETURNING *")).rows[0];
 const draftId=crypto.randomUUID(),payload={designVersion:3,subject:'تعديل لم يؤكد',message:'كتابة محفوظة',audience:'custom',extraRecipients:'teacher@example.com',scheduledAt:'2026-12-20T05:15:00Z'};
 const saved=(await h.request('/drafts/'+draftId,'PUT',{version:0,payload})).data;
 const key='inexc-message-workspace-v1:'+h.url,storage={[key]:JSON.stringify({id:draftId,version:saved.version,payload:saved.payload,dirty:false,editCampaign:campaign.id,updatedAt:Date.now()})};
 const a=await editor(h,storage);a.input('#mc-body','آخر تعديل قبل القفل');a.w.dispatchEvent(new a.w.CustomEvent('inexc:before-lock'));const next=a.storage();a.w.close();
 const b=await editor(h,next);t.after(()=>b.w.close());assert.equal(b.$('#mc-body').value,'آخر تعديل قبل القفل');assert.equal(b.$('#ms-compose-title').textContent,'تعديل رسالة مجدولة');
 await new Promise(r=>setTimeout(r,1250));
 const unchanged=(await h.query('SELECT * FROM email_campaigns WHERE id=$1',[campaign.id])).rows[0];assert.deepEqual(unchanged,campaign);assert.equal((await h.request('/drafts/'+draftId)).data.payload.message,'كتابة محفوظة');assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);assert.equal(b.requests.some(r=>r.method==='PUT'),false);
});
test('restoring a submitted draft does not recreate it or repeat sending',async t=>{
 const h=await createHarness();t.after(()=>h.close());const draftId=crypto.randomUUID(),payload={subject:'تمت جدولتها',message:'محفوظ',audience:'custom',extraRecipients:'teacher@example.com'};
 const draft=(await h.request('/drafts/'+draftId,'PUT',{version:0,payload})).data;
 const c=(await h.query("INSERT INTO email_campaigns(subject,body,audience,status) VALUES('قائمة','body','custom','scheduled') RETURNING id")).rows[0];
 await h.query('UPDATE message_drafts SET campaign_id=$1 WHERE id=$2',[c.id,draftId]);
 const key='inexc-message-workspace-v1:'+h.url,e=await editor(h,{[key]:JSON.stringify({id:draftId,version:draft.version,payload:draft.payload,dirty:false,updatedAt:Date.now()})});t.after(()=>e.w.close());
 assert.equal(e.w.sessionStorage.getItem(key),null);assert.equal(e.$('[data-panel="compose"]').hidden,true);assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);assert.equal((await h.query('SELECT count(*)::int AS n FROM message_drafts')).rows[0].n,1);
});

test('refresh keeps the selected message-center page even when no draft was opened',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 for(const view of ['reports','templates','contacts','settings','messages']){
  const a=await editor(h);a.$('[data-nav="'+view+'"]').click();
  assert.equal(a.$('[data-panel="'+view+'"]').hidden,false);
  a.w.dispatchEvent(new a.w.Event('beforeunload'));const storage=a.storage();a.w.close();
  const b=await editor(h,storage);
  assert.equal(b.$('[data-panel="'+view+'"]').hidden,false,view+' should remain visible after refresh');
  assert.equal(b.$('[data-panel="compose"]').hidden,true);
  assert.equal(b.requests.some(r=>r.method!=='GET'),false);b.w.close();
 }
 assert.equal((await h.query('SELECT count(*)::int AS n FROM message_drafts')).rows[0].n,0);assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
});

test('reports stay open after refresh while unfinished writing remains available without autosaving',async t=>{
 const h=await createHarness();t.after(()=>h.close());const a=await editor(h);
 a.$('[data-action="new"]').click();await waitFor(()=>!a.$('[data-panel="compose"]').hidden);
 a.input('#ms-subject','مسودة تبقى محفوظة');a.input('#mc-body','آخر سطر قبل فتح التقارير');
 a.$('[data-nav="reports"]').click();const storage=a.storage();a.w.close();
 const b=await editor(h,storage);t.after(()=>b.w.close());
 assert.equal(b.$('[data-panel="reports"]').hidden,false);assert.equal(b.$('[data-panel="compose"]').hidden,true);
 assert.equal(b.$('#ms-subject').value,'مسودة تبقى محفوظة');assert.equal(b.$('#mc-body').value,'آخر سطر قبل فتح التقارير');
 await new Promise(r=>setTimeout(r,1250));assert.equal(b.requests.some(r=>r.method==='PUT'),false);assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
});

test('explicit subscriber navigation wins over saved view, and moving to reports updates the main tab',async t=>{
 const h=await createHarness();t.after(()=>h.close());const key='inexc-message-view-v1:'+h.url;
 const a=await editor(h,{[key]:JSON.stringify({view:'reports',updatedAt:Date.now()})},'new-subscribers');
 assert.equal(a.$('[data-panel="new-subscribers"]').hidden,false);
 assert.equal(a.$('[data-view="new-subscribers"]').classList.contains('active'),true);
 await a.open();assert.equal(a.$('[data-panel="overview"]').hidden,false);assert.equal(a.$('#main').classList.contains('active'),true);await a.open('new-subscribers');
 a.$('[data-nav="reports"]').click();assert.equal(a.$('#main').classList.contains('active'),true);assert.equal(a.$('[data-view="new-subscribers"]').classList.contains('active'),false);
 const storage=a.storage();a.w.close();const b=await editor(h,storage);t.after(()=>b.w.close());
 assert.equal(b.$('[data-panel="reports"]').hidden,false);assert.equal(b.$('#main').classList.contains('active'),true);assert.equal(h.sent.length,0);
});

test('expired, invalid or orphan compose navigation falls back to overview without creating a message',async t=>{
 const h=await createHarness();t.after(()=>h.close());const key='inexc-message-view-v1:'+h.url;
 for(const saved of [{view:'reports',updatedAt:0},{view:'missing',updatedAt:Date.now()},{view:'compose',updatedAt:Date.now()}]){
  const e=await editor(h,{[key]:JSON.stringify(saved)});assert.equal(e.$('[data-panel="overview"]').hidden,false);assert.equal(e.requests.some(r=>r.method!=='GET'),false);e.w.close();
 }
 assert.equal((await h.query('SELECT count(*)::int AS n FROM message_drafts')).rows[0].n,0);assert.equal(h.sent.length,0);
});
