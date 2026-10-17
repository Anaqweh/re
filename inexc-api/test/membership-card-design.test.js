import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const base=fileURLToPath(new URL('../../',import.meta.url));
const source=path=>readFileSync(base+path,'utf8');
const fixture=()=>({cardName:'بطاقة الانطلاقة',cardNumber:'INX-EXAMPLE-001',holderName:'اسم حامل البطاقة',holderEmail:'private@example.com',status:'active',expiresAt:'2099-01-28T00:00:00Z',unitsTotal:2,unitsRemaining:0,plan:{name:'باقة الانطلاقة',certificateDiscount:10,earlyAccessHours:0},redemptions:[{courseName:'دورة تعليمية',unitsUsed:1,createdAt:'2026-10-16T12:00:00Z'}]});
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function setup(query='',snapshot=fixture(),ok=true){
 const dom=new JSDOM(source('my-card/index.html'),{url:'https://www.inexctraining.com/my-card/'+query,runScripts:'outside-only'}),w=dom.window,calls=[];
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.INEXC_REGISTRATION_ENDPOINT='https://api.example.test/api';
 w.fetch=async url=>{calls.push(url);return {ok,json:async()=>snapshot}};
 for(const file of ['vendor/inexc-qr.js','js/trainee-card.js','course-card-labels.js','my-card/card.js'])w.eval(source(file));
 return {dom,w,calls};
}
test('real token lookup uses the approved visual card with original membership data and history',async()=>{
 const {dom,w,calls}=setup('?token=private-bearer');await tick();
 const d=w.document;assert.equal(calls.length,1);assert.match(calls[0],/memberships\/card\?token=private-bearer$/);
 assert.equal(d.querySelector('.tc-card-type strong').textContent,'بطاقة الانطلاقة');
 assert.equal(d.querySelector('.tc-card-type span').textContent,'INEXC MEMBERSHIP CARD');
 assert.equal(d.querySelector('.tc-name').textContent,'اسم حامل البطاقة');
 assert.equal(d.querySelector('.tc-number').textContent,'INX-EXAMPLE-001');
 assert.equal(d.querySelector('.tc-number-label').textContent,'رقم البطاقة');
 assert.equal(d.querySelector('.tc-logo').getAttribute('src'),'/assets/inexc-approved-logo.jpg');
 assert.equal(d.querySelector('.tc-tier').textContent,'الرصيد مستنفد');
 assert.equal(d.querySelector('#credits').textContent,'0 من 2');assert.equal(d.querySelector('#discount').textContent,'10%');
 assert.equal(d.querySelectorAll('#history .entry').length,1);assert.match(d.querySelector('#history').textContent,/دورة تعليمية/);
 const expected=d.createElement('div');expected.innerHTML=w.TraineeCard.qrMarkup('https://www.inexctraining.com/my-card/');assert.equal(d.querySelector('.tc-qr svg').outerHTML,expected.firstElementChild.outerHTML);
 assert.equal(d.querySelector('.digital'),null);assert.equal(d.querySelector('[data-tc-action=copy]'),null);
 assert.doesNotMatch(d.querySelector('#result').innerHTML,/private-bearer|private@example/);dom.window.close();
});
test('code/email lookup retains endpoint and escapes names and booking history',async()=>{
 const p=fixture();delete p.cardName;p.plan.name='باقة التمكّن';p.holderName='<img src=x onerror=bad()>';p.redemptions[0].courseName='<script>bad()</script>';
 const {dom,w,calls}=setup('',p),d=w.document;assert.equal(calls.length,0);
 d.querySelector('#code').value='INX-EXAMPLE-001';d.querySelector('#email').value='private@example.com';d.querySelector('#show').click();await tick();
 assert.match(calls[0],/code=INX-EXAMPLE-001&email=private%40example.com$/);
 assert.equal(d.querySelector('.tc-card-type strong').textContent,'بطاقة التمكّن');assert.equal(d.querySelector('.tc-name').textContent,p.holderName);
 assert.equal(d.querySelector('#history b').textContent,p.redemptions[0].courseName);assert.equal(d.querySelector('#history script'),null);
 assert.equal(d.querySelector('#lookup').style.display,'none');dom.window.close();
});
test('membership download uses a PNG filename while retaining the approved card design and safe QR',async()=>{
 const {dom,w}=setup('?token=private-bearer');await tick();let filename,mime;
 w.fetch=async path=>({ok:true,blob:async()=>new w.Blob(['fixture'],{type:path.endsWith('woff2')?'font/woff2':'image/jpeg'})});
 const output=await w.TraineeCard.svgFile({profile:{full_name:'اسم حامل البطاقة',specialty:'باقة الانطلاقة'},digitalId:{idNumber:'INX-EXAMPLE-001',tierLabel:'الرصيد مستنفد'}},{title:'بطاقة الانطلاقة',subtitle:'INEXC MEMBERSHIP CARD',qrUrl:'https://www.inexctraining.com/my-card/'});
 const svg=new w.DOMParser().parseFromString(output,'image/svg+xml');
 assert.equal(svg.querySelector('parsererror'),null);assert.match(svg.documentElement.textContent,/بطاقة الانطلاقة/);
 assert.doesNotMatch(output,/private-bearer|private@example/);assert.match(output,/data:image\/jpeg;base64/);assert.match(output,/data:font\/woff2;base64/);
 w.TraineeCard.pngFile=async()=>new w.Blob(['png'],{type:'image/png'});
 w.TraineeCard.downloadPNG=(blob,number)=>{mime=blob.type;filename='INEXC-card-'+number+'.png'};
 w.document.querySelector('#downloadCard').click();for(let i=0;i<20&&!filename;i++)await tick();
 assert.equal(mime,'image/png');assert.equal(filename,'INEXC-card-INX-EXAMPLE-001.png');
 assert.match(w.document.querySelector('#downloadStatus').textContent,/PNG/);dom.window.close();
});
test('preview is visibly non-issued and never fetches membership records',()=>{
 const {dom,w,calls}=setup('?preview=1');assert.equal(calls.length,0);assert.equal(w.document.querySelector('#previewNotice').hidden,false);
 assert.match(w.document.querySelector('.tc-card-strip').textContent,/غير صادر/);assert.equal(w.document.querySelector('.tc-card-type strong').textContent,'بطاقة الريادة');dom.window.close();
});
test('public sharing shows the same card artwork without the membership number or private details',async()=>{
 const safe={holderName:'اسم حامل البطاقة',cardName:'بطاقة الانطلاقة',status:'active',expiresAt:'2099-01-28T00:00:00Z',plan:{name:'باقة الانطلاقة'}};
 const {dom,w,calls}=setup('?share=public-share',safe);await tick();const d=w.document;
 assert.match(calls[0],/memberships\/card\/shared\?share=public-share$/);
 assert.equal(d.querySelector('.tc-card-type strong').textContent,'بطاقة الانطلاقة');
 assert.equal(d.querySelector('.tc-number').textContent,'INEXC');
 assert.equal(d.querySelector('.tc-name').textContent,'اسم حامل البطاقة');
 assert.equal(d.querySelector('#shareTools').hidden,true);
 assert.equal(d.querySelector('.stats').hidden,true);
 assert.equal(d.querySelector('.history').hidden,true);
 assert.equal(d.querySelector('#learnerWorkspaceLink').parentElement.hidden,true);
 assert.doesNotMatch(d.querySelector('#result').textContent,/INX-EXAMPLE-001|private@example.com/);
 dom.window.close();
});
test('private card offers share notice before creating a distinct public URL',async()=>{
 const {dom,w}=setup('?token=private-bearer');await tick();const d=w.document;
 assert.equal(d.querySelector('#shareTools').hidden,false);
 assert.match(d.querySelector('.share-note').textContent,/أي شخص لديه الرابط/);
 let request;w.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({url:'https://www.inexctraining.com/my-card/?share=public-token'})}};
 w.navigator.clipboard={writeText:async value=>{assert.match(value,/\?share=public-token$/);assert.doesNotMatch(value,/private-bearer/)}};
 d.querySelector('#copyShare').click();await tick();
 assert.match(request.url,/memberships\/card\/share$/);
 assert.equal(JSON.parse(request.options.body).token,'private-bearer');
 assert.match(d.querySelector('#shareStatus').textContent,/نُسخ/);
 dom.window.close();
});
test('failed lookup keeps recovery controls available and restores the lookup button',async()=>{
 const {dom,w}=setup('?token=invalid',{error:'لم نجد البطاقة'},false);await tick();assert.equal(w.document.querySelector('#error').textContent,'لم نجد البطاقة');assert.equal(w.document.querySelector('#show').disabled,false);assert.equal(w.document.querySelector('.tc-card'),null);dom.window.close();
});
