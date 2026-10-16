import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../admin-card-directory.js',import.meta.url),'utf8');
const flush=()=>new Promise(r=>setTimeout(r,0));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const card={id:'card-one',order_id:'order-one',card_number:'INX-LOCAL',access_token:'a'.repeat(48),holder_name:'Local Buyer',holder_email:'buyer@example.invalid',holder_phone:'000000',plan_name:'بطاقة الإتقان',units_remaining:3,units_total:4,status:'active',expires_at:'2099-01-01'};
const order={id:'order-one',card_id:card.id,name:card.holder_name,email:card.holder_email,phone:card.holder_phone,plan_name:card.plan_name,total:79,payment_method:'stripe',status:'تم إصدار البطاقة',reference:'LOCAL-REF',created_at:'2026-10-16'};
async function setup(t,{valid=true,orders=[order],cards=[card],handler}={}){
 const dom=new JSDOM('<!doctype html><head></head><body><nav class="tabs"><button data-view="memberships">البطاقات</button></nav><main><section class="view" id="memberships"></section></main></body>',{url:'https://www.inexctraining.com/admin-portal.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,calls=[];w.INEXC_REGISTRATION_ENDPOINT='https://api.example.invalid/api';w.sessionStorage.setItem('inexc_do_admin','local-admin');w.INEXCAdminSession={valid:()=>valid};
 w.fetch=async(url,init)=>{calls.push({url,init});return handler?handler(url,init):response(url.endsWith('/orders')?orders:url.endsWith('/cards')?cards:[])};
 w.eval(source);await flush();const q=s=>w.document.querySelector(s),open=async()=>{q('[data-view=card-directory]').click();await flush()};return {w,q,calls,open};
}
test('directory makes no request until a valid administrator opens it',async t=>{
 const h=await setup(t,{valid:false});assert.equal(h.calls.length,0);await h.open();assert.equal(h.calls.length,0);assert.equal(h.q('#card-directory').classList.contains('active'),false);
 h.w.INEXCAdminSession.valid=()=>true;await h.open();assert.equal(h.calls.length,2);assert.ok(h.calls.every(c=>c.init.headers.Authorization==='Bearer local-admin'&&(!c.init.method||c.init.method==='GET')&&c.init.cache==='no-store'));
});
test('buyer search, status, pagination and issued card links reflect existing records',async t=>{
 const pending=Array.from({length:26},(_,i)=>({...order,id:'pending-'+i,card_id:null,name:'Pending '+i,email:'pending'+i+'@example.invalid',status:'بانتظار الدفع'}));
 const h=await setup(t,{orders:[order,...pending]});await h.open();assert.equal(h.q('tbody').children.length,25);assert.match(h.q('[data-cd-count]').textContent,/1–25 من 27/);
 assert.equal(h.q('tbody a').getAttribute('href'),'/my-card/?token='+card.access_token);assert.equal(h.q('tbody a').getAttribute('rel'),'noopener noreferrer');
 h.q('[data-cd-next]').click();assert.equal(h.q('tbody').children.length,2);
 h.q('[data-cd-state]').value='issued';h.q('[data-cd-state]').dispatchEvent(new h.w.Event('change'));assert.equal(h.q('tbody').children.length,1);assert.match(h.q('tbody').textContent,/Local Buyer/);
 h.q('[data-cd-state]').value='';h.q('[data-cd-state]').dispatchEvent(new h.w.Event('change'));h.q('[data-cd-search]').value='pending25@';h.q('[data-cd-search]').dispatchEvent(new h.w.Event('input'));assert.equal(h.q('tbody').children.length,1);assert.match(h.q('tbody').textContent,/Pending 25/);assert.equal(h.q('tbody a'),null);
});
test('issued cards escape text, reject unsafe tokens and show expiry truthfully',async t=>{
 const h=await setup(t,{cards:[{...card,holder_name:'<img src=x onerror=alert(1)>',access_token:'javascript:alert(1)',expires_at:'2020-01-01'}]});await h.open();h.q('[data-cd-mode=cards]').click();await flush();assert.match(h.q('tbody').textContent,/منتهية الصلاحية/);assert.equal(h.q('tbody img'),null);assert.equal(h.q('tbody a'),null);assert.equal(h.q('tbody .is-issued'),null);
});
function profileSource(h,{count=26,defer}={}){
 const operations=[],id='12345678-1234-1234-1234-123456789abc';
 h.w.supabaseClient={from(table){operations.push(['from',table]);const query={};for(const method of ['select','order','ilike','range'])query[method]=(...args)=>{operations.push([method,...args]);return query};query.abortSignal=signal=>{operations.push(['abortSignal',signal]);return defer?defer:Promise.resolve({data:[{id,full_name:'Local Learner',email:'learner@example.invalid',phone:'000111',specialty:'التعليم',created_at:'2026-10-16'}],count,error:null})};return query}};return {operations,id};
}
test('digital learner cards validate admin then read only needed fields with stable paging',async t=>{
 const h=await setup(t);await h.open();const {operations,id}=profileSource(h);h.q('[data-cd-mode=trainees]').click();await flush();
 assert.ok(h.calls.at(-1).url.endsWith('/admin/memberships/plans'));assert.equal(operations[0][1],'trainee_profiles');assert.equal(operations[1][1],'id,full_name,email,phone,specialty,created_at');assert.equal(operations[1][2].count,'exact');assert.deepEqual(operations.find(o=>o[0]==='range').slice(1),[0,24]);assert.equal(h.q('tbody a').getAttribute('href'),'/digital-id.html?id='+id);assert.match(h.q('tbody').textContent,/INEXC-12345678/);
 h.q('[data-cd-next]').click();await flush();assert.deepEqual(operations.filter(o=>o[0]==='range').at(-1).slice(1),[25,49]);
 h.q('[data-cd-search]').value='learner@';h.q('[data-cd-field]').value='email';h.q('[data-cd-field]').dispatchEvent(new h.w.Event('change'));await flush();assert.deepEqual(operations.find(o=>o[0]==='ilike').slice(1),['email','%learner@%']);assert.deepEqual(operations.filter(o=>o[0]==='range').at(-1).slice(1),[0,24]);
 assert.ok(h.calls.every(c=>!c.init.method));
});
test('failed admin verification never queries learner source and offers retry',async t=>{
 let denied=true;const h=await setup(t,{handler:url=>response(denied?{error:'LOCAL DENIED'}:[],denied?401:200)});const {operations}=profileSource(h);h.q('[data-cd-mode=trainees]').click();await flush();assert.equal(operations.length,0);assert.match(h.q('[data-cd-error]').textContent,/LOCAL DENIED/);assert.equal(h.q('[data-cd-error]').hidden,false);assert.equal(h.q('[data-cd-refresh]').disabled,false);
 denied=false;h.q('[data-cd-refresh]').click();await flush();assert.match(h.q('tbody').textContent,/Local Learner/);assert.equal(h.q('[data-cd-error]').hidden,true);
});
test('logout clears displayed records and ignores an in-flight learner response',async t=>{
 const h=await setup(t);await h.open();assert.match(h.q('#card-directory').textContent,/buyer@example.invalid/);let resolve;const deferred=new Promise(r=>resolve=r);profileSource(h,{defer:deferred});h.q('[data-cd-mode=trainees]').click();await flush();h.w.sessionStorage.removeItem('inexc_do_admin');h.w.dispatchEvent(new h.w.Event('inexc:locked'));resolve({data:[{id:'12345678-1234-1234-1234-123456789abc',full_name:'Late Learner',email:'late@example.invalid'}],count:1});await flush();assert.doesNotMatch(h.q('#card-directory').textContent,/buyer@example.invalid|Late Learner|late@example.invalid/);assert.equal(h.q('[data-cd-table]').children.length,0);assert.equal(h.q('[data-cd-metrics]').children.length,0);
});
