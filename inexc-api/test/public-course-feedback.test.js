import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import crypto from 'node:crypto';import {PGlite} from '@electric-sql/pglite';import {JSDOM} from 'jsdom';
const id='11111111-1111-4111-8111-111111111111',requestKey='22222222-2222-4222-8222-222222222222';
test('visitor submissions stay unverified drafts, retries do not duplicate, invalid requests do not write',async()=>{
 const db=new PGlite();try{
 await db.exec("CREATE TABLE courses(id uuid primary key,name text,active boolean);CREATE TABLE testimonials(name text,content text,rating int,status text,verified boolean,source_course_id uuid,course_ids uuid[],submission_key uuid unique,submitted_ip_hash text,created_at timestamptz default now())");await db.query('INSERT INTO courses VALUES($1,$2,true)',[id,'Test']);
 const query=async(sql,args)=>{if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};const r=await db.query(sql,args);return {...r,rowCount:r.rows.length}};
 const routes={},pool={query,connect:async()=>({query,release(){}})},app={get:(url,fn)=>routes['GET '+url]=fn,post:(url,fn)=>routes['POST '+url]=fn};
 const code=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');vm.runInNewContext(code.slice(code.indexOf("app.get('/api/course-feedback/:id'"),code.indexOf("app.get('/api/courses/:id/testimonials'")),{app,pool,crypto});
 const body={name:'Visitor',content:'A thoughtful course review',rating:4,consent:true,requestKey,status:'visible',verified:true,courseIds:[]};
 const run=async(b,method='POST')=>{const result={code:200};const res={status(n){result.code=n;return this},set(){return this},json(data){result.data=data;return this}};await routes[method+' /api/course-feedback/:id']({body:b,params:{id},ip:'127.0.0.1'},res,e=>{throw e});return result};
 assert.equal((await run(body,'GET')).data.name,'Test');assert.equal((await run(body)).code,201);assert.equal((await run(body)).code,200);
 const rows=(await db.query('SELECT * FROM testimonials')).rows;assert.equal(rows.length,1);assert.equal(rows[0].status,'draft');assert.equal(rows[0].verified,false);assert.deepEqual(rows[0].course_ids,[id]);
 assert.equal((await run({...body,content:'A different course review'})).code,409);assert.equal((await run({...body,consent:false})).code,400);assert.equal((await run({...body,rating:6})).code,400);
 await db.query('UPDATE courses SET active=false');assert.equal((await run({...body,requestKey:crypto.randomUUID()})).code,404);
 }finally{await db.close()}
});
test('public form preserves the retry key after a failed response and shows moderation success',async()=>{
 const html=await fs.readFile(new URL('../../course-feedback.html',import.meta.url),'utf8'),code=await fs.readFile(new URL('../../course-feedback.js',import.meta.url),'utf8');const dom=new JSDOM(html,{url:'https://test.invalid/course-feedback.html?course_id='+id,runScripts:'outside-only'}),w=dom.window;await new Promise(r=>w.addEventListener('load',r,{once:true}));w.INEXC_REGISTRATION_ENDPOINT='/api';const bodies=[];
 w.fetch=async(url,opts)=>{if(!opts?.method)return {ok:true,json:async()=>({id,name:'Test course'})};bodies.push(JSON.parse(opts.body));if(bodies.length===1)throw Error('Network error');return {ok:true,json:async()=>({ok:true,status:'pending'})}};
 w.eval(code);w.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setImmediate(r));const el=id=>w.document.getElementById(id);assert.equal(el('feedbackForm').hidden,false);el('reviewName').value='Visitor';el('reviewContent').value='A helpful training course';el('reviewRating').value='4';el('reviewConsent').checked=true;
 const submit=async()=>{el('feedbackForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r))};await submit();assert.equal(el('feedbackForm').hidden,false);await submit();assert.equal(bodies[0].requestKey,bodies[1].requestKey);assert.equal(el('feedbackSuccess').hidden,false);dom.window.close();
});
