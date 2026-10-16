import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t,{old=false}={}){
 const dom=new JSDOM(await read('admin-portal.html'),{url:'https://local.invalid/admin-portal.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,requests=[],id='11111111-1111-4111-8111-111111111111',plan='22222222-2222-4222-8222-222222222222';
 const course={id,name:'دورة محلية',description:'',category:'',date:'',location:'',price:10,certificate:{mode:'none'},bank:{},payments:['bank','stripe'],membershipEnabled:true,membershipPlanIds:[plan],featured:true,active:true};
 w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.INEXCAdminSession={valid:()=>true};w.sessionStorage.setItem('inexc_do_admin','LOCAL');
 w.INEXCAdminDrafts={captureScope(){},clear(){},restore(){}};w.scrollTo=()=>{};
 w.fetch=async(url,opt={})=>{requests.push({url,opt});let data=[];
  if(url.endsWith('/course-card-options'))return {ok:!old,status:old?404:200,json:async()=>old?{}:{version:1,plans:[{id:plan,cardName:'بطاقة الريادة <img src=x>',active:true}]}};
  if(url.endsWith('/admin/courses'))data=[course];
  if(opt.method==='PUT'||opt.method==='POST')data={...course,...JSON.parse(opt.body)};
  return {ok:true,status:200,json:async()=>data};
 };
 w.eval(await read('course-card-labels.js'));
 const scripts=[...w.document.querySelectorAll('script:not([src])')];w.eval(scripts[0].textContent);w.eval(scripts[1].textContent);w.eval(await read('course-card-access-admin.js'));
 await tick();await tick();w.edit(id);await tick();
 const el=id=>w.document.getElementById(id),change=id=>el(id).dispatchEvent(new w.Event('change',{bubbles:true}));
 return {w,el,requests,course,plan,change};
}
test('real course form loads named cards, blocks empty selection and saves exact eligibility without changing payment methods',async t=>{
 const h=await fixture(t);assert.equal(h.el('courseCardScope').value,'selected');assert.equal(h.el('courseFeatured').checked,true);assert.equal(h.el('courseCardPlans').querySelector('img'),null);
 const box=h.el('courseCardPlans').querySelector('input');box.checked=false;h.change('courseCardScope');
 h.el('courseForm').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(h.requests.some(r=>r.opt.method==='PUT'),false);
 assert.match(h.el('courseError').textContent,/اختر بطاقة/);box.checked=true;h.change('courseCardScope');
 h.el('courseForm').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 let data=JSON.parse(h.requests.find(r=>r.opt.method==='PUT').opt.body);assert.deepEqual(data.membershipPlanIds,[h.plan]);assert.equal(data.featured,true);assert.deepEqual(data.payments,['stripe','bank']);
 h.el('courseCardScope').value='all';h.change('courseCardScope');assert.equal(h.w.INEXCCourseCards.payload().membershipPlanIds,null);
 h.el('courseCardScope').value='none';h.change('courseCardScope');assert.equal(h.el('payMembership').checked,false);
 h.w.fresh();assert.equal(h.el('courseFeatured').checked,false);assert.equal(h.el('courseCardScope').value,'all');
});
test('old backend cannot silently accept eligibility edits; existing payment checkbox remains available',async t=>{
 const h=await fixture(t,{old:true});assert.equal(h.el('courseCardAccess').disabled,true);assert.equal(h.el('payMembership').closest('label').hidden,false);
 assert.match(h.el('courseCardNotice').textContent,/تحديث الخادم/);assert.equal(JSON.stringify(h.w.INEXCCourseCards.payload()),'{}');
});
