import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,ResourceLoader,VirtualConsole} from 'jsdom';
const root=new URL('../../',import.meta.url),read=file=>fs.readFile(new URL(file,root),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('large registration lists stay bounded, retain selection across pages and deduplicate concurrent reads',async t=>{
 const html=await read('admin-portal.html'),dom=new JSDOM(html,{url:'https://local.invalid/admin-portal.html',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());await tick();
 const rows=Array.from({length:1000},(_,i)=>({id:'r'+i,name:'متدرب '+i,email:'learner'+i+'@example.invalid',course_id:'c',course_name:'دورة',created_at:'2026-10-18',total:0,status:'مسجل بالبطاقة',payment_method:'membership'}));
 const requests=[];w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.sessionStorage.setItem('inexc_do_admin','LOCAL');w.INEXCAdminSession={valid:()=>true};w.INEXCAdminDrafts={restore(){},captureScope(){}};
 w.fetch=async url=>{requests.push(url);await tick();return {ok:true,json:async()=>url.endsWith('/registrations')?rows:[{id:'c',name:'دورة',price:0,active:true,certificate:{mode:'none'},payments:[]}]}};
 w.eval(w.document.querySelector('script:not([src])').textContent);await tick();await tick();
 const q=s=>w.document.querySelector(s);assert.equal(q('#total').textContent,'1000');assert.equal(w.document.querySelectorAll('#table tbody tr').length,50);
 assert.equal(requests.filter(u=>u.endsWith('/courses')).length,1);
 const firstRow=q('#table tbody tr');q('#allPick').click();assert.equal(q('#table tbody tr'),firstRow,'select-all must not rebuild the table');assert.match(q('#pickInfo').textContent,/1000/);
 q('[data-registration-next]').click();assert.equal(q('#table .pick').dataset.id,'r50');assert.equal(q('#table .pick').checked,true);
 q('#table .pick').click();assert.match(q('#pickInfo').textContent,/999/);assert.equal(q('#allPick').indeterminate,true);
 q('[data-registration-prev]').click();assert.equal(q('#table .pick').dataset.id,'r0');assert.equal(q('#table .pick').checked,true);
 q('#search').value='learner999@';q('#search').dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,150));assert.equal(q('#table .pick').dataset.id,'r999');assert.equal(q('#total').textContent,'1');assert.equal(q('[data-registration-next]'),null);
 const courseReads=requests.filter(u=>u.endsWith('/courses')).length,registrationReads=requests.filter(u=>u.endsWith('/registrations')).length;
 await Promise.all([w.loadRows(),w.loadRows()]);assert.equal(requests.filter(u=>u.endsWith('/courses')).length,courseReads);assert.equal(requests.filter(u=>u.endsWith('/registrations')).length,registrationReads+1);
 await Promise.all([w.loadCourses(),w.loadCourses()]);assert.equal(requests.filter(u=>u.endsWith('/courses')).length,courseReads+1);
 // A read started before a mutation must not overwrite a fresh post-mutation read.
 const pending=[];w.fetch=()=>new Promise(resolve=>pending.push(resolve));
 const old=w.loadRows(),fresh=w.loadRows({force:true});
 pending[1]({ok:true,json:async()=>[]});await fresh;assert.equal(q('#total').textContent,'0');
 pending[0]({ok:true,json:async()=>rows});await old;assert.equal(q('#total').textContent,'0');
});

test('draft recovery ignores unrelated mutations, saves the last keystroke and restores dynamic fields/options',async t=>{
 const dom=new JSDOM('<section id="app"><div class="bar"></div><div class="tabs"></div><section class="view" id="courses"><form id="courseForm"><h2 id="courseTitle"></h2><input id="courseId"><input id="courseName"><select id="choice"><option>a</option><option>b</option></select><input type="radio" name="group" value="a" checked><input type="radio" name="group" value="b"></form></section><p id="counter"></p></section>',{url:'https://local.invalid',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());await tick();
 w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.fetch=async()=>new Response('{}');w.eval(await read('admin-workspace.js'));w.INEXCAdminSession.start('LOCAL');
 const q=s=>w.document.querySelector(s),input=(node,value)=>{node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}))};
 input(q('#courseName'),'مسودة');input(q('#choice'),'b');await tick();
 let scans=0;const original=w.Element.prototype.querySelectorAll;w.Element.prototype.querySelectorAll=function(selector){if(selector==='input,textarea,select')scans++;return original.call(this,selector)};
 for(let i=0;i<10;i++){q('#counter').textContent=String(i);await tick()}
 assert.equal(scans,0,'counter updates must not scan forms');
 input(q('#courseName'),'آخر حرف');assert.equal(scans,0,'typing should update one field, not query the whole scope');
 assert.equal(JSON.parse(w.sessionStorage.getItem('inexc_admin_fields_v1'))['id:courseForm'].fields['id:courseName'].value,'آخر حرف');
 const radio=q('input[value=b]');radio.checked=true;radio.dispatchEvent(new w.Event('change',{bubbles:true}));
 const fields=JSON.parse(w.sessionStorage.getItem('inexc_admin_fields_v1'))['id:courseForm'].fields;assert.equal(fields['name:group:a'].checked,false);assert.equal(fields['name:group:b'].checked,true);
 q('#courseName').outerHTML='<input id="courseName">';q('#choice').innerHTML='<option>a</option>';await tick();assert.equal(q('#courseName').value,'آخر حرف');
 q('#choice').insertAdjacentHTML('beforeend','<option>b</option>');await tick();assert.equal(q('#choice').value,'b');
});

class LocalResources extends ResourceLoader {
 fetch(url){const parsed=new URL(url);if(parsed.origin!=='https://local.invalid'||!parsed.pathname.endsWith('.js'))return null;return fs.readFile(new URL('.'+parsed.pathname,root));}
}
for(const file of ['index.html','course/index.html','course.html','register/index.html','register.html'])test(file+': actual deferred script order loads courses and keeps public controls usable',async t=>{
 const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const course={id:'c',name:'دورة الاختبار',description:'وصف',price:0,axes:['محور'],outcomes:['نتيجة'],certificate:{mode:'optional',name:'شهادة',price:199},payments:[],membershipEnabled:true,active:true};
 const dom=new JSDOM(await read(file),{url:'https://local.invalid/'+file+'?id=c',resources:new LocalResources(),runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.AbortSignal=AbortSignal;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.fetch=async(url,options={})=>{requests.push({url:String(url),method:options.method||'GET'});const path=new URL(url).pathname;
   const data=path.endsWith('/courses')?[course]:path.endsWith('/courses/c')?course:path.endsWith('/memberships/plans')?[{id:'free',name:'الباقة المجانية',priceUsd:0,remaining:10,active:true}]:path.endsWith('/learner/capabilities')?{cardCheckout:2}:path.endsWith('/site-sections')?{courses:true,packages:true,services:true}:path.endsWith('/testimonials')?{visible:false,testimonials:[]}:{};
   return {ok:true,json:async()=>data};};
 }});t.after(()=>dom.window.close());const w=dom.window;
 if(w.document.readyState!=='complete')await new Promise(r=>w.addEventListener('load',r,{once:true}));await tick();await tick();
 assert.deepEqual(errors,[]);assert.ok(w.INEXCCardLabels);
 if(file.startsWith('register')){assert.equal(w.document.getElementById('course').value,'c');assert.ok(w.document.getElementById('membershipCode'));assert.equal(w.document.querySelectorAll('[name=payment]').length,0);assert.match(w.document.getElementById('certificateChoices').textContent,/199/);}
 else if(file==='index.html'){assert.match(w.document.querySelector('.course-grid').textContent,/دورة الاختبار/);assert.equal(w.document.querySelector('.course-link').getAttribute('href'),'/course/?id=c');}
 else {assert.match(w.document.body.textContent,/دورة الاختبار/);const next=w.document.querySelector('.next');assert.ok(next);next.click();assert.equal(w.document.querySelectorAll('.panel.active').length,1);}
 assert.ok(requests.every(r=>r.method==='GET'),'rendering pages must not register, charge or send mail');
});
