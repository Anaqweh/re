// Local DOM fixtures only: no live checkout, email or customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
const course={id:'11111111-1111-4111-8111-111111111111',name:'LOCAL COURSE',price:199.25,certificate:{mode:'optional',name:'LOCAL CERT',price:50.50},payments:['bank'],bank:{name:'LOCAL',account:'0000'}};
for(const page of ['register/index.html','register.html'])test(page+': Stripe capability, retained certificate and retry use one nonce without a receipt',async t=>{
 const dom=new JSDOM(await read(page),{url:'https://local.invalid/'+page+'?course_id='+course.id+'&resume=stripe',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 if(w.document.readyState!=='complete')await new Promise(r=>w.addEventListener('load',r,{once:true}));
 const el=id=>w.document.getElementById(id),requests=[],alerts=[];let finish;
 const draft={name:'LOCAL',email:'local@example.invalid',phone:'000000',course_id:course.id,certificate:'yes'};w.sessionStorage.setItem('inexc_stripe_draft',JSON.stringify(draft));
 w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.alert=message=>alerts.push(message);
 w.fetch=async(url,opt={})=>{requests.push({url,opt});if(url.endsWith('/courses'))return {ok:true,json:async()=>[course]};if(url.endsWith('/capabilities'))return {ok:true,json:async()=>({enabled:true})};if(url.endsWith('/checkout'))return new Promise(resolve=>finish=resolve);throw Error('Unexpected request')};
 w.eval([...w.document.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n')+'\n'+await read(page.startsWith('register/')?'register/inexc-do-registration.js':'inexc-do-registration.js'));
 w.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 assert.equal(el('name').value,'LOCAL');assert.equal(w.document.querySelector('[name=certificate][value=yes]').checked,true);
 const choice=w.document.querySelector('[name=payment][value=stripe]');assert.ok(choice);choice.checked=true;choice.dispatchEvent(new w.Event('change'));assert.equal(el('receipt').required,false);assert.equal(el('bankBox').classList.contains('show'),false);assert.equal(el('submitButton').textContent,'المتابعة إلى Stripe');
 for(let i=0;i<2;i++)el('registrationForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 let posted=requests.filter(r=>r.url.endsWith('/checkout'));assert.equal(posted.length,1);const input=JSON.parse(posted[0].opt.body);assert.equal(input.certificate,'yes');assert.equal(input.course_id,course.id);assert.equal(input.amount,undefined);assert.equal(input.receipt,undefined);assert.match(input.request_key,/^[a-f\d-]{36}$/);
 finish({ok:false,status:503,json:async()=>({error:'LOCAL RETRY'})});await tick();assert.equal(el('submitButton').disabled,false);assert.equal(alerts.at(-1),'LOCAL RETRY');
 el('registrationForm').dispatchEvent(new w.Event('submit',{cancelable:true}));posted=requests.filter(r=>r.url.endsWith('/checkout'));assert.equal(posted.length,2);assert.equal(JSON.parse(posted[1].opt.body).request_key,input.request_key);assert.equal(requests.filter(r=>r.url.endsWith('/registrations')).length,0);
 finish({ok:false,status:410,json:async()=>({error:'LOCAL EXPIRED'})});await tick();assert.equal(w.sessionStorage.getItem('inexc_stripe_attempt'),null);
 w.INEXCStripeEnabled=false;w.eval('renderPayments();updateSummary()');assert.equal(w.document.querySelector('[name=payment][value=stripe]'),null);assert.equal(el('receipt').required,true);
});
test('status page ignores success URL claims, clears the private token from URL, and confirms only a verified response',async t=>{
 const dom=new JSDOM(await read('payment-status.html'),{url:'https://local.invalid/payment-status.html?success=1#checkout=LOCAL-ID&token=LOCAL-TOKEN&cancelled=1',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());let state='open';const requests=[];
 w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.fetch=async(url,opt)=>{requests.push({url,opt});return {ok:true,json:async()=>({state,reference:'LOCAL-REFERENCE',courseName:'LOCAL COURSE',amount:249.75,registrationStatus:state==='paid'?'مؤكد':'بانتظار الدفع',paymentLink:'https://checkout.stripe.com/c/pay/LOCAL'})}};
 w.eval(await read('register/stripe-status.js'));await tick();const el=id=>w.document.getElementById(id);
 assert.equal(w.location.hash,'');assert.equal(w.location.search,'');assert.equal(el('paymentTitle').textContent,'لم يكتمل الدفع بعد');assert.equal(el('resumePayment').hidden,false);assert.deepEqual(JSON.parse(requests[0].opt.body),{checkout:'LOCAL-ID',token:'LOCAL-TOKEN'});
 state='paid';el('checkPayment').click();await tick();assert.equal(el('paymentTitle').textContent,'تم الدفع بنجاح');assert.equal(el('resumePayment').hidden,true);assert.equal(el('checkPayment').hidden,true);assert.equal(el('backToRegistration').pathname,'/account.html');assert.equal(el('paymentReference').textContent,'LOCAL-REFERENCE');
});
