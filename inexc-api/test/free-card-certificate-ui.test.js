import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=path=>fs.readFile(new URL('../../'+path,import.meta.url),'utf8'),tick=()=>new Promise(r=>setImmediate(r));
const plan='11111111-1111-4111-8111-111111111111',course='22222222-2222-4222-8222-222222222222';
async function page({version=1}={}){
 const dom=new JSDOM(await read('cards/free-course/index.html'),{url:'https://local.invalid/cards/free-course/?plan='+plan,runScripts:'outside-only'}),w=dom.window,calls=[],el=id=>w.document.getElementById(id);
 w.INEXC_REGISTRATION_ENDPOINT='https://api.local.invalid/api';
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
  const data=url.includes('/free-course?')?{certificateSelectionVersion:version,courses:[{id:course,name:'دورة محلية',certificate:{mode:'optional',price:199,name:'شهادة محلية'}},{id:'none',name:'دون شهادة',certificate:{mode:'none',price:0}}]}:url.endsWith('/verify')?{card:{plan:{id:plan,priceUsd:0}},cost:1,certificateFee:body.certificate?199:0}:{reference:'LOCAL',certificateFee:body.certificateRequested?199:0,certificateRequestId:body.certificateRequested?'LOCAL-REQUEST':null};
  return {ok:true,json:async()=>data};
 };
 w.eval(await read('cards/free-course/app.js'));await tick();el('code').value='INX-LOCAL';el('email').value='local@example.invalid';
 const verify=async()=>{el('lookup').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick()};
 return {dom,w,el,calls,verify};
}
test('free card page carries certificate selection through verification and booking, with a fee/email summary',async t=>{
 const p=await page();t.after(()=>p.dom.window.close());assert.equal(p.el('certificateChoice').hidden,false);assert.equal(p.el('certificate').value,'no');
 p.el('certificate').value='yes';await p.verify();assert.equal(p.calls.at(-1).body.certificate,true);assert.match(p.el('certificateSummary').textContent,/رابط الدفع بالبريد/);
 p.el('edit').click();assert.equal(p.el('lookup').hidden,false);assert.equal(p.el('certificate').value,'yes');await p.verify();
 p.el('agree').click();p.el('agree').click();await tick();const requests=p.calls.filter(c=>c.url.endsWith('/register'));assert.equal(requests.length,1);assert.equal(requests[0].body.certificateRequested,true);assert.equal(requests[0].body.expectedCertificateFee,199);assert.equal(requests[0].body.shareConsent,true);
 assert.equal(p.el('success').hidden,false);assert.equal(p.el('certificateSuccess').hidden,false);assert.match(p.el('certificateSuccess').textContent,/خلال دقائق/);
});
test('declining certificate creates no certificate request; changing courses resets its choice',async t=>{
 const p=await page();t.after(()=>p.dom.window.close());p.el('certificate').value='yes';p.el('course').value='none';p.el('course').dispatchEvent(new p.w.Event('change'));assert.equal(p.el('certificateChoice').hidden,true);assert.equal(p.el('certificate').value,'no');
 p.el('course').value=course;p.el('course').dispatchEvent(new p.w.Event('change'));await p.verify();assert.equal(p.calls.at(-1).body.certificate,false);p.el('agree').click();await tick();assert.equal(p.calls.at(-1).body.certificateRequested,false);assert.equal(p.el('certificateSuccess').hidden,true);
});
test('older API uses existing certificate-aware registration instead of silently dropping the choice',async t=>{
 const p=await page({version:0});t.after(()=>p.dom.window.close());assert.equal(p.el('lookup').hidden,true);assert.equal(p.el('notice').querySelector('a').getAttribute('href'),'/register/?course_id='+course);assert.equal(p.calls.length,1);
});
