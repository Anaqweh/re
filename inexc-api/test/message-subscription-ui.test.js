import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createHarness} from './studio-harness.js';
import {subscriptionUrl,subscriptionFields} from '../message-subscription-links.js';
const root=new URL('../../',import.meta.url);
const waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach expected state');};
const tokenFrom=mail=>mail.text.match(/#confirm=([a-f\d]{64})/)[1];
async function publicDom(h,path='/subscribe.html'){
 const dom=new JSDOM(await fs.readFile(new URL('subscribe.html',root),'utf8'),{url:h.url+path,runScripts:'outside-only'}),w=dom.window;
 w.INEXC_REGISTRATION_ENDPOINT=h.url+'/api';w.fetch=fetch;w.AbortSignal=AbortSignal;w.subscriptionUrl=subscriptionUrl;
 let copied='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
 const code=(await fs.readFile(new URL('subscription.js',root),'utf8')).replace(/^import .*\n/,'');w.eval(code);
 await waitFor(()=>!w.document.querySelector('#subscribe-content').hidden||!w.document.querySelector('#confirmation').hidden||w.document.querySelector('#status').classList.contains('error'));
 return{dom,w,$:s=>w.document.querySelector(s),get copied(){return copied}};
}
test('public UI submits consent, confirms explicitly, shares clean links and escapes editable content',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const p=await publicDom(h,'/subscribe.html?share=1');t.after(()=>p.dom.window.close());
 assert.equal(p.$('.form-side').firstElementChild.id,'share-box');assert.equal(p.$('input[name=email]').dir,'ltr');
 p.$('#copy-link').click();await waitFor(()=>p.copied);assert.equal(p.copied,h.url+'/subscribe.html');assert.match(p.$('#whatsapp').href,/^https:\/\/wa.me\//);
 p.$('input[name=email]').value='ui@example.com';p.$('input[name=name]').value='غادة';p.$('input[name=consent]').checked=true;
 await p.$('#subscribe-form').onsubmit({preventDefault(){},currentTarget:p.$('#subscribe-form')});
 assert.equal(p.$('#subscribe-form').hidden,true);assert.equal(h.sent.length,1);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='ui@example.com'")).rows.length,0);
 const token=tokenFrom(h.sent[0]),confirm=await publicDom(h,'/subscribe.html#confirm='+token);t.after(()=>confirm.dom.window.close());
 assert.equal(confirm.w.location.hash,'');assert.equal(confirm.$('#share-box').hidden,true);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='ui@example.com'")).rows.length,0);
 await confirm.$('#confirm-button').onclick();assert.equal(confirm.$('#confirmed').hidden,false);assert.equal(confirm.$('#share-box').hidden,false);assert.equal((await h.query("SELECT * FROM message_contacts WHERE email='ui@example.com'")).rows.length,1);
 confirm.$('#copy-link').click();await waitFor(()=>confirm.copied);assert.doesNotMatch(confirm.copied,/confirm|token/);
 await h.request('/subscriptions/settings','PUT',{title:'<img src=x onerror=alert(1)>'});const safe=await publicDom(h);t.after(()=>safe.dom.window.close());assert.equal(safe.$('#main-title').textContent,'<img src=x onerror=alert(1)>');assert.equal(safe.$('#main-title img'),null);
});
test('admin UI saves editable content, selects campaign links and composes for confirmed group',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 const c=(await h.query("INSERT INTO email_campaigns(subject,body,audience) VALUES('حملة الواجهة','body','custom') RETURNING subscription_code")).rows[0];
 await fetch(h.url+'/api/message-subscriptions/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin-ui@example.com',consent:true})});
 await fetch(h.url+'/api/message-subscriptions/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tokenFrom(h.sent[0])})});
 const dom=new JSDOM('<main id="target"></main>',{url:h.url,runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 w.subscriptionFields=subscriptionFields;w.eval((await fs.readFile(new URL('message-subscriptions-ui.js',root),'utf8')).replace(/^import .*\n/,'').replace('export async function','async function'));
 let saved,composed,copied,notification;
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async v=>copied=v}});
 const call=async(path,method='GET',body)=>{const r=await h.request(path,method,body);if(r.status>=400)throw Error(r.data.error);return r.data;};
 await w.loadSubscriptionManager({target:w.document.querySelector('#target'),call,api:async()=>{},notify:m=>notification=m,supported:true,onSettings:s=>saved=s,onCompose:id=>composed=id});
 const $=s=>w.document.querySelector(s);
 $('#sub-source').value=c.subscription_code;$('#sub-source').onchange();assert.match($('#sub-link').value,new RegExp(c.subscription_code));await $('#sub-copy').onclick();assert.equal(copied,$('#sub-link').value);
 $('#sub-compose').click();assert.ok(composed);
 $('#sub-settings [name=title]').value='معرفة تصلك';$('#sub-settings [name=enabled]').checked=false;
 await $('#sub-settings').onsubmit({preventDefault(){},currentTarget:$('#sub-settings')});assert.equal(saved.title,'معرفة تصلك');assert.equal((await call('/subscriptions')).settings.enabled,false);assert.match(notification,/حفظ/);
 assert.equal($('#sub-settings [name=consentLabel]').required,true);assert.equal($('#sub-settings [name=title]').maxLength,160);
});
