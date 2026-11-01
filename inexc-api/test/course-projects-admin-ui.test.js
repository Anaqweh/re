import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(r=>setImmediate(r));
test('upload library stays visible before selection and saving, enables after save, and clears on course change',async()=>{
const dom=new JSDOM('<section id="app"><main><div class="tabs"></div></main></section>',{url:'https://example.test/admin-portal.html',runScripts:'outside-only'}),w=dom.window;
await new Promise(r=>w.addEventListener('load',r,{once:true}));w.INEXCAdminSession={valid:()=>true};w.INEXC_REGISTRATION_ENDPOINT='/api';w.sessionStorage.setItem('inexc_do_admin','test');
w.fetch=async(url,opts)=>({ok:true,json:async()=>url==='/api/admin/courses'?[{id:'course1',name:'Course'}]:opts?.method==='PUT'?{portal:{url:'https://example.test/course-project.html?key=test',enabled:true}}:{portal:null,materials:[],submissions:[],hasMore:false}});
w.eval(await fs.readFile(new URL('../../admin-course-projects.js',import.meta.url),'utf8'));
w.document.querySelector('[data-view="course-projects"]').click();await tick();
const q=id=>w.document.getElementById('cp-'+id);assert.equal(q('material').closest('[hidden]'),null);assert.equal(q('material-file').matches(':disabled'),true);
q('course').value='course1';q('course').dispatchEvent(new w.Event('change'));await tick();assert.equal(q('material').closest('[hidden]'),null);assert.equal(q('material-file').matches(':disabled'),true);assert.match(q('upload-hint').textContent,/احفظ/);
q('settings').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(q('material-file').matches(':disabled'),false);assert.equal(q('saved').hidden,false);
q('course').value='';q('course').dispatchEvent(new w.Event('change'));await tick();assert.equal(q('material-file').matches(':disabled'),true);assert.equal(q('material').closest('[hidden]'),null);dom.window.close();
});
test('admin multiple file upload resumes after a failed item without repeating accepted files',async()=>{
const dom=new JSDOM('<section id="app"><main><div class="tabs"></div></main></section>',{url:'https://example.test/admin-portal.html',runScripts:'outside-only'}),w=dom.window;await new Promise(r=>w.addEventListener('load',r,{once:true}));w.INEXCAdminSession={valid:()=>true};w.INEXC_REGISTRATION_ENDPOINT='/api';w.sessionStorage.setItem('inexc_do_admin','test');w.INEXCProjectFiles={prepare:async files=>files};let sends=[];
w.fetch=async(url,opts)=>{if(url.endsWith('/materials')){sends.push({name:opts.body.get('file').name,id:opts.body.get('requestId')});return {ok:sends.length!==2,json:async()=>sends.length===2?{error:'try again'}:{ok:true}}}return {ok:true,json:async()=>url==='/api/admin/courses'?[{id:'course1',name:'Course'}]:{portal:{title:'Project',enabled:true,url:'https://example.test/project'},materials:[],submissions:[]}}};
w.eval(await fs.readFile(new URL('../../admin-course-projects.js',import.meta.url),'utf8'));const q=id=>w.document.getElementById('cp-'+id);w.document.querySelector('[data-view="course-projects"]').click();await tick();q('course').value='course1';q('course').dispatchEvent(new w.Event('change'));await tick();q('material-title').value='Instructions';Object.defineProperty(q('material-file'),'files',{value:[new w.File(['A'],'a.txt'),new w.File(['B'],'b.txt')]});const submit=async()=>{q('material').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick()};await submit();assert.deepEqual(sends.map(x=>x.name),['a.txt','b.txt']);await submit();assert.deepEqual(sends.map(x=>x.name),['a.txt','b.txt','b.txt']);assert.equal(sends[1].id,sends[2].id);dom.window.close();
});
