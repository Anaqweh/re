import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createHarness} from './studio-harness.js';
import {subscriptionUrl,subscriptionFields,legacyConfirmationFields} from '../message-subscription-links.js';
const root=new URL('../../',import.meta.url);
const waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach expected state');};
async function publicDom(h,path='/subscribe.html'){
 const dom=new JSDOM(await fs.readFile(new URL('subscribe.html',root),'utf8'),{url:h.url+path,runScripts:'outside-only'}),w=dom.window;
 w.INEXC_REGISTRATION_ENDPOINT=h.url+'/api';w.fetch=fetch;w.AbortSignal=AbortSignal;w.subscriptionUrl=subscriptionUrl;
 let copied='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
 w.eval((await fs.readFile(new URL('subscription.js',root),'utf8')).replace(/^import .*\n/,''));
 await waitFor(()=>!w.document.querySelector('#subscribe-content').hidden||!w.document.querySelector('#confirmation').hidden||w.document.querySelector('#status').classList.contains('error'));
 return{dom,w,$:s=>w.document.querySelector(s),get copied(){return copied}};
}
test('visitor page uses the supplied logo, removes admin labels and subscribes instantly',async t=>{
 const h=await createHarness();t.after(()=>h.close());const p=await publicDom(h,'/subscribe.html?share=1');t.after(()=>p.w.close());
 assert.match(p.$('.site-header img').src,/assets\/inexc-approved-logo.jpg$/);assert.equal(p.$('.brand-tile'),null);assert.equal(p.$('.geometric-mark'),null);assert.doesNotMatch(p.w.document.body.textContent,/01 \/ SUBSCRIBE|02 \/ CONFIRM|SHARE THE KNOWLEDGE/);
 assert.equal(p.$('.form-side').firstElementChild.id,'share-box');assert.equal(p.$('input[name=email]').dir,'ltr');p.$('#copy-link').click();await waitFor(()=>p.copied);assert.equal(p.copied,h.url+'/subscribe.html');assert.match(p.$('#whatsapp').href,/^https:\/\/wa.me\//);
 p.$('input[name=email]').value='ui@example.com';p.$('input[name=name]').value='غادة';p.$('input[name=consent]').checked=true;
 await p.$('#subscribe-form').onsubmit({preventDefault(){},currentTarget:p.$('#subscribe-form')});
 assert.equal(p.$('#subscribe-content').hidden,true);assert.equal(p.$('#confirmed').hidden,false);assert.equal(h.sent.length,0);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='ui@example.com'")).rows.length,1);assert.equal((await h.request('/subscriptions/new')).data.rows[0].full_name,'غادة');
 await h.request('/subscriptions/settings','PUT',{title:'<img src=x onerror=alert(1)>'});const safe=await publicDom(h);t.after(()=>safe.w.close());assert.equal(safe.$('#main-title').textContent,'<img src=x onerror=alert(1)>');assert.equal(safe.$('#main-title img'),null);
});
test('admin editing and separate new-subscriber panel support counts, review and existing contacts',async t=>{
 const h=await createHarness();t.after(()=>h.close());const c=(await h.query("INSERT INTO email_campaigns(subject,body,audience) VALUES('حملة الواجهة','body','custom') RETURNING subscription_code")).rows[0];
 await fetch(h.url+'/api/message-subscriptions/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin-ui@example.com',name:'سارة',consent:true,source:c.subscription_code})});
 const dom=new JSDOM('<main id="target"></main><main id="new"></main>',{url:h.url,runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());w.subscriptionFields=subscriptionFields;w.legacyConfirmationFields=legacyConfirmationFields;
 w.eval((await fs.readFile(new URL('message-subscriptions-ui.js',root),'utf8')).replace(/^import .*\n/,'').replaceAll('export async function','async function').replace('export const','const'));
 let saved,composed,copied,notification,count,contactsOpened=false;Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async v=>copied=v}});
 const call=async(path,method='GET',body)=>{const r=await h.request(path,method,body);if(r.status>=400)throw Error(r.data.error);return r.data;};
 await w.loadSubscriptionManager({target:w.document.querySelector('#target'),call,api:async()=>{},notify:m=>notification=m,supported:true,onSettings:s=>saved=s,onCompose:id=>composed=id});const $=s=>w.document.querySelector(s);
 $('#sub-source').value=c.subscription_code;$('#sub-source').onchange();assert.match($('#sub-link').value,new RegExp(c.subscription_code));await $('#sub-copy').onclick();assert.equal(copied,$('#sub-link').value);$('#sub-compose').click();assert.ok(composed);
 assert.equal($('#sub-settings [name=emailSubject]'),null);$('#sub-settings [name=title]').value='معرفة تصلك';await $('#sub-settings').onsubmit({preventDefault(){},currentTarget:$('#sub-settings')});assert.equal(saved.title,'معرفة تصلك');assert.match(notification,/حفظ/);
 await w.loadNewSubscribers({target:$('#new'),call,notify:m=>notification=m,supported:true,onCount:n=>count=n,onCompose:id=>composed=id,onContacts:()=>contactsOpened=true});assert.equal(count,1);assert.match($('#new-table').textContent,/سارة/);assert.match($('#new-table').textContent,/جديد في جهات الاتصال/);assert.match($('#new-table').textContent,/حملة الواجهة/);
 $('#new-contacts').click();assert.equal(contactsOpened,true);await $('#new-seen').onclick();assert.equal(count,0);assert.match($('#new-table').textContent,/تمت المراجعة/);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='admin-ui@example.com'")).rows.length,1);
 $('#new-filter').value='new';$('#new-filter').onchange();await waitFor(()=>$('#new-table').textContent.includes('لا توجد تسجيلات مطابقة'));assert.equal(h.sent.length,0);
});
