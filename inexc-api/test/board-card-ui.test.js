import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const id='00000000-0000-4000-8000-000000000001';
const flush=()=>new Promise(r=>setTimeout(r,15));
test('admin can select archived course, save once and copy its separate card URL without emailing',async(t)=>{
 const dom=new JSDOM('<div id="app"><nav class="tabs"></nav><main></main></div>',{url:'https://www.inexctraining.com/admin-portal.html',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.INEXCAdminSession={valid:()=>true};w.INEXC_REGISTRATION_ENDPOINT='https://api.inexctraining.com/api';w.sessionStorage.setItem('inexc_do_admin','test');const calls=[];
 w.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>options?.method==='PUT'?{...JSON.parse(options.body),courseId:id}:{courses:[{id,name:'دورة سابقة',active:false}],offers:[]}}};
 w.eval(readFileSync(new URL('../../admin-board-cards.js',import.meta.url),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.document.querySelector('[data-view="board-cards"]').click();await flush();
 const q=s=>w.document.querySelector('#board-cards '+s);q('[name=course]').value=id;q('[name=course]').dispatchEvent(new w.Event('change'));assert.equal(q('[data-fields]').disabled,false);assert.match(q('[name=course]').textContent,/سابقة/);q('[name=paymentUrl]').value='https://buy.stripe.com/example';q('[name=enabled]').checked=true;q('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(q('[data-share]').hidden,false);assert.equal(q('[data-share-url]').value,'https://www.inexctraining.com/board-card.html?course='+id);assert.equal(calls.filter(c=>c.options?.method==='PUT').length,1);assert.ok(calls.every(c=>c.url.includes('/admin/board-cards')));w.dispatchEvent(new w.Event('inexc:locked'));assert.equal(q('[data-share]').hidden,true);dom.window.close();
});

test('course editor shortcuts select the current course and focus upload or price',async(t)=>{
 const dom=new JSDOM(`<div id="app"><nav class="tabs"></nav><main><form id="courseForm"><input id="courseId" value="${id}"><input id="certificateSample" type="file"></form></main></div>`,{url:'https://www.inexctraining.com/admin-portal.html',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.INEXCAdminSession={valid:()=>true};w.INEXC_REGISTRATION_ENDPOINT='https://api.inexctraining.com/api';w.fetch=async()=>({ok:true,json:async()=>({courses:[{id,name:'دورة سابقة',active:false}],offers:[]})});
 w.eval(readFileSync(new URL('../../admin-board-cards.js',import.meta.url),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.document.querySelector('[data-card-upload]').click();await flush();assert.equal(w.document.querySelector('#bc-course').value,id);assert.equal(w.document.activeElement.id,'bc-file');assert.equal(w.location.hash,'#board-cards');w.document.querySelector('[data-card-price]').click();await flush();assert.equal(w.document.activeElement.id,'bc-price');assert.equal(w.document.querySelector('#bc-price').value,'149');
});
