// Isolated PostgreSQL-compatible integration tests. Never imports server.js or sends mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {setupLearnerService,installLearnerService,createCardRegistration,cardQuote} from '../learner-service.js';
const address='learner@example.invalid';
async function harness(options={}){
 const db=new PGlite(),source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 for(const name of ['courses','registrations','membership_plans','membership_orders','membership_cards','membership_redemptions']){const start=source.indexOf('CREATE TABLE IF NOT EXISTS '+name+' (');const end=source.indexOf('`);',start);await db.exec(source.slice(start,end))}
 await db.exec("ALTER TABLE registrations ADD COLUMN membership_card_id UUID,ADD COLUMN membership_redemption_id UUID,ADD COLUMN request_kind TEXT DEFAULT 'individual'; ALTER TABLE courses ADD COLUMN membership_enabled BOOLEAN DEFAULT TRUE,ADD COLUMN membership_kind TEXT DEFAULT 'course',ADD COLUMN member_booking_opens_at TIMESTAMPTZ;");
 let injectFailure=false;const query=async(sql,args)=>{if(injectFailure&&sql.startsWith('UPDATE membership_cards SET units_remaining')){injectFailure=false;throw Error('SIMULATED_WRITE_FAILURE')}const r=await db.query(sql,args);return{...r,rowCount:r.rows.length||r.affectedRows||0}};
 // PGlite has one connection; serialize transaction clients, as row locks do on PostgreSQL.
 let tail=Promise.resolve();const pool={query,connect:async()=>{let release;const previous=tail;tail=new Promise(r=>release=r);await previous;return{query,release}}};
 await setupLearnerService(pool);await setupLearnerService(pool);
 const plan=(await query("INSERT INTO membership_plans(slug,name,price_usd,max_cards,valid_months,booking_units,course_unit_cost,diploma_unit_cost,certificate_discount) VALUES('local','LOCAL TEST',10,100,12,8,2,3,10) RETURNING id")).rows[0].id;
 const card=(await query("INSERT INTO membership_cards(card_number,access_token,plan_id,holder_name,holder_email,holder_phone,units_total,units_remaining,expires_at) VALUES('INX-LOCAL-CARD',$1,$2,'LOCAL TEST',$3,'000000',8,8,now()+interval '1 year') RETURNING id",['a'.repeat(48),plan,address])).rows[0].id;
 const courses=[];for(let i=0;i<4;i++)courses.push((await query("INSERT INTO courses(name,training_hours,certificate_mode,certificate_price) VALUES($1,6,'optional',100) RETURNING id",['LOCAL COURSE '+i])).rows[0].id);
 const input={name:'LOCAL TEST',email:address,phone:'000000',code:'INX-LOCAL-CARD',courseId:courses[0],certificateRequested:false};
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inexc-learner-test-'));const app=express();app.use(express.json());app.use('/uploads',express.static(dir,{dotfiles:'deny',index:false}));
 const emails=[],mailErrors=[];
 installLearnerService({app,pool,sendEmail:async message=>{emails.push(message);if(options.sendEmail)await options.sendEmail(message)},emailShell:({content})=>'<html dir="rtl">'+content+'</html>',mailEnabled:options.mailEnabled??true,logger:{error:(...args)=>mailErrors.push(args)},auth:(req,res,next)=>req.headers.authorization==='Bearer LOCAL-ADMIN'?next():res.status(401).end(),uploadDir:dir});app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 async function request(route,{method='GET',body,token}={}){const r=await fetch(origin+route,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}return{status:r.status,data,headers:r.headers}}
 return {pool,query,plan,card,courses,input,request,dir,emails,mailErrors,failNextDebit(){injectFailure=true},async close(){await new Promise(r=>server.close(r));await db.close();await fs.rm(dir,{recursive:true,force:true})}};
}
test('card booking is atomic, concurrent retries debit once, and concurrent bookings cannot overspend',async t=>{const h=await harness();t.after(()=>h.close());
 assert.notEqual(h.card,h.plan);
 const attempts=await Promise.all([createCardRegistration(h.pool,h.input),createCardRegistration(h.pool,h.input)]);
 assert.equal(attempts.filter(r=>r.alreadyRegistered).length,1);assert.equal(attempts[0].reference,attempts[1].reference);assert.equal(attempts[0].remaining,6);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,1);
 assert.equal((await h.query('SELECT card_id FROM membership_redemptions')).rows[0].card_id,h.card);
 h.failNextDebit();await assert.rejects(createCardRegistration(h.pool,{...h.input,courseId:h.courses[1]}),/SIMULATED/);
 assert.equal((await h.query('SELECT units_remaining FROM membership_cards WHERE id=$1',[h.card])).rows[0].units_remaining,6);
 assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,1);assert.equal((await h.query('SELECT count(*)::int AS n FROM membership_redemptions')).rows[0].n,1);
 await h.query('UPDATE membership_cards SET units_remaining=2 WHERE id=$1',[h.card]);
 const results=await Promise.allSettled([createCardRegistration(h.pool,{...h.input,courseId:h.courses[1]}),createCardRegistration(h.pool,{...h.input,courseId:h.courses[2]})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.query('SELECT units_remaining FROM membership_cards WHERE id=$1',[h.card])).rows[0].units_remaining,0);
 const replay=await createCardRegistration(h.pool,h.input);assert.equal(replay.alreadyRegistered,true);assert.equal(replay.remaining,0);
});
test('eligibility and certificate fees preserve balance on rejection',async t=>{const h=await harness();t.after(()=>h.close());
 await assert.rejects(createCardRegistration(h.pool,{...h.input,email:'other@example.invalid'}),/غير صحيح/);
 await assert.rejects(createCardRegistration(h.pool,{...h.input,certificateRequested:true}),/وصل/);
 await assert.rejects(createCardRegistration(h.pool,{...h.input,expectedUnits:1,expectedCertificateFee:0}),e=>e.status===409);
 await assert.rejects(createCardRegistration(h.pool,{...h.input,certificateRequested:true,expectedUnits:2,expectedCertificateFee:80,receiptPath:'/uploads/local-test.pdf'}),e=>e.status===409);
 await h.query("UPDATE membership_cards SET status='suspended'");await assert.rejects(createCardRegistration(h.pool,h.input),/غير فعّالة/);await h.query("UPDATE membership_cards SET status='active',expires_at=now()-interval '1 day'");await assert.rejects(createCardRegistration(h.pool,h.input),/انتهت/);await h.query("UPDATE membership_cards SET expires_at=now()+interval '1 year'");
 await h.query("UPDATE courses SET member_booking_opens_at=now()+interval '1 day' WHERE id=$1",[h.courses[0]]);await assert.rejects(createCardRegistration(h.pool,h.input),/لم يبدأ/);await h.query('UPDATE courses SET member_booking_opens_at=NULL,membership_enabled=false WHERE id=$1',[h.courses[0]]);await assert.rejects(createCardRegistration(h.pool,h.input),/غير متاحة/);await h.query('UPDATE courses SET membership_enabled=true WHERE id=$1',[h.courses[0]]);
 await h.query("UPDATE courses SET payment_methods=ARRAY['stripe'] WHERE id=$1",[h.courses[0]]);await assert.rejects(createCardRegistration(h.pool,{...h.input,certificateRequested:true,receiptPath:'/uploads/local-test.pdf'}),/غير مفعّل/);assert.equal((await h.query('SELECT units_remaining FROM membership_cards WHERE id=$1',[h.card])).rows[0].units_remaining,8);await h.query("UPDATE courses SET payment_methods=ARRAY['bank'] WHERE id=$1",[h.courses[0]]);
 const booked=await createCardRegistration(h.pool,{...h.input,certificateRequested:true,receiptPath:'/uploads/local-test.pdf'});assert.equal(booked.certificateFee,90);assert.equal(booked.remaining,6);
 const r=(await h.query('SELECT total,certificate_fee_status,receipt_path FROM registrations WHERE id=$1',[booked.registrationId])).rows[0];assert.equal(Number(r.total),90);assert.equal(r.certificate_fee_status,'pending');assert.equal(r.receipt_path,'/uploads/local-test.pdf');
 const card={status:'active',expires_at:'2099-01-01',units_remaining:4,course_unit_cost:2,diploma_unit_cost:3,certificate_discount:10};assert.equal(cardQuote(card,{active:true,membership_enabled:true,membership_kind:'diploma'}).remainingAfter,1);
});
test('private dashboard, authenticated PDFs, admin progress, access keys and session expiry',async t=>{const h=await harness();t.after(()=>h.close());const book=await createCardRegistration(h.pool,h.input);
 assert.equal((await h.request('/api/learner/dashboard')).status,401);assert.equal((await h.request('/api/admin/learner-records/'+book.registrationId)).status,401);
 assert.equal((await h.request('/api/learner/session',{method:'POST',body:{email:'other@example.invalid',code:h.input.code}})).status,401);
 const login=await h.request('/api/learner/session',{method:'POST',body:{email:address.toUpperCase(),code:h.input.code}});assert.equal(login.status,200);const token=login.data.token;assert.equal(token.length,64);
 assert.notEqual((await h.query('SELECT token_hash FROM learner_sessions')).rows[0].token_hash,token);
 const dashboard=(await h.request('/api/learner/dashboard',{token})).data;assert.deepEqual(dashboard.stats,{registered:1,completed:0,attendedHours:0,scheduledHours:6,certificates:0});assert.equal(dashboard.history.length,1);assert.equal(dashboard.cards[0].unitsRemaining,6);
 const adminRoute='/api/admin/learner-records/'+book.registrationId;
 assert.equal((await h.request(adminRoute,{method:'PUT',token:'LOCAL-ADMIN',body:{state:'completed',progress:12,hours:6}})).status,200);
 const body=new FormData();body.append('title','LOCAL CERT');body.append('number','LOCAL-CERT-001');body.append('issuedOn','2026-10-16');body.append('file',new Blob(['%PDF-1.4\n% local test only\n%%EOF'],{type:'application/pdf'}),'local.pdf');
 const uploaded=await h.request(adminRoute+'/certificates',{method:'POST',body,token:'LOCAL-ADMIN'});assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
 const certificate='/api/learner/certificates/'+uploaded.data.id+'/download';assert.equal((await h.request(certificate)).status,401);const download=await h.request(certificate,{token});assert.equal(download.status,200);assert.match(download.data,/^%PDF-/);assert.equal(download.headers.get('cache-control'),'no-store');
 const filename=(await h.query('SELECT filename FROM learner_certificates')).rows[0].filename;assert.ok([403,404].includes((await h.request('/uploads/.trainee-private/'+filename)).status));assert.notEqual((await h.request('/uploads/%2etrainee-private/'+filename)).status,200);
 const foreign=crypto.randomBytes(32).toString('hex');await h.query("INSERT INTO learner_sessions(token_hash,email,expires_at) VALUES($1,'stranger@example.invalid',now()+interval '1 hour')",[crypto.createHash('sha256').update(foreign).digest('hex')]);assert.equal((await h.request(certificate,{token:foreign})).status,404);assert.equal((await h.request('/api/learner/dashboard',{token:foreign})).data.courses.length,0);
 const refreshed=(await h.request('/api/learner/dashboard',{token})).data;assert.equal(refreshed.stats.completed,1);assert.equal(refreshed.stats.attendedHours,6);assert.equal(refreshed.stats.certificates,1);assert.equal(refreshed.courses[0].progress_percent,100);
 const access=await h.request(adminRoute+'/access',{method:'POST',token:'LOCAL-ADMIN'});assert.equal(access.status,200);assert.equal((await h.request('/api/learner/session',{method:'POST',body:{email:address,code:access.data.code}})).status,200);
 assert.equal((await h.request('/api/learner/session',{method:'POST',body:{cardToken:'a'.repeat(48)}})).status,200);
 assert.equal((await h.request('/api/learner/session',{method:'DELETE',token})).status,200);assert.equal((await h.request('/api/learner/dashboard',{token})).status,401);
 await h.query("UPDATE learner_sessions SET expires_at=now()-interval '1 minute'");assert.equal((await h.request('/api/learner/dashboard',{token:foreign})).status,401);
});

const recoveryRoute='/api/learner/card-recovery';
const keyHash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10))}assert.ok(check(),'Expected asynchronous recovery operation to finish')}
test('card recovery responds privately and sends all owned card numbers only to the registered email',async t=>{
 let release;const transport=new Promise(resolve=>release=resolve),h=await harness({sendEmail:()=>transport});t.after(()=>{release();return h.close()});
 await h.query("UPDATE membership_cards SET holder_name='<script>not html</script>',holder_email=upper(holder_email)");
 await h.query("INSERT INTO membership_cards(card_number,access_token,plan_id,holder_name,holder_email,holder_phone,units_total,units_remaining,expires_at,status) VALUES('INX-SECOND-CARD',$1,$2,'LOCAL TEST',$3,'000000',8,0,now()-interval '1 day','expired')",['b'.repeat(48),h.plan,address]);
 await h.query("INSERT INTO membership_cards(card_number,access_token,plan_id,holder_name,holder_email,holder_phone,units_total,units_remaining,expires_at) VALUES('INX-OTHER-CARD',$1,$2,'OTHER','other@example.invalid','000000',8,8,now()+interval '1 day')",['c'.repeat(48),h.plan]);
 await h.query("UPDATE membership_plans SET name='<img src=x onerror=alert(1)>'");
 const before=(await h.query('SELECT * FROM membership_cards ORDER BY card_number')).rows;
 const known=await h.request(recoveryRoute,{method:'POST',body:{email:'  '+address.toUpperCase()+'  ',to:'other@example.invalid'}});
 assert.equal(known.status,202);assert.equal(known.headers.get('cache-control'),'no-store');
 await until(()=>h.emails.length===1); // HTTP already returned while the mail transport is still pending.
 const message=h.emails[0];assert.equal(message.to,address);assert.match(message.html,/INX-LOCAL-CARD/);assert.match(message.html,/INX-SECOND-CARD/);assert.ok(!message.html.includes('INX-OTHER-CARD'));assert.ok(!message.html.includes('<script>'));assert.match(message.html,/&lt;img/);assert.ok(!message.html.includes('<img src=x'));assert.ok(!message.html.includes('a'.repeat(48)));assert.match(message.text,/account.html/);assert.equal(message.marketing,false);assert.match(message.idempotencyKey,/^learner-card-recovery\//);
 const unknown=await h.request(recoveryRoute,{method:'POST',body:{email:'unknown@example.invalid'}});assert.equal(unknown.status,known.status);assert.deepEqual(unknown.data,known.data);assert.ok(!JSON.stringify(known.data).includes('INX-LOCAL-CARD'));release();
 assert.deepEqual((await h.query('SELECT * FROM membership_cards ORDER BY card_number')).rows,before);assert.equal((await h.query('SELECT count(*)::int AS n FROM learner_sessions')).rows[0].n,0);assert.equal((await h.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n,0);assert.equal(h.emails.length,1);
});
test('card recovery enforces atomic email cooldown, daily and IP limits without exposing ownership',async t=>{
 const h=await harness();t.after(()=>h.close());const request=()=>h.request(recoveryRoute,{method:'POST',body:{email:address}}),emailKey=keyHash('email:'+address),ipKey=keyHash('ip:127.0.0.1');
 const simultaneous=await Promise.all(Array.from({length:4},request));assert.ok(simultaneous.every(r=>r.status===202));await until(()=>h.emails.length===1);assert.ok(simultaneous.every(r=>JSON.stringify(r.data)===JSON.stringify(simultaneous[0].data)));
 assert.equal((await h.query('SELECT requests FROM learner_recovery_limits WHERE key_hash=$1',[emailKey])).rows[0].requests,1);
 await setupLearnerService(h.pool);await request();assert.equal(h.emails.length,1);
 await h.query("UPDATE learner_recovery_limits SET last_request_at=now()-interval '11 minutes' WHERE key_hash=$1",[emailKey]);await request();await until(()=>h.emails.length===2);
 await h.query("UPDATE learner_recovery_limits SET requests=5,last_request_at=now()-interval '11 minutes' WHERE key_hash=$1",[emailKey]);const daily=await request();assert.deepEqual(daily.data,simultaneous[0].data);assert.equal(h.emails.length,2);
 await h.query("UPDATE learner_recovery_limits SET window_started_at=now()-interval '25 hours' WHERE key_hash=$1",[emailKey]);await request();await until(()=>h.emails.length===3);
 await h.query('UPDATE learner_recovery_limits SET requests=60 WHERE key_hash=$1',[ipKey]);const limited=await request();assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');assert.equal(h.emails.length,3);
 await h.query("UPDATE learner_recovery_limits SET window_started_at=now()-interval '16 minutes' WHERE key_hash=$1",[ipKey]);assert.equal((await request()).status,202);assert.equal(h.emails.length,3);
 assert.ok((await h.query('SELECT key_hash FROM learner_recovery_limits')).rows.every(r=>/^[a-f0-9]{64}$/.test(r.key_hash)));
});
test('card recovery validates input and hides mail transport errors and account existence',async t=>{
 const h=await harness({sendEmail:async()=>{throw Object.assign(Error('private provider error '+address),{status:503})}});t.after(()=>h.close());
 for(const value of ['',null,['learner@example.invalid'],'x@example.invalid,other@example.invalid','x\r\n@example.invalid','a'.repeat(191)+'@example.invalid'])assert.equal((await h.request(recoveryRoute,{method:'POST',body:{email:value}})).status,400);
 assert.equal(h.emails.length,0);
 const known=await h.request(recoveryRoute,{method:'POST',body:{email:address}});await until(()=>h.mailErrors.length===1);assert.equal(known.status,202);assert.ok(!JSON.stringify(h.mailErrors).includes(address));assert.ok(!JSON.stringify(h.mailErrors).includes('private provider'));
 const unknown=await h.request(recoveryRoute,{method:'POST',body:{email:'absent@example.invalid'}});assert.deepEqual(unknown.data,known.data);
});
test('unconfigured recovery fails consistently without looking up or sending cards',async t=>{
 const h=await harness({mailEnabled:false});t.after(()=>h.close());
 const first=await h.request(recoveryRoute,{method:'POST',body:{email:address}}),second=await h.request(recoveryRoute,{method:'POST',body:{email:'absent@example.invalid'}});assert.equal(first.status,503);assert.equal(second.status,503);assert.deepEqual(first.data,second.data);assert.equal(h.emails.length,0);assert.equal((await h.query('SELECT count(*)::int AS n FROM learner_recovery_limits')).rows[0].n,0);
});
