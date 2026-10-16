// Local authenticated DOM fixtures only. No live credentials, registrations or email.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8'),tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t,{oldServer=false}={}){
 const dom=new JSDOM(await read('admin-portal.html'),{url:'https://local.invalid/admin-portal.html#payments',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());await tick();
 let valid=true;const requests=[],state={version:2,defaults:{payments:['stripe','bank'],membershipEnabled:true},stripe:{configured:true,ready:null},courses:[{id:'11111111-1111-4111-8111-111111111111',name:'LOCAL A',payments:['stripe','bank'],membershipEnabled:true,price:199,active:true,bank:{},certificate:{}},{id:'22222222-2222-4222-8222-222222222222',name:'LOCAL B <img src=x onerror=alert(1)>',payments:['bank'],membershipEnabled:false,price:299,active:false,bank:{},certificate:{}}]};
 w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.sessionStorage.setItem('inexc_do_admin','LOCAL');w.INEXCAdminSession={valid:()=>valid};w.INEXCAdminDrafts={restore(){},captureScope(){},clear(){}};
 w.fetch=async(url,opt={})=>{requests.push({url,opt});let result=[];
  if(url.endsWith('/stripe-check'))result={ready:true,message:'LOCAL READY'};
  else if(url.endsWith('/course-payments')){
   if(oldServer)return {ok:false,status:404,json:async()=>({})};
   if(opt.method==='PUT'){const input=JSON.parse(opt.body),courses=input.scope==='all'?state.courses:state.courses.filter(c=>c.id===input.courseId);for(const c of courses){if(input.action==='enable-stripe')c.payments=[...new Set(['stripe',...c.payments])];else {c.payments=input.payments;c.membershipEnabled=input.membershipEnabled}}state.updated=courses.length;if(input.applyToNew&&input.action!=='enable-stripe')state.defaults={payments:input.payments,membershipEnabled:input.membershipEnabled};}result=state;
  }else if(url.endsWith('/admin/courses')){result=state.courses;if(opt.method==='POST')result={id:state.courses[0].id,shareUrl:'https://local.invalid/course/local'}}
  else if(url.includes('/admin/courses/'))result={id:state.courses[0].id,shareUrl:'https://local.invalid/course/local'};
  return {ok:true,status:200,json:async()=>structuredClone(result)};
 };
 const inline=[...w.document.querySelectorAll('script:not([src])')].map(s=>s.textContent);w.eval(inline[0]);w.eval(inline[1]);w.eval(await read('course-payments-admin.js'));await tick();await tick();
 const el=id=>w.document.getElementById(id),row=id=>w.document.querySelector('[data-payment-course="'+id+'"]');
 return {w,requests,state,el,row,lock(){valid=false;w.sessionStorage.removeItem('inexc_do_admin');w.dispatchEvent(new w.Event('inexc:locked'))}};
}
test('admin bulk and individual controls send exact choices; filtering retains unsaved rows; diagnostic runs only on demand',async t=>{
 const h=await fixture(t),{w,requests,el,row,state}=h;assert.equal(w.INEXCPaymentsAdmin.ready(),true);assert.equal(el('payments').classList.contains('active'),true);assert.equal(el('paymentCourseRows').querySelector('img'),null);assert.equal(requests.some(r=>r.url.endsWith('/stripe-check')),false);
 const a=row(state.courses[0].id);a.querySelectorAll('input').forEach(n=>{n.checked=false;n.dispatchEvent(new w.Event('change',{bubbles:true}))});
 el('paymentCourseSearch').value='LOCAL B';el('paymentCourseSearch').dispatchEvent(new w.Event('input'));el('paymentCourseSearch').value='';el('paymentCourseSearch').dispatchEvent(new w.Event('input'));assert.equal(row(state.courses[0].id).querySelectorAll('input:checked').length,0);
 row(state.courses[0].id).querySelector('button').click();await tick();let body=JSON.parse(requests.filter(r=>r.opt.method==='PUT').at(-1).opt.body);assert.deepEqual(body,{courseId:state.courses[0].id,payments:[],membershipEnabled:false});
 for(const keys of [['stripe'],['stripe','bank'],['stripe','bank','membership'],[]]){el('clearAllPayments').click();keys.forEach(k=>el('bulkPayment-'+k).checked=true);el('applyPaymentMethods').click();await tick();body=JSON.parse(requests.filter(r=>r.opt.method==='PUT').at(-1).opt.body);assert.deepEqual(body.payments,keys.filter(k=>k!=='membership'));assert.equal(body.membershipEnabled,keys.includes('membership'));}
 el('enableStripeEverywhere').click();await tick();assert.equal(JSON.parse(requests.filter(r=>r.opt.method==='PUT').at(-1).opt.body).action,'enable-stripe');assert.ok(state.courses.every(c=>c.payments.includes('stripe')));
 el('checkStripeNow').click();await tick();assert.match(el('stripeCheckStatus').textContent,/LOCAL READY/);assert.equal(requests.filter(r=>r.url.endsWith('/stripe-check')).length,1);
 h.lock();const count=requests.length;el('checkStripeNow').click();await tick();assert.equal(requests.length,count);assert.equal(el('paymentCourseRows').children.length,0);
});
test('actual course editor saves Stripe and disabled membership, while an outdated server blocks saving',async t=>{
 const h=await fixture(t);h.el('courseName').value='LOCAL EDIT';h.el('payBank').checked=false;h.el('payStripe').checked=true;h.el('payMembership').checked=false;
 h.el('courseForm').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();const posted=h.requests.find(r=>r.opt.method==='POST'&&r.url.endsWith('/admin/courses'));assert.ok(posted);assert.deepEqual(JSON.parse(posted.opt.body).payments,['stripe']);assert.equal(JSON.parse(posted.opt.body).membershipEnabled,false);
 const old=await fixture(t,{oldServer:true});old.el('courseForm').dispatchEvent(new old.w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(old.requests.some(r=>r.opt.method==='POST'),false);assert.match(old.el('courseError').textContent,/حدّث خادم/);
});
