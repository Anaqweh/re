// Isolated browser DOM fixtures; never contact the production API or mail provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const course={id:'11111111-1111-4111-8111-111111111111',name:'LOCAL COURSE',price:199,certificate:{mode:'optional',name:'LOCAL CERT',price:100},payments:['bank','link'],paymentLink:'https://payment.example.invalid/pay',membershipEnabled:true,bank:{name:'LOCAL BENEFICIARY',account:'123456',iban:'LOCAL-IBAN'}};
async function harness(page,{unavailable=false,stripeEnabled=false}={}){
 const dom=new JSDOM(await read(page),{url:'https://local.invalid/'+page,runScripts:'outside-only'}),w=dom.window;
 if(w.document.readyState!=='complete')await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
 const requests=[],alerts=[],copied=[];w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.alert=message=>alerts.push(message);w.console.warn=()=>{};
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
 w.fetch=async(url,opt={})=>{
  requests.push({url,opt});let data;
  if(url.endsWith('/courses')){if(unavailable)throw Error('OFFLINE');data=[course,{...course,id:'other',membershipEnabled:false,bank:{...course.bank,account:'654321'}},{...course,id:'free',price:0},{...course,id:'free-unavailable',price:0,membershipEnabled:false}]}
  else if(url.endsWith('/capabilities'))data={cardCheckout:2,enabled:stripeEnabled};
  else if(url.endsWith('/verify'))data={cost:2,remainingBefore:6,remainingAfter:4,certificateFee:90,...(JSON.parse(opt.body).course_id==='free'?{certificateDeferred:true}:{} )};
  else if(url.endsWith('/registrations'))data={reference:'LOCAL-REFERENCE',remaining:4,certificateFee:90,...(opt.body?.get('course_id')==='free'?{certificateRequestId:'LOCAL-CERTIFICATE'}:{})};
  else throw Error('Unexpected request '+url);
  return {ok:true,json:async()=>data};
 };
 w.eval([...w.document.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n')+'\n'+await read(page.startsWith('register/')?'register/inexc-do-registration.js':'inexc-do-registration.js')+'\n'+await read('register/inexc-membership-registration.js'));
 w.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 const el=id=>w.document.getElementById(id),change=id=>el(id).dispatchEvent(new w.Event('change',{bubbles:true}));
 return {dom,w,el,change,requests,alerts,copied};
}
for(const page of ['register.html','register/index.html']){
 test(page+': free courses show only INEXC card with or without certificate and restore paid course methods',async t=>{
  const h=await harness(page,{stripeEnabled:true});t.after(()=>h.dom.window.close());const {w,el,change,requests}=h;
  const chooseCertificate=value=>{const input=w.document.querySelector('[name=certificate][value='+value+']');input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const assertCardOnly=()=>{
   assert.equal(el('useMembershipCard').checked,true);assert.equal(el('useMembershipCard').disabled,true);assert.equal(el('membershipFields').hidden,false);
   assert.equal(el('changePaymentMethod').hidden,true);assert.equal(el('paymentArea').style.display,'none');assert.equal(w.document.querySelectorAll('[name=payment]').length,0);
   assert.equal(el('bankBox').classList.contains('show'),false);assert.equal(el('receipt').required,false);
  };
  el('course').value=course.id;change('course');assert.equal(el('receipt').required,true);
  el('course').value='free';change('course');assertCardOnly();
  for(const choice of ['yes','no','yes']){chooseCertificate(choice);assertCardOnly();}
  el('changePaymentMethod').click();assertCardOnly();
  el('course').value=course.id;change('course');assert.equal(el('useMembershipCard').checked,false);assert.equal(el('useMembershipCard').disabled,false);assert.equal(el('changePaymentMethod').hidden,false);assert.equal(el('receipt').required,true);assert.equal(w.document.querySelectorAll('[name=payment]').length,3);
  el('course').value='free';change('course');el('requestType').value='institution';change('requestType');assert.equal(el('membershipPayment').hidden,true);assert.equal(el('useMembershipCard').checked,false);
  el('requestType').value='individual';change('requestType');assertCardOnly();
  el('course').value='free-unavailable';change('course');assert.equal(el('membershipPayment').hidden,false);assert.equal(el('useMembershipCard').disabled,true);assert.equal(el('membershipFields').hidden,true);assert.equal(el('submitButton').disabled,true);assert.equal(w.document.querySelectorAll('[name=payment]').length,0);assert.match(el('membershipEligibility').textContent,/غير متاح/);
  el('registrationForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(requests.filter(r=>r.opt.method==='POST').length,0);
  el('course').value='free';change('course');chooseCertificate('yes');assert.equal(el('submitButton').disabled,false);
  el('name').value='LOCAL';el('email').value='local@example.invalid';el('phone').value='000000';el('membershipCode').value='INX-LOCAL';
  el('verifyMembership').click();await tick();await tick();assertCardOnly();assert.match(el('total').textContent,/لاحقًا/);
  el('registrationForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  const posted=requests.filter(r=>r.url.endsWith('/registrations'));assert.equal(posted.length,1);assert.equal(posted[0].opt.body.get('payment_method'),'membership');assert.equal(posted[0].opt.body.get('certificate'),'yes');assert.equal(posted[0].opt.body.has('receipt'),false);assert.match(el('successText').textContent,/3 دقائق/);assert.equal(requests.some(r=>r.url.endsWith('/checkout')),false);
 });
 test(page+': explicit return from INEXC card restores each payment method and keeps registration details',async t=>{
  const h=await harness(page,{stripeEnabled:true});t.after(()=>h.dom.window.close());const {w,el,change,requests}=h;
  el('course').value=course.id;change('course');el('name').value='LOCAL';el('email').value='local@example.invalid';el('phone').value='000000';el('membershipCode').value='INX-LOCAL';
  const certificate=w.document.querySelector('[name=certificate][value=yes]');certificate.checked=true;certificate.dispatchEvent(new w.Event('change',{bubbles:true}));
  for(const method of ['bank','stripe','link']){
   const choice=w.document.querySelector('[name=payment][value='+method+']');choice.checked=true;choice.dispatchEvent(new w.Event('change',{bubbles:true}));
   el('useMembershipCard').checked=true;change('useMembershipCard');assert.equal(el('membershipFields').hidden,false);assert.equal(el('useMembershipCard').getAttribute('aria-expanded'),'true');
   if(method!=='bank'){el('verifyMembership').click();await tick();await tick();assert.equal(el('receipt').required,true)}
   w.sessionStorage.setItem('inexc_membership_checkout',JSON.stringify({code:'INX-LOCAL'}));const before=requests.filter(r=>r.opt.method==='POST').length;
   el('changePaymentMethod').click();
   assert.equal(el('useMembershipCard').checked,false);assert.equal(el('membershipFields').hidden,true);assert.equal(el('paymentChoices').hidden,false);assert.notEqual(el('paymentArea').style.display,'none');assert.equal(el('useMembershipCard').getAttribute('aria-expanded'),'false');
   assert.equal(w.document.querySelector('[name=payment]:checked').value,method);assert.equal(w.document.activeElement.value,method);assert.equal(el('receipt').required,method==='bank');assert.equal(el('bankBox').classList.contains('show'),method==='bank');assert.equal(w.sessionStorage.getItem('inexc_membership_checkout'),null);
   assert.equal(el('name').value,'LOCAL');assert.equal(el('email').value,'local@example.invalid');assert.equal(el('phone').value,'000000');assert.equal(el('course').value,course.id);assert.equal(w.document.querySelector('[name=certificate][value=yes]').checked,true);assert.equal(el('membershipCode').value,'INX-LOCAL');assert.doesNotMatch(el('total').textContent,/وحدة|تحقق/);assert.equal(requests.filter(r=>r.opt.method==='POST').length,before);
   if(method==='stripe'){assert.equal(el('submitButton').textContent,'المتابعة إلى الدفع الآمن');assert.match(w.document.querySelector('[name=payment][value=stripe]').parentElement.textContent,/الدفع الإلكتروني/)}
  }
  assert.equal(requests.some(r=>r.url.endsWith('/registrations')||r.url.endsWith('/checkout')),false);
 });
 test(page+': bank receipt, exact copy values and card-to-institution transitions',async t=>{
  const h=await harness(page);t.after(()=>h.dom.window.close());const {w,el,change,requests}=h;
  el('course').value=course.id;change('course');
  assert.equal(el('bankAccount').querySelector('bdi').textContent,'123456');assert.equal(el('bankIban').querySelector('bdi').dir,'ltr');
  el('bankIban').querySelector('button').click();await tick();assert.deepEqual(h.copied,['LOCAL-IBAN']);
  el('name').value='LOCAL';el('email').value='local@example.invalid';el('phone').value='000000';
  el('registrationForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));assert.match(h.alerts.at(-1),/وصل/);assert.equal(requests.filter(r=>r.url.endsWith('/registrations')).length,0);
  assert.match(w.INEXCReceiptError(new w.File(['x'],'file.svg',{type:'image/svg+xml'})),/PDF/);
  assert.match(w.INEXCReceiptError({size:5*1024*1024+1,type:'application/pdf'}),/5MB/);
  Object.defineProperty(el('receipt'),'files',{value:[new w.File(['LOCAL RECEIPT'],'receipt.pdf',{type:'application/pdf'})],configurable:true});
  const link=w.document.querySelector('[name=payment][value=link]');link.checked=true;link.dispatchEvent(new w.Event('change',{bubbles:true}));
  el('membershipCode').value='INX-LOCAL';el('useMembershipCard').checked=true;change('useMembershipCard');
  el('verifyMembership').click();await tick();await tick();
  assert.equal(el('receipt').required,true);assert.equal(el('bankAccount').querySelector('bdi').textContent,'123456');assert.equal(el('bankBox').classList.contains('show'),true);
  el('requestType').value='institution';change('requestType');assert.equal(el('receipt').required,false);assert.equal(el('membershipPayment').hidden,true);assert.equal(el('useMembershipCard').checked,false);
  el('requestType').value='individual';change('requestType');el('course').value='other';change('course');assert.equal(el('membershipPayment').hidden,true);assert.equal(el('bankAccount').querySelector('bdi').textContent,'654321');
  const bank=w.document.querySelector('[name=payment][value=bank]');bank.checked=true;bank.dispatchEvent(new w.Event('change',{bubbles:true}));
  el('registrationForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();
  const posted=requests.find(r=>r.url.endsWith('/registrations'));assert.equal(posted.opt.body.get('receipt').name,'receipt.pdf');assert.equal(posted.opt.body.get('payment_method'),'bank');assert.match(el('successText').textContent,/سنراجع/);
 });
 test(page+': unavailable course API cannot display or book sample courses',async t=>{
  const h=await harness(page,{unavailable:true});t.after(()=>h.dom.window.close());
  assert.equal(h.el('course').options.length,1);assert.match(h.el('course').textContent,/تعذّر/);
  h.el('registrationForm').dispatchEvent(new h.w.Event('submit',{cancelable:true,bubbles:true}));
  assert.equal(h.requests.filter(r=>r.url.endsWith('/registrations')).length,0);assert.equal(h.el('success').classList.contains('show'),false);
 });
}
