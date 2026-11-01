import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const server=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
test('course review query excludes drafts, hidden, unrelated and inactive course placements',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE TABLE courses(id uuid primary key,name text,active boolean); CREATE TABLE testimonials(id uuid,name text,content text,source_course_id uuid,course_ids uuid[],status text,created_at timestamptz default now());`);
 await db.query('INSERT INTO courses VALUES ($1,$2,true),($3,$4,true)',[a,'Original',b,'Next']);
 for(const status of ['draft','hidden','visible','featured']) await db.query('INSERT INTO testimonials(id,name,content,source_course_id,course_ids,status) VALUES($1,$2,$3,$4,$5,$6)',[a,'Name',status,a,[a,b],status]);
 await db.query("INSERT INTO testimonials(id,name,content,course_ids,status) VALUES($1,'Other','Other',$2,'visible')",[a,[a]]);
 const sql=server.match(/SELECT t.id,t.name,t.content,t.source_course_id,c.name AS source_course_name[\s\S]*?t.created_at DESC/)[0];
 assert.deepEqual((await db.query(sql,[b])).rows.map(r=>r.content),['featured','visible']);
 await db.query('UPDATE courses SET active=false WHERE id=$1',[b]); assert.equal((await db.query(sql,[b])).rows.length,0);
 }finally{await db.close()}
});
test('review content is rendered as text and free CTA remains tied to the current course',async()=>{
 const html=await fs.readFile(new URL('../../course/index.html',import.meta.url),'utf8');
 const code=await fs.readFile(new URL('../../inexc-course-page.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://example.test/course/?id='+b,runScripts:'outside-only'});const w=dom.window;
 await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.INEXC_REGISTRATION_ENDPOINT='/api';
 w.fetch=async url=>({ok:true,json:async()=>url.endsWith('/testimonials')?[{name:'<img src=x>',content:'<script>bad()</script>',sourceCourseName:'Original'}]:[{id:b,name:'Free course',price:0,axes:[],outcomes:[]}]});
 w.eval(code);w.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,20));
 assert.equal(w.document.querySelector('.course-review blockquote').textContent,'<script>bad()</script>');assert.equal(w.document.querySelector('.course-review img'),null);
 assert.match(w.document.querySelector('.intro a').textContent,/سجّل مجانًا/);assert.equal(new URL(w.document.querySelector('.intro a').href).searchParams.get('course_id'),b);dom.window.close();
});
test('admin scripts parse after adding reusable course placements',async()=>{
 const html=await fs.readFile(new URL('../../admin-portal.html',import.meta.url),'utf8');
 const dom=new JSDOM(html);for(const s of dom.window.document.querySelectorAll('script:not([src])'))new vm.Script(s.textContent);dom.window.close();
});
