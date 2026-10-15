import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createHarness} from './studio-harness.js';

const source=(await fs.readFile(new URL('../../message-subscriptions-ui.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replaceAll('export ','');
async function seed(h,email,at){
 await h.query('INSERT INTO message_contacts(full_name,email,normalized_email) VALUES($1,$2,$2)',['مشترك',email]);
 await h.query("INSERT INTO message_subscriptions(email,full_name,contact_id,consent_text,subscribed_at) SELECT email,full_name,id,'local fixture',$2 FROM message_contacts WHERE email=$1",[email,at]);
}
function browser(){
 const dom=new JSDOM('<span data-new-subscriber-count></span><span data-new-subscriber-count></span><section id="subscribers"></section>',{url:'https://example.test/admin',runScripts:'outside-only'}),w=dom.window;
 w.eval(source);return{w,target:w.document.querySelector('#subscribers'),badges:[...w.document.querySelectorAll('[data-new-subscriber-count]')]};
}
const checkedCall=(h,requests)=>async(path,method='GET',body)=>{
 assert.ok(method==='GET'&&path.startsWith('/subscriptions/new?')||method==='POST'&&path==='/subscriptions/new/seen','Only subscriber reads and acknowledgements are allowed');
 requests.push({path,method,body});const response=await h.request(path,method,body);
 if(response.status>=400)throw Error(response.data.error);return response.data;
};

test('opening clears every existing notice across pages, keeps later signups unread and rejects stale badge responses',async t=>{
 const h=await createHarness();t.after(()=>h.close());
 await h.query("INSERT INTO message_contacts(full_name,email,normalized_email) SELECT 'مشترك '||i,'reader'||i||'@example.com','reader'||i||'@example.com' FROM generate_series(1,125) i");
 await h.query("INSERT INTO message_subscriptions(email,full_name,contact_id,consent_text,subscribed_at) SELECT email,full_name,id,'local fixture','2026-10-15T08:00:00Z' FROM message_contacts");
 const campaign=(await h.query("INSERT INTO email_campaigns(subject,body,audience,status,scheduled_at) VALUES('موعد قائم','نص قائم','custom','scheduled','2026-12-20T05:15:00Z') RETURNING *")).rows[0];
 const b=browser();t.after(()=>b.w.close());const requests=[],notifications=[],request=checkedCall(h,requests);let added=false;
 const call=async(path,method,body)=>{const data=await request(path,method,body);if(path==='/subscriptions/new/seen'&&!added){added=true;await seed(h,'later@example.com','2026-10-15T09:00:00Z');}return data;};
 const options={target:b.target,call,supported:true,notify:message=>notifications.push(message),onCount:b.w.updateSubscriberNotice,onCompose:()=>assert.fail('No message action'),onContacts(){}};
 const stale=b.w.subscriberNoticeRevision();b.w.updateSubscriberNotice(125);
 await b.w.loadNewSubscribers(options);
 assert.equal(notifications.length,0);assert.ok(b.badges.every(node=>!node.hidden));assert.equal(b.badges[0].getAttribute('aria-label'),'1 مشترك جديد');
 const counts=(await h.query('SELECT count(*)::int AS total,count(seen_at)::int AS seen FROM message_subscriptions')).rows[0];assert.deepEqual(counts,{total:126,seen:125});
 assert.equal((await h.query("SELECT seen_at FROM message_subscriptions WHERE email='later@example.com'")).rows[0].seen_at,null);
 assert.ok(requests.filter(r=>r.method==='POST').every(r=>r.body.emails.length<=50&&!r.body.emails.includes('later@example.com')));
 b.w.updateSubscriberNotice(125,stale);assert.equal(b.badges[0].getAttribute('aria-label'),'1 مشترك جديد');
 await b.w.loadNewSubscribers(options);assert.ok(b.badges.every(node=>node.hidden));assert.equal((await h.request('/subscriptions/new?countOnly=1')).data.unread,0);
 assert.match(b.target.textContent,/تمت المراجعة/);assert.equal((await h.query('SELECT count(*)::int AS n FROM message_contacts')).rows[0].n,126);
 await seed(h,'brand-new@example.com','2026-10-15T10:00:00Z');b.w.updateSubscriberNotice((await h.request('/subscriptions/new?countOnly=1')).data.unread);assert.ok(b.badges.every(node=>!node.hidden));
 assert.deepEqual((await h.query('SELECT * FROM email_campaigns WHERE id=$1',[campaign.id])).rows[0],campaign);assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
});

test('failed acknowledgement leaves the notice visible and refresh retries without deleting subscriptions',async t=>{
 const h=await createHarness();t.after(()=>h.close());await seed(h,'retry@example.com','2026-10-15T08:00:00Z');
 const b=browser();t.after(()=>b.w.close());const requests=[],errors=[],request=checkedCall(h,requests);let fail=true;
 const call=(path,method,body)=>{if(method==='POST'&&fail)throw Error('Offline fixture');return request(path,method,body);};
 b.w.updateSubscriberNotice(1);
 await b.w.loadNewSubscribers({target:b.target,call,supported:true,notify:message=>errors.push(message),onCount:b.w.updateSubscriberNotice,onCompose:()=>assert.fail('No message action'),onContacts(){}});
 assert.equal(errors.length,1);assert.ok(b.badges.every(node=>!node.hidden));assert.equal((await h.request('/subscriptions/new?countOnly=1')).data.unread,1);
 fail=false;await b.target.querySelector('#new-refresh').onclick();assert.ok(b.badges.every(node=>node.hidden));assert.equal((await h.query('SELECT count(*)::int AS n FROM message_subscriptions')).rows[0].n,1);assert.equal(h.sent.length,0);assert.equal(h.workerCalls,0);
});
