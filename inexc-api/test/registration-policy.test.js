// Only disposable local data and intercepted messages; no production requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {allowsRepeatRegistration} from '../registration-policy.js';
import {validateCoursePayment} from '../course-payment.js';

test('repeat registration exception matches only the normalized approved address',()=>{
 for(const value of ['ahmadanakwa@gmail.com',' AHMADANAKWA@GMAIL.COM '])assert.equal(allowsRepeatRegistration(value),true);
 for(const value of ['other@gmail.com','ahmadanakwa+test@gmail.com','ahmadanakwa@gmail.com.evil','ahmad.anakwa@gmail.com','prefix-ahmadanakwa@gmail.com',null,undefined,['ahmadanakwa@gmail.com'],{}])assert.equal(allowsRepeatRegistration(value),false);
});

test('actual free registration route permits owner repeats, blocks other repeats, and preserves consent and suppression',async t=>{
 const db=new PGlite(),source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 t.after(()=>db.close());
 for(const name of ['courses','registrations']){
  const start=source.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');await db.exec(source.slice(start,source.indexOf('`);',start)));
 }
 await db.exec('ALTER TABLE registrations ADD COLUMN membership_card_id UUID, ADD COLUMN membership_redemption_id UUID');
 // Requests in this test are sequential; the advisory lock remains exercised on production PostgreSQL.
 const query=async(sql,args)=>{
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:0};
  const result=await db.query(sql,args);return {...result,rowCount:result.rows.length||result.affectedRows||0};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const course=(await query("INSERT INTO courses(name,price,certificate_mode) VALUES('LOCAL FREE COURSE',0,'none') RETURNING id")).rows[0].id;
 const app=express();app.use(express.json());const emails=[];let suppressed=false;
 const rejectSuppressedCourse=(_req,res,next)=>suppressed?res.status(403).json({error:'LOCAL SUPPRESSION'}):next();
 const start=source.indexOf("app.post('/api/registrations',"),end=source.indexOf("app.post('/api/institution-requests',",start);
 assert.ok(start>0&&end>start);
 new Function('app','upload','rejectSuppressedCourse','pool','clean','reference','validateCoursePayment','sendRegistrationEmails','allowsRepeatRegistration',source.slice(start,end))(
  app,{single:()=>((_req,_res,next)=>next())},rejectSuppressedCourse,pool,(v,max=400)=>String(v??'').trim().slice(0,max),()=>crypto.randomUUID(),validateCoursePayment,message=>emails.push(message),allowsRepeatRegistration);
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const request=async(email,extra={})=>{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/registrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({course_id:course,name:'LOCAL TEST',email,phone:'000000',free_share_consent:'yes',...extra})});
  return {status:r.status,data:await r.json()};
 };
 const first=await request('ahmadanakwa@gmail.com'),second=await request(' AHMADANAKWA@gmail.com ');
 assert.equal(first.status,201);assert.equal(second.status,201);assert.notEqual(first.data.reference,second.data.reference);
 assert.equal((await request('other@example.invalid')).status,201);
 const duplicate=await request('OTHER@example.invalid');assert.equal(duplicate.status,409);assert.equal(duplicate.data.alreadyRegistered,true);
 assert.equal((await request('ahmadanakwa@gmail.com',{free_share_consent:'no'})).status,400);
 suppressed=true;assert.equal((await request('ahmadanakwa@gmail.com')).status,403);
 assert.equal(emails.length,3);assert.equal((await query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,3);
});
