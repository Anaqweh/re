// Isolated fixtures and stubbed mail only; server startup/workers are never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {importCourseCatalog,validateCatalog} from '../import-course-catalog.js';
import {validateCoursePayment,validCoursePaymentLink} from '../course-payment.js';

const catalog=JSON.parse(await fs.readFile(new URL('../course-catalog-20261016.json',import.meta.url),'utf8'));
const serverSource=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
async function database(){
 const db=new PGlite(),queries=[];
 for(const name of ['courses','registrations']){const start=serverSource.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');await db.exec(serverSource.slice(start,serverSource.indexOf('`);',start)))}
 await db.exec("ALTER TABLE courses ADD COLUMN share_slug TEXT NOT NULL DEFAULT '',ADD COLUMN membership_enabled BOOLEAN NOT NULL DEFAULT true,ADD COLUMN membership_kind TEXT NOT NULL DEFAULT 'course',ADD COLUMN public_booking_opens_at TIMESTAMPTZ; CREATE UNIQUE INDEX courses_slug_test ON courses(share_slug); ALTER TABLE registrations ADD COLUMN membership_card_id UUID,ADD COLUMN membership_redemption_id UUID;");
 const query=async(sql,args)=>{queries.push(sql);const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 const pool={query,connect:async()=>({query,release(){}})};
 return {db,queries,query,pool,close:()=>db.close()};
}
test('catalog adds five courses and five diplomas, preserves existing content and later edits/deletions, and never queues mail',async t=>{
 const h=await database();t.after(()=>h.close());validateCatalog(catalog);
 const existing=(await h.query("INSERT INTO courses(name,price,bank_name,bank_account,bank_iban,payment_methods,share_slug) VALUES('EXISTING CLAUDE',999,'EXISTING RECEIVER','LOCAL ACCOUNT','LOCAL IBAN',ARRAY['bank'],'existing-claude') RETURNING *")).rows[0];
 const result=await importCourseCatalog(h.pool,catalog);assert.equal(result.created,10);assert.equal(result.active,10);assert.equal(result.paymentLinksNeeded,10);
 const rows=(await h.query('SELECT * FROM courses WHERE id<>$1',[existing.id])).rows;
 assert.equal(rows.filter(r=>r.membership_kind==='course').length,5);assert.equal(rows.filter(r=>r.membership_kind==='diploma').length,5);
 for(const row of rows){assert.deepEqual(row.payment_methods,['link','bank']);assert.equal(row.bank_iban,'LOCAL IBAN');assert.equal(row.payment_link,'');assert.equal(row.certificate_name,'شهادة إتمام من INEXC Training');assert.equal(row.course_date,'يُعلن الموعد قريبًا')}
 assert.deepEqual((await h.query('SELECT * FROM courses WHERE id=$1',[existing.id])).rows[0],existing);
 await h.query("UPDATE courses SET price=123,name='ADMIN EDIT',payment_link='https://payments.example.invalid/edited',active=false WHERE id=$1",[rows[0].id]);await h.query('DELETE FROM courses WHERE id=$1',[rows[1].id]);
 const repeat=await importCourseCatalog(h.pool,catalog);assert.equal(repeat.created,0);assert.equal(repeat.alreadyImported,true);assert.equal((await h.query('SELECT count(*)::int AS n FROM courses')).rows[0].n,10);assert.equal((await h.query('SELECT name FROM courses WHERE id=$1',[rows[0].id])).rows[0].name,'ADMIN EDIT');
 assert.ok(h.queries.every(sql=>!/(email_|course_alert|INSERT INTO registrations)/i.test(sql)));
});
test('catalog rollback leaves existing courses intact when one insert fails',async t=>{
 const h=await database();t.after(()=>h.close());await h.query("INSERT INTO courses(name,share_slug) VALUES('EXISTING','existing')");let added=0;
 const pool={connect:async()=>({query:(sql,args)=>{if(sql.startsWith('INSERT INTO courses')&&++added===4)throw Error('SIMULATED INSERT FAILURE');return h.query(sql,args)},release(){}})};
 await assert.rejects(importCourseCatalog(pool,catalog),/SIMULATED/);assert.deepEqual((await h.query('SELECT name FROM courses')).rows,[{name:'EXISTING'}]);
 const result=await importCourseCatalog(h.pool,catalog);assert.equal(result.created,10);assert.equal(result.active,0);assert.equal(result.paymentLinksNeeded,10);
});
test('only a configured HTTPS link enables link payment; bank receipts remain mandatory',()=>{
 for(const value of ['',null,'#','javascript:alert(1)','http://payments.example.invalid','https://user:pass@payments.example.invalid'])assert.equal(validCoursePaymentLink(value),'');
 const course={payment_methods:['link','bank'],payment_link:'https://payments.example.invalid/pay?amount=249'};
 assert.deepEqual(validateCoursePayment(course,{method:'link',total:249,hasReceipt:false}),{method:'link',status:'بانتظار الدفع',paymentLink:course.payment_link});
 assert.throws(()=>validateCoursePayment({...course,payment_methods:['bank']},{method:'link',total:249}),/وسيلة/);
 assert.throws(()=>validateCoursePayment({...course,payment_link:'#'},{method:'link',total:249}),/غير جاهز/);
 assert.throws(()=>validateCoursePayment(course,{method:'bank',total:249,hasReceipt:false}),/وصل/);
 assert.equal(validateCoursePayment(course,{method:'bank',total:249,hasReceipt:true}).status,'بانتظار مراجعة الوصل');
 assert.equal(validateCoursePayment(course,{method:'link',total:0}).method,'free');
});
test('real registration handler accepts link payment without a receipt and never treats it as paid',async t=>{
 const h=await database();t.after(()=>h.close());const course=(await h.query("INSERT INTO courses(name,price,certificate_mode,certificate_name,certificate_price,payment_methods,payment_link,share_slug) VALUES('LOCAL COURSE',249,'optional','LOCAL CERT',50,ARRAY['link','bank'],'https://payments.example.invalid/course','local') RETURNING id")).rows[0].id;
 const app=express();app.use(express.json());const emails=[];
 const start=serverSource.indexOf("app.post('/api/registrations',"),end=serverSource.indexOf("app.post('/api/institution-requests',",start);
 assert.ok(start>0&&end>start);
 new Function('app','upload','pool','clean','reference','validateCoursePayment','sendRegistrationEmails',serverSource.slice(start,end))(app,{single:()=>((_req,_res,next)=>next())},h.pool,(v,max=400)=>String(v??'').trim().slice(0,max),()=>crypto.randomUUID(),validateCoursePayment,r=>emails.push(r));
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=async(body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/registrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({course_id:course,name:'LOCAL',email:'local@example.invalid',phone:'000000',...body})});return {status:r.status,data:await r.json()}};
 const linked=await request({payment_method:'link',certificate:'yes',total:1});assert.equal(linked.status,201);assert.equal(linked.data.paymentLink,'https://payments.example.invalid/course');assert.equal(emails.length,1);
 const row=(await h.query('SELECT total,status,receipt_path,payment_method FROM registrations')).rows[0];assert.equal(Number(row.total),299);assert.equal(row.status,'بانتظار الدفع');assert.equal(row.payment_method,'link');assert.equal(row.receipt_path,'');
 assert.equal((await request({payment_method:'bank'})).status,400);
 await h.query("UPDATE courses SET payment_link=''");assert.equal((await request({payment_method:'link'})).status,400);assert.equal(emails.length,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,1);
});
