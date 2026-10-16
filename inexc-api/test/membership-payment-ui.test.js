import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../../',import.meta.url),read=path=>fs.readFile(new URL(path,root),'utf8'),flush=()=>new Promise(r=>setTimeout(r,0));
const plan={id:'11111111-1111-4111-8111-111111111111',name:'بطاقة الاختبار المحلية',slug:'launch',priceUsd:39,remaining:10,maxCards:10,validMonths:4,paymentMethods:['stripe','bank'],active:true};
const options={version:1,electronicEnabled:true,bankConfigured:true,bank:{title:'LOCAL BANK',name:'LOCAL HOLDER',account:'00123456',iban:'LOCAL-IBAN'}};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
async function purchase({methods=plan.paymentMethods,paymentOptions=options,legacy=false,query="",autoOpen=true,catalog=null,draft=null}={}){
 const dom=new JSDOM(await read('cards/index.html'),{url:'https://www.inexctraining.com/cards/'+query,runScripts:'outside-only'}),w=dom.window,requests=[],copies=[];
 w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true'};if(draft)w.sessionStorage.setItem('inexc_membership_purchase_draft',JSON.stringify(draft));
 w.INEXC_REGISTRATION_ENDPOINT='https://api.example.invalid/api';w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLFormElement.prototype.reportValidity=()=>true;w.navigator.clipboard={writeText:async value=>copies.push(value)};
 w.fetch=async(url,init)=>{requests.push({url,init});if(url.endsWith('/memberships/plans'))return response(catalog||[{...plan,paymentMethods:methods}]);if(url.endsWith('/memberships/payment-options'))return legacy?response({},404):response(paymentOptions);if(url.endsWith('/courses'))return response([{bank:options.bank}]);if(url.endsWith('/memberships/orders'))return response({reference:'LOCAL-ORDER',status:'بانتظار مراجعة الدفع'},201);return response({error:'LOCAL RETRY'},503)};
 w.eval(await read('cards/checkout.js'));await flush();await flush();const q=s=>w.document.querySelector(s);if(autoOpen)q('[data-plan]').click();
 const choose=value=>{q('[name=method][value='+value+']').click()},fill=()=>{q('#name').value='LOCAL BUYER';q('#email').value='local@example.invalid';q('#phone').value='000000'},submit=async()=>{q('#orderForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();await flush()};
 return {dom,w,q,requests,copies,choose,fill,submit};
}
test('bank choice reveals current account/IBAN, exact copy and receipt; switching methods preserves buyer details',async t=>{
 const h=await purchase();t.after(()=>h.dom.window.close());assert.equal(h.q('#bankDetails').hidden,true);assert.equal(h.q('#receipt').required,false);assert.equal(h.q('#summaryPlan').textContent,'باقة الاختبار المحلية');assert.equal(h.q('#summaryPrice').textContent,'39.00');assert.equal(h.q('#summaryDuration').textContent,'4 أشهر');h.fill();h.choose('bank');
 assert.equal(h.q('#bankDetails').hidden,false);assert.equal(h.q('#bankAccount').textContent,'00123456');assert.equal(h.q('#bankIban').textContent,'LOCAL-IBAN');assert.equal(h.q('#receipt').required,true);assert.equal(h.q('#bankAccount').dir,'ltr');
 h.q('[data-copy=bankAccount]').click();await flush();assert.deepEqual(h.copies,['00123456']);h.choose('stripe');assert.equal(h.q('#bankDetails').hidden,true);assert.equal(h.q('#receipt').required,false);assert.equal(h.q('#name').value,'LOCAL BUYER');assert.match(h.q('#submit').textContent,/الدفع الآمن/);
});
test('electronic request uses its own endpoint and stable retry key, without client pricing or receipt',async t=>{
 const h=await purchase();t.after(()=>h.dom.window.close());h.fill();await h.submit();await h.submit();const calls=h.requests.filter(r=>r.url.endsWith('/memberships/checkout'));assert.equal(calls.length,2);const data=JSON.parse(calls[0].init.body);assert.equal(data.request_key,JSON.parse(calls[1].init.body).request_key);assert.equal(data.payment_method,'stripe');assert.ok(!('amount'in data));assert.ok(!('receipt'in data));assert.equal(h.q('#message').textContent,'LOCAL RETRY');assert.equal(h.q('#submit').disabled,false);
});
test('bank request uploads receipt and confirms review, not card activation',async t=>{
 const h=await purchase();t.after(()=>h.dom.window.close());h.fill();h.choose('bank');await h.submit();assert.match(h.q('#message').textContent,/أرفق/);assert.equal(h.requests.filter(r=>r.url.endsWith('/memberships/orders')).length,0);
 const file=new h.w.File(['LOCAL ONLY'],'local.pdf',{type:'application/pdf'});Object.defineProperty(h.q('#receipt'),'files',{value:[file]});await h.submit();const call=h.requests.find(r=>r.url.endsWith('/memberships/orders'));assert.equal(call.init.body.get('payment_method'),'bank');assert.equal(call.init.body.get('receipt').name,'local.pdf');assert.equal(h.q('#success').classList.contains('show'),true);assert.match(h.q('#successText').textContent,/مراجعته/);assert.equal(h.w.sessionStorage.getItem('inexc_membership_payment_attempt'),null);assert.equal(h.w.document.activeElement,h.q('#successHeading'));h.q('#close').click();assert.equal(h.q('#dialog').open,false);
});
test('saved method controls are honored; missing bank hides transfer; old API retains bank flow',async t=>{
 const h=await purchase({methods:['bank']});t.after(()=>h.dom.window.close());assert.equal(h.q('[value=stripe]').disabled,true);assert.equal(h.q('[value=bank]').checked,true);
 const unavailable=await purchase({paymentOptions:{...options,electronicEnabled:false,bankConfigured:false,bank:{}}});t.after(()=>unavailable.dom.window.close());assert.equal(unavailable.q('#submit').disabled,true);assert.match(unavailable.q('#message').textContent,/لا توجد/);
 const legacy=await purchase({methods:['bank'],legacy:true});t.after(()=>legacy.dom.window.close());assert.equal(legacy.q('#bankDetails').hidden,false);assert.equal(legacy.q('#bankAccount').textContent,options.bank.account);assert.equal(legacy.q('[value=stripe]').disabled,true);
});
test('return page clears private fragment and relies on server paid state for card access',async t=>{
 const dom=new JSDOM(await read('cards/payment-status.html'),{url:'https://www.inexctraining.com/cards/payment-status.html#checkout=LOCAL-ID&token=LOCAL-PRIVATE&cancelled=1',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,calls=[];let paid=false;w.INEXC_REGISTRATION_ENDPOINT='https://api.example.invalid/api';w.fetch=async(url,init)=>{calls.push({url,init});return response({state:paid?'paid':'open',planName:plan.name,amount:39,currency:'USD',reference:'LOCAL-REF',cardNumber:paid?'INX-LOCAL':'',cardUrl:paid?'https://www.inexctraining.com/my-card/?token=LOCAL-CARD':'',paymentLink:'https://checkout.stripe.com/c/pay/cs_live_LOCAL'})};w.eval(await read('cards/payment-status.js'));await flush();await flush();assert.equal(w.location.hash,'');assert.equal(JSON.parse(calls[0].init.body).token,'LOCAL-PRIVATE');assert.equal(w.document.getElementById('backToRegistration').getAttribute('href'),'/cards/?resume=1');assert.doesNotMatch(w.document.getElementById('paymentTitle').textContent,/تفعيل/);
 paid=true;w.document.getElementById('checkPayment').click();await flush();await flush();assert.match(w.document.getElementById('paymentTitle').textContent,/تفعيل/);assert.match(w.document.getElementById('paymentAmount').textContent,/USD/);assert.equal(w.document.getElementById('backToRegistration').href,'https://www.inexctraining.com/my-card/?token=LOCAL-CARD');
});
test('administrator toggles membership methods only; electronic orders have refresh instead of manual approval',async t=>{
 const dom=new JSDOM('<body><div class="tabs"></div><main></main></body>',{url:'https://www.inexctraining.com/admin-portal.html',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,requests=[];w.INEXC_REGISTRATION_ENDPOINT='https://api.example.invalid/api';w.alert=()=>{};
 w.fetch=async(url,init)=>{requests.push({url,init});if(init.method==='PUT')return response({ok:true});if(url.endsWith('/memberships/plans'))return response([plan]);if(url.endsWith('/memberships/payment-options'))return response(options);if(url.endsWith('/memberships/orders'))return response([{id:'LOCAL-ELECTRONIC',payment_method:'stripe',status:'بانتظار الدفع',name:'LOCAL BUYER',email:'local@example.invalid',total:39,plan_name:plan.name,reference:'LOCAL-REF'},{id:'LOCAL-BANK',payment_method:'bank',status:'بانتظار مراجعة الدفع',name:'LOCAL BUYER 2',total:39}]);return response([])};
 w.eval(await read('inexc-memberships-admin.js'));w.dispatchEvent(new w.Event('DOMContentLoaded'));await flush();w.document.querySelector('[data-view=memberships]').click();await flush();await flush();const card=w.document.querySelector('[data-membership-plan="'+plan.id+'"]');assert.equal(card.querySelector('[data-payment=stripe]').checked,true);card.querySelector('[data-payment=bank]').checked=false;card.querySelector('[data-save-plan]').click();await flush();await flush();const saved=requests.find(r=>r.init.method==='PUT');assert.equal(saved.url,'https://api.example.invalid/api/admin/memberships/plans/'+plan.id);assert.deepEqual(JSON.parse(saved.init.body).paymentMethods,['stripe']);assert.equal(w.document.querySelector('[data-order=LOCAL-ELECTRONIC] [data-approve]'),null);assert.ok(w.document.querySelector('[data-order=LOCAL-ELECTRONIC] [data-refresh-payment]'));assert.ok(w.document.querySelector('[data-order=LOCAL-BANK] [data-approve]'));assert.ok(!requests.some(r=>r.init.method==='PUT'&&r.url.includes('/courses')));
});

test('email details link focuses the exact card; direct booking opens only its existing form',async t=>{
 const second={...plan,id:'22222222-2222-4222-8222-222222222222',name:'بطاقة ثانية محلية',priceUsd:79,validMonths:6},catalog=[plan,second];
 const details=await purchase({catalog,query:'?plan='+second.id,autoOpen:false});t.after(()=>details.w.close());
 assert.equal(details.q('#dialog').open,false);assert.equal(details.w.document.activeElement.querySelector('[data-plan]').dataset.plan,second.id);assert.equal(details.w.document.activeElement.dataset.scrolled,'true');
 details.q('[data-plan="'+second.id+'"]').click();assert.equal(details.q('#planId').value,second.id);assert.equal(details.q('#summaryPrice').textContent,'79.00');
 const book=await purchase({catalog,query:'?book='+second.id,autoOpen:false});t.after(()=>book.w.close());
 assert.equal(book.q('#dialog').open,true);assert.equal(book.q('#planId').value,second.id);assert.equal(book.q('#summaryPlan').textContent,'باقة ثانية محلية');assert.equal(book.q('#name').value,'');
 for(const h of [details,book])assert.equal(h.requests.some(r=>r.init?.method==='POST'),false);
});
test('email links cannot book a sold-out or unknown plan, and existing payment resume wins',async t=>{
 const sold=await purchase({catalog:[{...plan,remaining:0}],query:'?book='+plan.id,autoOpen:false});t.after(()=>sold.w.close());assert.equal(sold.q('#dialog').open,false);assert.equal(sold.q('[data-plan]').disabled,true);
 const missing=await purchase({query:'?book=deleted-plan',autoOpen:false});t.after(()=>missing.w.close());assert.equal(missing.q('#dialog').open,false);assert.match(missing.q('[role=status]').textContent,/الباقة المطلوبة غير متاحة/);assert.ok(missing.q('[data-plan]'));
 const resume=await purchase({query:'?resume=1&book=another-plan',autoOpen:false,draft:{plan_id:plan.id,name:'LOCAL SAVED',email:'saved@example.invalid',createdAt:Date.now()}});t.after(()=>resume.w.close());assert.equal(resume.q('#dialog').open,true);assert.equal(resume.q('#planId').value,plan.id);assert.equal(resume.q('#name').value,'LOCAL SAVED');
 for(const h of [sold,missing,resume])assert.equal(h.requests.some(r=>r.init?.method==='POST'),false);
});
