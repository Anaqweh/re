import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
const catalog=JSON.parse(await read('inexc-api/course-catalog-20261016.json')).courses.map(c=>({...c,payments:['bank'],bank:{name:'LOCAL',account:'0000'},shareUrl:'https://courses.inexctraining.com/catalog-'+c.slug}));
const courses=[{...catalog[0],id:'bb9fec0a-d40f-4d8d-9435-036e41cf7194',name:'EXISTING CLAUDE',price:999,shareUrl:'https://courses.inexctraining.com/course-bb9fec0ad40f'},...catalog];
async function create(page,url){
 const dom=new JSDOM(await read(page),{url,runScripts:'outside-only'}),w=dom.window;
 if(w.document.readyState!=='complete')await new Promise(r=>w.addEventListener('load',r,{once:true}));
 const requests=[];w.INEXC_REGISTRATION_ENDPOINT='https://api.local.invalid/api';w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async(url,opt={})=>{requests.push({url,opt});assert.equal(opt.method||'GET','GET');assert.ok(url.endsWith('/courses'));return {ok:true,json:async()=>courses}};
 return {dom,w,requests};
}
test('every catalog card opens its own detail ID instead of a broken or unrelated share URL',async()=>{
 const {dom,w}=await create('index.html','https://local.invalid/');w.eval(await read('inexc-do-courses.js'));w.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 const links=[...w.document.querySelectorAll('.course-grid .course-link')];assert.equal(links.length,courses.length);
 for(const [i,link] of links.entries()){const url=new URL(link.href);assert.equal(url.pathname,'/course/');assert.equal(url.searchParams.get('id'),courses[i].id);assert.ok(link.closest('article').textContent.includes(courses[i].name))}dom.window.close();
});
test('each selected detail page displays that course and keeps its ID through both registration links and sharing',async()=>{
 for(const course of courses){
  const {dom,w}=await create('course/index.html','https://local.invalid/course/?id='+course.id);let shared;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async url=>{shared=url}}});
  w.eval(await read('inexc-course-page.js'));w.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
  assert.equal(w.document.querySelector('h1').textContent,course.name);
  const links=[...w.document.querySelectorAll('a[href^="/register/"]')];assert.equal(links.length,3);
  for(const link of links)assert.equal(new URL(link.href).searchParams.get('course_id'),course.id);
  w.document.querySelector('button.share-button').click();await tick();
  if(course.shareUrl.includes('/catalog-'))assert.equal(new URL(shared).searchParams.get('id'),course.id);else assert.equal(shared,course.shareUrl);
  dom.window.close();
 }
});
for(const page of ['register/index.html','register.html'])test(page+': explicit ID survives renamed titles; legacy names work and missing IDs never select another course',async()=>{
 const selected=catalog[6];
 for(const [query,expected] of [['course_id='+selected.id+'&course=OLD-NAME',selected.id],['course='+encodeURIComponent(selected.name),selected.id],['course_id=missing&course='+encodeURIComponent(courses[0].name),'']]){
  const {dom,w,requests}=await create(page,'https://local.invalid/'+page+'?'+query);
  w.eval([...w.document.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n')+'\n'+await read(page.startsWith('register/')?'register/inexc-do-registration.js':'inexc-do-registration.js'));
  w.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
  assert.equal(w.document.getElementById('course').value,expected);
  assert.equal(w.document.getElementById('summaryCourse').textContent,expected?selected.name:'—');
  assert.equal(requests.filter(r=>r.url.endsWith('/courses')).length,1);assert.equal(requests.filter(r=>r.url.endsWith('/payments/stripe/capabilities')).length,1);dom.window.close();
 }
});
