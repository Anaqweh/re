import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import QRCode from 'qrcode';

const base=fileURLToPath(new URL('../../',import.meta.url));
const source=path=>readFileSync(base+path,'utf8');
const payload=()=>({profile:{full_name:'سارة محمد عبدالله',specialty:'التعليم',email:'private@example.com',phone:'private-phone'},digitalId:{idNumber:'INEXC-123',verifyUrl:'https://www.inexctraining.com/digital-id.html?id=12345678-1234-1234-1234-123456789abc',tierKey:'silver',trainingHours:40},professionalValue:{overallReadiness:80},certificates:[{course_name:'دورة تعليمية',certificate_number:'CERT-123'}]});
function setup(query=''){
 const dom=new JSDOM(source('digital-id.html'),{url:'https://www.inexctraining.com/digital-id.html'+query,runScripts:'outside-only'});
 const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.fetch=()=>{throw Error('Network calls are prohibited in this test')};
 w.eval(source('vendor/inexc-qr.js'));w.eval(source('js/trainee-card.js'));
 return {dom,w,root:w.document.getElementById('publicIdRoot')};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));

test('card renders real training data without private contact details or unproven approval',()=>{
 const {dom,w,root}=setup();const p=payload();p.professionalValue.overallReadiness=150;p.digitalId.trainingHours=Infinity;
 w.TraineeCard.mount(root,p);
 assert.match(root.textContent,/مسجّل لدى INEXC/);
 assert.doesNotMatch(root.innerHTML,/private@example|private-phone|معتمدة/);
 assert.equal(root.querySelectorAll('.tc-certificate').length,1);
 assert.equal(w.TraineeCard.model(p).progress,100);assert.equal(w.TraineeCard.model(p).hours,0);
 const qr=QRCode.create(p.digitalId.verifyUrl,{errorCorrectionLevel:'M'});
 const svg=root.querySelector('.tc-qr svg');assert.equal(svg.getAttribute('viewBox'),`0 0 ${qr.modules.size+8} ${qr.modules.size+8}`);
 assert.equal((svg.querySelector('path').getAttribute('d').match(/M/g)||[]).length,Array.from(qr.modules.data).filter(Boolean).length);
 assert.equal(root.querySelector('.tc-qr img'),null);dom.window.close();
});

test('untrusted profile and certificate text is escaped and unsafe images are rejected',()=>{
 const {dom,w,root}=setup();const p=payload();p.profile.full_name='<img src=x onerror=alert(1)>';p.profile.avatar_url='javascript:alert(1)';p.certificates[0].course_name='<script>danger()</script>';
 w.TraineeCard.mount(root,p);
 assert.equal(root.querySelector('.tc-name').textContent,p.profile.full_name);
 assert.equal(root.querySelector('.tc-certificate strong').textContent,p.certificates[0].course_name);
 assert.equal(root.querySelector('.tc-avatar img'),null);assert.equal(root.querySelector('script'),null);dom.window.close();
});

test('copy shares the exact card URL and print cleanup restores the page',async()=>{
 const {dom,w,root}=setup();const p=payload();let copied,printed=false;
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text}}});
 w.print=()=>{printed=w.document.body.classList.contains('tc-printing')&&root.querySelector('.tc-card').classList.contains('tc-print-target');};
 w.TraineeCard.mount(root,p);root.querySelector('[data-tc-action=copy]').click();await tick();
 assert.equal(copied,p.digitalId.verifyUrl);assert.match(root.querySelector('.tc-feedback').textContent,/تم نسخ/);
 root.querySelector('[data-tc-action=print]').click();await tick();assert.equal(printed,true);
 w.dispatchEvent(new w.Event('afterprint'));assert.equal(w.document.body.classList.contains('tc-printing'),false);assert.equal(root.querySelector('.tc-print-target'),null);dom.window.close();
});

test('standalone download embeds assets, retains preview status, and tolerates unavailable photo',async()=>{
 const {dom,w}=setup();const p=payload();p.profile.full_name='اسم طويل جدًا لاختبار عرض الاسم في البطاقة بشكل واضح ومنظم';p.profile.avatar_url='https://images.invalid/photo.jpg';
 const requested=[];w.fetch=async path=>{requested.push(path);if(path.includes('images.invalid'))throw Error('offline');return {ok:true,blob:async()=>new w.Blob(['fixture'],{type:path.endsWith('woff2')?'font/woff2':'image/jpeg'})}};
 const svg=await w.TraineeCard.svgFile(p,{demo:true});const doc=new w.DOMParser().parseFromString(svg,'image/svg+xml');
 assert.equal(doc.querySelector('parsererror'),null);assert.match(doc.documentElement.textContent,/نموذج توضيحي — غير صادر/);assert.match(doc.documentElement.textContent,/العضوية الفضية/);
 assert.equal(doc.querySelectorAll('image').length,1);assert.ok(doc.querySelector('image').getAttribute('href').startsWith('data:image/jpeg;'));
 assert.match(svg,/data:font\/woff2;base64/);assert.doesNotMatch(svg,/private@example|images.invalid/);
 assert.equal(requested.length,3);assert.ok(Array.from(doc.querySelectorAll('text')).every(n=>n.textContent.trim()));dom.window.close();
});

test('preview works without loading auth or reading any trainee records',()=>{
 const {dom,w,root}=setup('?preview=1');w.eval(source('js/trainee-card-page.js'));
 assert.match(root.textContent,/INEXC-DEMO-001/);assert.match(root.textContent,/غير صادر/);assert.equal(w.document.getElementById('previewNotice').hidden,false);
 assert.equal(w.document.querySelector('script[src*=supabase]'),null);dom.window.close();
});

test('invalid lookup is actionable and never loads data services',()=>{
 const {dom,w}=setup();w.eval(source('js/trainee-card-page.js'));w.document.getElementById('cardReference').value='not-a-record';
 w.document.getElementById('cardLookup').dispatchEvent(new w.Event('submit',{cancelable:true}));
 assert.match(w.document.getElementById('lookupError').textContent,/الصحيح/);assert.equal(w.document.getElementById('cardReference').getAttribute('aria-invalid'),'true');assert.equal(w.document.querySelector('script[src*=supabase]'),null);dom.window.close();
});

test('existing public record loader renders the record, and missing records offer recovery',async()=>{
 for(const missing of [false,true]){
  const id='12345678-1234-1234-1234-123456789abc';const {dom,w,root}=setup('?id='+id);const calls=[];
  w.TraineeAuth={withTimeout:p=>p,loadPublicDigitalId:async value=>{calls.push(value);return missing?null:payload()}};
  const append=w.document.head.append.bind(w.document.head);w.document.head.append=node=>{append(node);queueMicrotask(()=>node.onload())};
  w.eval(source('js/trainee-card-page.js'));await tick();assert.deepEqual(calls,[id]);
  if(missing){assert.match(root.textContent,/لم نجد سجلًا/);assert.ok(root.querySelector('#retryCard'));}else{assert.match(root.textContent,/INEXC-123/);assert.match(w.document.title,/سارة/);}
  dom.window.close();
 }
});

function previewClock(w){
 const timers=new Map();let id=0;w.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id};w.clearTimeout=id=>timers.delete(id);
 Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 return {timers,fire(){const timer=[...timers.values()].find(t=>t.delay===3000);assert.ok(timer);timer.fn()}};
}
test('landing page shows the original sample card after 3000ms and can return to lookup',()=>{
 const {dom,w}=setup();const clock=previewClock(w);w.eval(source('js/trainee-card-page.js'));assert.equal(w.document.querySelector('.tc-promo'),null);assert.equal([...clock.timers.values()].filter(t=>t.delay===3000).length,1);
 clock.fire();const dialog=w.document.querySelector('.tc-promo');assert.equal(dialog.open,true);assert.equal(dialog.querySelectorAll('.tc-card').length,1);assert.match(dialog.textContent,/INEXC-DEMO-001/);assert.match(dialog.textContent,/غير صادرة/);assert.equal(dialog.querySelector('.tc-promo-actions a').getAttribute('href'),'/cards/');assert.equal(w.document.querySelector('script[src*=supabase]'),null);
 dialog.querySelector('[data-have-card]').click();assert.equal(w.document.querySelector('.tc-promo'),null);assert.equal(w.document.activeElement,w.document.getElementById('cardReference'));clock.fire();assert.equal(w.document.querySelector('.tc-promo'),null);dom.window.close();
});
test('typing or focused lookup prevents the timed card preview',()=>{
 for(const action of ['input','focus']){
  const {dom,w}=setup();const clock=previewClock(w);w.eval(source('js/trainee-card-page.js'));const input=w.document.getElementById('cardReference');
  if(action==='input'){input.value='record';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(clock.timers.size,0)}else{input.focus();clock.fire()}
  assert.equal(w.document.querySelector('.tc-promo'),null);dom.window.close();
 }
});
test('hidden page defers sample until visible and close button removes it',()=>{
 const {dom,w}=setup();const clock=previewClock(w);Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});w.eval(source('js/trainee-card-page.js'));clock.fire();assert.equal(w.document.querySelector('.tc-promo'),null);
 Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});w.document.dispatchEvent(new w.Event('visibilitychange'));assert.equal(w.document.querySelector('.tc-promo').open,true);w.document.querySelector('.tc-promo-close').click();assert.equal(w.document.querySelector('.tc-promo'),null);dom.window.close();
});
test('explicit preview and real or malformed card links never schedule promotional dialog',()=>{
 for(const query of ['?preview=1','?id=12345678-1234-1234-1234-123456789abc','?id=invalid']){
  const {dom,w}=setup(query);const clock=previewClock(w);w.eval(source('js/trainee-card-page.js'));assert.equal([...clock.timers.values()].some(t=>t.delay===3000),false);assert.equal(w.document.querySelector('.tc-promo'),null);dom.window.close();
 }
});
