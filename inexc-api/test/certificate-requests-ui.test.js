import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
const id='11111111-1111-4111-8111-111111111111',token='a'.repeat(64);
async function page(hash='#request='+id+'&token='+token){const dom=new JSDOM(await read('certificate-request.html'),{url:'https://local.invalid/certificate-request.html'+hash,runScripts:'outside-only'});if(dom.window.document.readyState!=='complete')await new Promise(r=>dom.window.addEventListener('load',r,{once:true}));dom.window.INEXC_REGISTRATION_ENDPOINT='https://api.local.invalid/api';return dom}
const record={id,reference:'LOCAL-REQUEST',courseName:'الرخصة الدولية لقيادة الذكاء الاصطناعي في التعليم',certificateName:'شهادة تدريبية',amount:0,currency:'AED',arabicName:'',englishName:'',state:'requested',namesConfirmed:false,namesLocked:false,canPay:false};
test('private link sends credentials in a POST body, escapes names and confirms zero-fee names without payment',async()=>{
 const dom=await page(),w=dom.window,el=id=>w.document.getElementById(id),calls=[];
 w.fetch=async(url,opt)=>{calls.push({url,opt});return {ok:true,json:async()=>url.endsWith('/status')?{...record,courseName:'<script>SAFE</script>'}:{state:'no_fee'}}};
 w.eval(await read('certificate-request.js'));await tick();assert.equal(el('certContent').hidden,false);assert.equal(el('certCourse').textContent,'<script>SAFE</script>');assert.equal(el('certCourse').children.length,0);assert.equal(el('certContinue').disabled,false);assert.match(el('certContinue').textContent,/تأكيد/);assert.equal(calls[0].url.includes(token),false);assert.equal(JSON.parse(calls[0].opt.body).token,token);
 el('certArabic').value='أحمد محمد عناقوة';el('certEnglish').value='Ahmad Mohammad Anakwa';el('certNamesConsent').checked=true;el('certForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));el('certForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].opt.body).englishName,'Ahmad Mohammad Anakwa');assert.equal(el('certDone').hidden,false);assert.match(el('certDoneText').textContent,/لا توجد رسوم/);dom.window.close();
});
test('missing token never requests private data; unavailable and failed payment keep registration clear',async()=>{
 const invalid=await page('');let calls=0;invalid.window.fetch=async()=>{calls++;throw Error('must not fetch')};invalid.window.eval(await read('certificate-request.js'));assert.equal(calls,0);assert.match(invalid.window.document.getElementById('certMessage').textContent,/بريدك/);invalid.window.close();
 const dom=await page(),w=dom.window;w.fetch=async()=>({ok:true,json:async()=>({...record,amount:199,canPay:false})});w.eval(await read('certificate-request.js'));await tick();assert.equal(w.document.getElementById('certContinue').disabled,true);assert.match(w.document.getElementById('certMessage').textContent,/تسجيلك في الدورة مؤكد/);dom.window.close();
});
test('admin lists both names, per-course/payment filters and clears data on logout; it sends no mail',async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="app"><main><div class="tabs"></div></main></div></body>',{url:'https://local.invalid/admin-portal.html',runScripts:'outside-only'}),w=dom.window;let valid=true;const calls=[];
 w.INEXC_REGISTRATION_ENDPOINT='https://api.local.invalid/api';w.INEXCAdminSession={valid:()=>valid};w.sessionStorage.setItem('inexc_do_admin','LOCAL_ADMIN');
 w.fetch=async(url,opt)=>{calls.push({url,opt});return {ok:true,json:async()=>({items:[{registration_id:id,request_id:id,reference:'LOCAL',course_id:id,course_name:'دورة توضيحية',name:'LOCAL',arabic_name:'أحمد محمد عناقوة',english_name:'Ahmad Mohammad Anakwa',email:'local@example.invalid',certificate:'شهادة',certificate_amount:199,state:'paid',email_status:'sent',requested_at:'2026-10-18',names_confirmed_at:'2026-10-18'}],summary:{total:1,paid:1,pending:0,no_fee:0},courses:[{course_id:id,course_name:'دورة توضيحية',total:1}],offset:0,hasMore:false})}};
 if(w.document.readyState!=='complete')await new Promise(r=>w.addEventListener('load',r,{once:true}));w.eval(await read('admin-certificate-requests.js'));w.document.querySelector('[data-view="certificate-requests"]').click();await tick();
 assert.match(w.document.querySelector('[data-cert-body]').textContent,/Ahmad Mohammad Anakwa/);assert.equal(w.document.querySelector('[data-cert-metric="paid"]').textContent,(1).toLocaleString('ar-AE'));
 const course=w.document.querySelector('[data-cert-course]');course.value=id;course.dispatchEvent(new w.Event('change'));await tick();assert.equal(new URL(calls.at(-1).url).searchParams.get('course'),id);const status=w.document.querySelector('[data-cert-filter]');status.value='paid';status.dispatchEvent(new w.Event('change'));await tick();assert.equal(new URL(calls.at(-1).url).searchParams.get('state'),'paid');assert.ok(calls.every(c=>!c.opt.method||c.opt.method==='GET'));
 valid=false;w.dispatchEvent(new w.Event('inexc:locked'));assert.equal(w.document.querySelector('[data-cert-body]').textContent,'');assert.ok(!w.document.body.textContent.includes('local@example.invalid'));dom.window.close();
});
