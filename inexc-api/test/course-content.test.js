import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {updateCourseContent,validateCourseContent} from '../update-course-content.js';
const read=name=>fs.readFile(new URL('../../'+name,import.meta.url),'utf8');
const data=JSON.parse(await read('inexc-api/course-content-20261016.json'));

async function setup(){
 const db=new PGlite(),queries=[];
 await db.exec(`CREATE TABLE courses(id UUID PRIMARY KEY,name TEXT,description TEXT,axes TEXT,outcomes TEXT,trainer TEXT,course_date TEXT,location TEXT,image_path TEXT,training_hours NUMERIC,price NUMERIC DEFAULT 777,payment_link TEXT DEFAULT 'https://example.invalid/pay',certificate_name TEXT DEFAULT 'ORIGINAL CERTIFICATE',active BOOLEAN DEFAULT true,updated_at TIMESTAMPTZ DEFAULT now());`);
 for(const c of data.courses){const e=c.expected;await db.query('INSERT INTO courses(id,name,description,axes,outcomes,trainer,course_date,location,image_path,training_hours) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[c.id,c.name,e.description,e.axes.join('\n'),e.outcomes.join('\n'),e.trainer,e.date,e.location,e.imageUrl,c.hours])}
 const query=async(sql,args)=>{queries.push(sql);const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 return {db,queries,query,pool:{connect:async()=>({query,release(){}})}};
}
test('eleven complete curricula have distinct verified artwork, requested start dates, correct hours and no trainer conflicts',async()=>{
 validateCourseContent(data);
 const hashes=new Set();
 for(const c of data.courses){
  const bytes=await fs.readFile(new URL('../../'+c.imageFile,import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),c.imageSha256);hashes.add(c.imageSha256);
  for(const section of ['لمن هذا البرنامج؟','قبل الحضور','التطبيق العملي','اللقاءات'])assert.ok(c.description.includes('## '+section));
 }
 assert.equal(hashes.size,11);
 const invalid=structuredClone(data);invalid.courses[0].schedule[0].end='18:00';assert.throws(()=>validateCourseContent(invalid),/hours/);
});
test('atomic one-time update backs up previous content, retains business fields and preserves later admin edits',async t=>{
 const h=await setup();t.after(()=>h.db.close());let copied=0;
 const result=await updateCourseContent(h.pool,data,{prepareImage:async()=>{copied++}});
 assert.equal(result.updated,11);assert.equal(copied,11);
 const rows=(await h.query('SELECT * FROM courses')).rows;
 for(const row of rows){const c=data.courses.find(x=>x.id===row.id);assert.equal(row.description,c.description);assert.equal(row.image_path,c.imagePath);assert.equal(row.course_date,c.date);assert.equal(Number(row.price),777);assert.equal(row.payment_link,'https://example.invalid/pay');assert.equal(row.certificate_name,'ORIGINAL CERTIFICATE');assert.equal(row.active,true)}
 const backup=(await h.query('SELECT before_content FROM course_content_updates')).rows[0].before_content;assert.equal(backup.length,11);assert.equal(backup.find(x=>x.id===data.courses[0].id).course_date,data.courses[0].expected.date);
 await h.query("UPDATE courses SET description='ADMIN EDIT' WHERE id=$1",[data.courses[0].id]);
 assert.equal((await updateCourseContent(h.pool,data)).alreadyApplied,true);assert.equal((await h.query('SELECT description FROM courses WHERE id=$1',[data.courses[0].id])).rows[0].description,'ADMIN EDIT');
 assert.ok(h.queries.every(sql=>!/(registrations|email_|course_alert|message_campaign)/i.test(sql)));
});
test('concurrent content changes or artwork failures leave all course rows unchanged',async t=>{
 const h=await setup();t.after(()=>h.db.close());
 await h.query("UPDATE courses SET trainer='CHANGED' WHERE id=$1",[data.courses[0].id]);
 await assert.rejects(updateCourseContent(h.pool,data),/changed since/);
 assert.equal((await h.query('SELECT course_date FROM courses WHERE id=$1',[data.courses[1].id])).rows[0].course_date,data.courses[1].expected.date);
 await h.query('UPDATE courses SET trainer=$1 WHERE id=$2',[data.courses[0].expected.trainer,data.courses[0].id]);
 await assert.rejects(updateCourseContent(h.pool,data,{prepareImage:async()=>{throw Error('MISSING ARTWORK')}}),/MISSING ARTWORK/);
 assert.equal((await h.query('SELECT description FROM courses WHERE id=$1',[data.courses[0].id])).rows[0].description,data.courses[0].expected.description);
 assert.equal((await updateCourseContent(h.pool,data)).updated,11);
});
test('course cards show only the overview and main axes; details show all authored information and the trainer',async()=>{
 const courses=data.courses.map(c=>({...c,imageUrl:c.imagePath,price:199,category:'دورة تدريبية',certificate:{mode:'included',name:'شهادة إتمام'}}));
 const dom=new JSDOM(await read('index.html'),{url:'https://local.invalid/',runScripts:'outside-only'}),w=dom.window;
 if(w.document.readyState!=='complete')await new Promise(r=>w.addEventListener('load',r,{once:true}));
 w.INEXC_REGISTRATION_ENDPOINT='https://api.local.invalid/api';w.fetch=async()=>({ok:true,json:async()=>courses});
 w.eval(await read('inexc-do-courses.js'));w.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,0));
 assert.equal(w.document.querySelectorAll('.course').length,11);
 for(const [i,card] of [...w.document.querySelectorAll('.course')].entries()){assert.equal(card.querySelector('p').textContent,courses[i].description.split('\n')[0]);assert.equal(card.querySelectorAll('.course-axes li').length,3);assert.ok(!card.querySelector('img').src.includes('logo'))}w.close();
 for(const course of courses){
  const page=new JSDOM(await read('course/index.html'),{url:'https://local.invalid/course/?id='+course.id,runScripts:'outside-only'}),v=page.window;
  if(v.document.readyState!=='complete')await new Promise(r=>v.addEventListener('load',r,{once:true}));
  v.INEXC_REGISTRATION_ENDPOINT='https://api.local.invalid/api';v.fetch=async()=>({ok:true,json:async()=>courses});v.HTMLElement.prototype.scrollIntoView=function(){};
  v.eval(await read('inexc-course-page.js'));v.dispatchEvent(new v.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,0));
  assert.equal(v.document.querySelector('h1').textContent,course.name);assert.equal(v.document.querySelectorAll('.axis-group').length,course.axes.filter(x=>x.startsWith('المحور ')).length);assert.equal(v.document.querySelectorAll('.rich-heading').length,4);assert.ok(v.document.querySelector('.meta').textContent.includes(course.trainer));assert.ok(v.document.querySelector('.rich').textContent.includes('بتوقيت الإمارات'));v.close();
 }
});
