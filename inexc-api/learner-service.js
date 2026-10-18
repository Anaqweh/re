import {allowsRepeatRegistration} from './registration-policy.js';
import {membershipCardName,cardAllowedForCourse} from './course-card-access.js';
import {setupCertificateRequests,enqueueCertificateRequest} from './certificate-requests.js';
// Learner records, card checkout and explicitly requested card recovery. No mail workers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

const text=(v,max=200)=>String(v??'').trim().slice(0,max);
const email=v=>text(v,190).toLowerCase();
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=v=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const positive=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
const cardQuery=`SELECT p.*,c.*,p.id AS plan_id,p.name AS plan_name FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id`;

export async function setupLearnerService(db){
 await db.query(`CREATE TABLE IF NOT EXISTS learner_access_keys(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),email TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE IF NOT EXISTS learner_sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE IF NOT EXISTS learner_recovery_limits(key_hash TEXT PRIMARY KEY,window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),requests INTEGER NOT NULL DEFAULT 1)`);
 await db.query('CREATE INDEX IF NOT EXISTS learner_recovery_expiry ON learner_recovery_limits(last_request_at)');
 await db.query(`CREATE TABLE IF NOT EXISTS learner_progress(registration_id UUID PRIMARY KEY REFERENCES registrations(id) ON DELETE CASCADE,state TEXT NOT NULL DEFAULT 'not_started' CHECK(state IN ('not_started','in_progress','completed')),progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),attended_hours NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK(attended_hours>=0),completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE IF NOT EXISTS learner_certificates(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,title TEXT NOT NULL,certificate_number TEXT UNIQUE NOT NULL,issued_on DATE NOT NULL,filename TEXT NOT NULL,original_name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS certificate_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0`);
 await db.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS certificate_fee_status TEXT NOT NULL DEFAULT 'not_required'`);
 await db.query('CREATE INDEX IF NOT EXISTS learner_registration_email ON registrations(lower(email))');
 await db.query('CREATE INDEX IF NOT EXISTS learner_redemption_card_course ON membership_redemptions(card_id,course_id)');
 await setupCertificateRequests(db);
}

export function cardQuote(card,course,certificateRequested=false,now=new Date()){
 if(card.status!=='active'||new Date(card.expires_at)<=now)throw fail('هذه البطاقة غير فعّالة أو انتهت صلاحيتها.');
 if(!course.active||!course.membership_enabled)throw fail('هذه الدورة غير متاحة للحجز بالبطاقة.');
 if(!cardAllowedForCourse(card,course))throw fail('هذه الدورة غير صالحة ل'+membershipCardName(card.plan_name)+'. اختر دورة تقبل بطاقتك أو طريقة دفع أخرى.');
 if(course.member_booking_opens_at&&new Date(course.member_booking_opens_at)>now)throw fail('الحجز لحاملي البطاقات لم يبدأ بعد.');
 const kind=course.membership_kind==='diploma'?'diploma':'course';
 const cost=Number(kind==='diploma'?card.diploma_unit_cost:card.course_unit_cost);
 if(!Number.isInteger(cost)||cost<=0)throw fail('تعذّر تحديد رصيد هذه الدورة. تواصل مع الإدارة.');
 if(Number(card.units_remaining)<cost)throw fail('الرصيد المتبقي في البطاقة لا يكفي لحجز هذه الدورة.');
 const discount=Math.max(0,Math.min(100,Number(card.certificate_discount)||0));
 const certificateFee=course.certificate_mode==='optional'&&certificateRequested?Math.round(positive(course.certificate_price)*(100-discount))/100:0;
 const certificateDeferred=Number(course.price)===0;
 if(certificateFee>0&&!certificateDeferred&&!course.payment_methods?.includes('bank'))throw fail('رسوم الشهادة الاختيارية مع بطاقة INEXC تحتاج تحويلًا بنكيًا، وهو غير مفعّل لهذه الدورة. اختر التسجيل دون الشهادة أو استخدم طريقة دفع أخرى متاحة.');
 return {cost,kind,remainingBefore:Number(card.units_remaining),remainingAfter:Number(card.units_remaining)-cost,certificateFee,certificateDiscount:discount,certificateDeferred};
}

// The card row is locked on ONE transaction connection until both booking and debit commit.
export async function createCardRegistration(pool,input){
 if(!uuid(input.courseId))throw fail('اختر دورة صالحة.');
 if(!text(input.name)||!text(input.phone)||!email(input.email)||!text(input.code))throw fail('أكمل بيانات التسجيل ورقم البطاقة.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const card=(await client.query(cardQuery+' WHERE upper(c.card_number)=upper($1) AND lower(c.holder_email)=$2 FOR UPDATE OF c',[text(input.code,80),email(input.email)])).rows[0];
  if(!card)throw fail('رقم البطاقة أو البريد الإلكتروني غير صحيح.',404);
  if(Number(card.price_usd)===0&&input.shareConsent!==true)throw fail('يلزم قبول شرط مشاركة رابط البطاقة قبل تأكيد حجز الباقة المجانية.');
  const previous=(await client.query(`SELECT r.id,r.reference,r.status,r.total,r.certificate_fee_amount,d.units_used FROM membership_redemptions d JOIN registrations r ON r.id=d.registration_id WHERE d.card_id=$1 AND d.course_id=$2 AND d.status='used' AND r.status<>'ملغى' ORDER BY d.created_at LIMIT 1`,[card.id,input.courseId])).rows[0];
  if(previous&&!allowsRepeatRegistration(card.holder_email)){await client.query('COMMIT');return {ok:true,reference:previous.reference,status:previous.status,alreadyRegistered:true,unitsUsed:Number(previous.units_used),remaining:Number(card.units_remaining),certificateFee:Number(previous.certificate_fee_amount),registrationId:previous.id};}
  const course=(await client.query('SELECT * FROM courses WHERE id=$1 FOR SHARE',[input.courseId])).rows[0];
  if(!course)throw fail('الدورة غير متاحة للتسجيل.');
  if(Number(card.price_usd)===0&&Number(course.price)!==0)throw fail('الباقة المجانية مخصصة للدورات المجانية المتاحة لها.');
  const quote=cardQuote(card,course,input.certificateRequested);
  if((input.expectedUnits!=null&&Number(input.expectedUnits)!==quote.cost)||(input.expectedCertificateFee!=null&&Number(input.expectedCertificateFee)!==quote.certificateFee))throw fail('تغيّرت تكلفة الحجز. تحقّق من الرصيد والرسوم مجددًا قبل التأكيد.',409);
  if(quote.certificateFee>0&&!quote.certificateDeferred&&!input.receiptPath)throw fail('الحجز بالبطاقة يغطي الدورة. أرفق وصل رسوم الشهادة الاختيارية بعد الخصم، أو اختر التسجيل دونها.');
  const certificate=course.certificate_mode==='none'?'لا':course.certificate_mode==='included'||input.certificateRequested?course.certificate_name:'لا';
  const reference='INX-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
  const registration=(await client.query(`INSERT INTO registrations(reference,name,email,phone,course_id,course_name,certificate,total,payment_method,status,receipt_path,membership_card_id,certificate_fee_amount,certificate_fee_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'membership','مسجل بالبطاقة',$9,$10,$8,$11) RETURNING id`,[reference,text(input.name,150),email(input.email),text(input.phone,50),course.id,course.name,certificate,quote.certificateFee,input.receiptPath||'',card.id,quote.certificateFee>0?(quote.certificateDeferred?'awaiting_payment':'pending'):'not_required'])).rows[0];
  const certificateRequestId=quote.certificateDeferred&&certificate!=='لا'?await enqueueCertificateRequest(client,{registrationId:registration.id,amount:quote.certificateFee}):null;
  const redemption=(await client.query(`INSERT INTO membership_redemptions(card_id,course_id,registration_id,units_used,course_kind) VALUES($1,$2,$3,$4,$5) RETURNING id`,[card.id,course.id,registration.id,quote.cost,quote.kind])).rows[0];
  await client.query('UPDATE registrations SET membership_redemption_id=$1 WHERE id=$2',[redemption.id,registration.id]);
  const debited=await client.query('UPDATE membership_cards SET units_remaining=units_remaining-$1,updated_at=now() WHERE id=$2 AND units_remaining>=$1 RETURNING units_remaining',[quote.cost,card.id]);
  if(!debited.rowCount)throw fail('تغيّر رصيد البطاقة. تحقق منه مجددًا.',409);
  await client.query('COMMIT');
  return {ok:true,reference,status:'مسجل بالبطاقة',registrationId:registration.id,unitsUsed:quote.cost,remaining:Number(debited.rows[0].units_remaining),certificateFee:quote.certificateFee,courseName:course.name,freeCourse:Number(course.price)===0,certificateDeferred:quote.certificateDeferred,certificateRequestId};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

function cardView(c){return {number:c.card_number,planName:membershipCardName(c.plan_name),status:c.status==='active'&&new Date(c.expires_at)<=new Date()?'expired':c.status,expiresAt:c.expires_at,unitsTotal:Number(c.units_total),unitsRemaining:Number(c.units_remaining),courseUnitCost:Number(c.course_unit_cost),diplomaUnitCost:Number(c.diploma_unit_cost)};}
export async function learnerDashboard(db,address){
 const normalized=email(address);
 const registrations=(await db.query(`SELECT r.id,r.reference,r.name,r.course_id,r.course_name,r.status,r.payment_method,r.created_at,r.certificate_fee_amount,r.certificate_fee_status,COALESCE(c.training_hours,0) AS training_hours,c.course_date,c.location,COALESCE(p.state,'not_started') AS learning_state,COALESCE(p.progress_percent,0) AS progress_percent,COALESCE(p.attended_hours,0) AS attended_hours,p.completed_at FROM registrations r LEFT JOIN courses c ON c.id=r.course_id LEFT JOIN learner_progress p ON p.registration_id=r.id WHERE lower(r.email)=$1 AND COALESCE(r.request_kind,'individual')<>'institution' ORDER BY r.created_at DESC`,[normalized])).rows;
 const cards=(await db.query(cardQuery+' WHERE lower(c.holder_email)=$1 ORDER BY c.created_at DESC',[normalized])).rows;
 const certificates=(await db.query(`SELECT c.id,c.title,c.certificate_number,c.issued_on,r.course_name,c.registration_id FROM learner_certificates c JOIN registrations r ON r.id=c.registration_id WHERE lower(r.email)=$1 ORDER BY c.issued_on DESC,c.created_at DESC`,[normalized])).rows;
 const history=(await db.query(`SELECT d.id,c.card_number,co.name AS course_name,d.units_used,d.status,d.created_at,r.reference FROM membership_redemptions d JOIN membership_cards c ON c.id=d.card_id JOIN courses co ON co.id=d.course_id LEFT JOIN registrations r ON r.id=d.registration_id WHERE lower(c.holder_email)=$1 ORDER BY d.created_at DESC`,[normalized])).rows;
 const active=registrations.filter(r=>r.status!=='ملغى');
 return {profile:{name:cards[0]?.holder_name||registrations[0]?.name||'متدرب INEXC',email:normalized,phone:cards[0]?.holder_phone||''},stats:{registered:active.length,completed:active.filter(r=>r.learning_state==='completed').length,attendedHours:Math.round(active.reduce((sum,r)=>sum+positive(r.attended_hours),0)*100)/100,scheduledHours:active.reduce((sum,r)=>sum+positive(r.training_hours),0),certificates:certificates.length},courses:registrations.map(r=>({...r,training_hours:positive(r.training_hours),attended_hours:positive(r.attended_hours),progress_percent:Number(r.progress_percent),certificate_fee_amount:Number(r.certificate_fee_amount)})),cards:cards.map(cardView),certificates,history};
}

export function installLearnerService({app,pool,auth,uploadDir,sendEmail,emailShell,mailEnabled=false,logger=console}){
 const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 const attempts=new Map();
 const requireLearner=asyncRoute(async(req,res,next)=>{
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const session=/^[a-f\d]{64}$/.test(token)?(await pool.query('SELECT email FROM learner_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(token)])).rows[0]:null;
  if(!session)return res.status(401).json({error:'انتهت جلسة المتدرب. سجّل الدخول مجددًا.'});
  req.learnerEmail=session.email;req.learnerTokenHash=hash(token);next();
 });
 app.use('/api/admin/learner-records',(_req,res,next)=>{res.set('Cache-Control','no-store');next()});
 app.get('/api/learner/capabilities',(_req,res)=>res.json({version:1,cardCheckout:3,certificateRequests:1,courseCardAccess:1,certificates:true,cardRecovery:true,coursePaymentLinks:true}));
 app.post('/api/learner/card-recovery',asyncRoute(async(req,res)=>{
  res.set('Cache-Control','no-store');
  const raw=req.body?.email,address=typeof raw==='string'?raw.trim().toLowerCase():'';
  if(address.length>190||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(address))throw fail('أدخل بريدًا إلكترونيًا صحيحًا.');
  if(!mailEnabled||typeof sendEmail!=='function'||typeof emailShell!=='function')return res.status(503).json({error:'استرجاع رقم البطاقة غير متاح مؤقتًا. حاول لاحقًا أو تواصل مع الإدارة.'});
  await pool.query("DELETE FROM learner_recovery_limits WHERE last_request_at<now()-interval '2 days'");
  // Atomic limits persist across restarts. No raw email addresses or IPs are stored here.
  const ipLimit=await pool.query(`INSERT INTO learner_recovery_limits(key_hash) VALUES($1)
   ON CONFLICT(key_hash) DO UPDATE SET window_started_at=CASE WHEN learner_recovery_limits.window_started_at<=now()-interval '15 minutes' THEN now() ELSE learner_recovery_limits.window_started_at END,
   requests=CASE WHEN learner_recovery_limits.window_started_at<=now()-interval '15 minutes' THEN 1 ELSE learner_recovery_limits.requests+1 END,last_request_at=now()
   WHERE learner_recovery_limits.window_started_at<=now()-interval '15 minutes' OR learner_recovery_limits.requests<60 RETURNING key_hash`,[hash('ip:'+String(req.ip||req.socket?.remoteAddress||'unknown'))]);
  if(!ipLimit.rowCount){res.set('Retry-After','900');throw fail('طلبات كثيرة خلال وقت قصير. انتظر 15 دقيقة ثم أعد المحاولة.',429)}
  const claimed=await pool.query(`INSERT INTO learner_recovery_limits(key_hash) VALUES($1)
   ON CONFLICT(key_hash) DO UPDATE SET window_started_at=CASE WHEN learner_recovery_limits.window_started_at<=now()-interval '1 day' THEN now() ELSE learner_recovery_limits.window_started_at END,
   requests=CASE WHEN learner_recovery_limits.window_started_at<=now()-interval '1 day' THEN 1 ELSE learner_recovery_limits.requests+1 END,last_request_at=now()
   WHERE learner_recovery_limits.last_request_at<=now()-interval '10 minutes' AND (learner_recovery_limits.window_started_at<=now()-interval '1 day' OR learner_recovery_limits.requests<5) RETURNING key_hash`,[hash('email:'+address)]);
  // Respond before looking up cards or contacting Resend: neither response nor mail latency reveals membership.
  res.status(202).json({ok:true,message:'إذا كانت هناك باقة مرتبطة بهذا البريد، فستصلك رسالة برقمها. تفقد الوارد والبريد غير المرغوب فيه، وانتظر 10 دقائق قبل إعادة الطلب.'});
  if(!claimed.rowCount)return;
  try{
   const cards=(await pool.query(`SELECT c.card_number,c.holder_name,p.name AS plan_name FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id WHERE lower(c.holder_email)=$1 ORDER BY c.created_at DESC`,[address])).rows;
   if(!cards.length)return;
   const title=cards.length===1?'رقم بطاقتك التدريبية':'أرقام باقاتك التدريبية';
   const content=`<h1 style="font-size:23px;color:#103b70">${title}</h1><p>مرحبًا ${escapeHtml(cards[0].holder_name)}،</p><p>بناءً على طلبك، هذه بيانات البطاقات المرتبطة ببريدك الإلكتروني:</p>${cards.map(card=>`<div style="background:#eef6ff;border:1px solid #d3e5f8;border-radius:10px;padding:16px;margin:14px 0"><strong>${escapeHtml(membershipCardName(card.plan_name))}</strong><div dir="ltr" style="direction:ltr;text-align:center;font-family:monospace;font-size:20px;font-weight:bold;color:#0866c6;margin-top:8px">${escapeHtml(card.card_number)}</div></div>`).join('')}<p>استخدم بريدك الإلكتروني ورقم البطاقة للدخول إلى صفحتك التدريبية.</p><p style="text-align:center"><a href="https://www.inexctraining.com/account.html" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;border-radius:9px;padding:12px 20px;font-weight:bold">الدخول إلى صفحتي</a></p><p style="font-size:12px;color:#64778c">احتفظ برقم بطاقتك لنفسك. إذا لم تطلب هذه الرسالة، يمكنك تجاهلها؛ لم تتغير بيانات بطاقتك أو رصيدها.</p>`;
   const plain=`${title}\n\n${cards.map(card=>`${membershipCardName(card.plan_name)}: ${card.card_number}`).join('\n')}\n\nاستخدم بريدك ورقم البطاقة للدخول:\nhttps://www.inexctraining.com/account.html\n\nإذا لم تطلب الرسالة، تجاهلها. لم تتغير بيانات بطاقتك أو رصيدها.`;
   await sendEmail({to:address,subject:title+' | INEXC',html:emailShell({title,preview:'بيانات بطاقتك بناءً على طلب الاسترجاع.',content}),text:plain,marketing:false,idempotencyKey:'learner-card-recovery/'+crypto.randomUUID()});
  }catch(error){logger.error('Learner card recovery delivery failed',{status:Number(error.status)||500})}
 }));
 app.post('/api/learner/session',asyncRoute(async(req,res)=>{
  res.set('Cache-Control','no-store');
  const cardToken=text(req.body?.cardToken,100),code=text(req.body?.code,160),now=Date.now();
  let address=email(req.body?.email);const key=req.ip+':'+address;
  for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  const attempt=attempts.get(key)||{count:0,until:now+10*60*1000};
  if(attempt.count>=12)return res.status(429).json({error:'محاولات كثيرة. انتظر عشر دقائق ثم أعد المحاولة.'});
  attempt.count++;attempts.set(key,attempt);
  if(!cardToken&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||!code))throw fail('أدخل بريدك ورقم البطاقة أو رمز الدخول الخاص.');
  let matched=false;
  if(/^[a-f\d]{48}$/.test(cardToken)){const card=(await pool.query('SELECT holder_email FROM membership_cards WHERE access_token=$1',[cardToken])).rows[0];if(card){address=email(card.holder_email);matched=true}}
  if(!matched&&code)matched=(await pool.query('SELECT holder_email FROM membership_cards WHERE upper(card_number)=upper($1) AND lower(holder_email)=$2',[code,address])).rowCount>0;
  if(!matched&&code)matched=(await pool.query('SELECT id FROM learner_access_keys WHERE email=$1 AND token_hash=$2 AND revoked_at IS NULL',[address,hash(code)])).rowCount>0;
  if(!matched)throw fail('بيانات الدخول غير صحيحة. استخدم البريد المرتبط ببطاقتك أو رمز الدخول الذي زوّدتك به الإدارة.',401);
  attempts.delete(key);const token=crypto.randomBytes(32).toString('hex'),expiresAt=new Date(now+8*60*60*1000).toISOString();
  await pool.query('DELETE FROM learner_sessions WHERE expires_at<now()');
  await pool.query('INSERT INTO learner_sessions(token_hash,email,expires_at) VALUES($1,$2,$3)',[hash(token),address,expiresAt]);
  res.json({token,expiresAt});
 }));
 app.delete('/api/learner/session',requireLearner,asyncRoute(async(req,res)=>{await pool.query('DELETE FROM learner_sessions WHERE token_hash=$1',[req.learnerTokenHash]);res.json({ok:true})}));
 app.get('/api/learner/dashboard',requireLearner,asyncRoute(async(req,res)=>{res.set('Cache-Control','no-store');res.json(await learnerDashboard(pool,req.learnerEmail))}));
 const privateDir=path.join(uploadDir,'.trainee-private');
 const certUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024},fileFilter:(_req,file,cb)=>cb(file.mimetype==='application/pdf'?null:fail('ارفع الشهادة بصيغة PDF.'),file.mimetype==='application/pdf')});
 app.get('/api/learner/certificates/:id/download',requireLearner,asyncRoute(async(req,res)=>{
  if(!uuid(req.params.id))throw fail('الشهادة غير موجودة.',404);
  const c=(await pool.query(`SELECT c.filename,c.certificate_number FROM learner_certificates c JOIN registrations r ON r.id=c.registration_id WHERE c.id=$1 AND lower(r.email)=$2`,[req.params.id,req.learnerEmail])).rows[0];
  if(!c||path.basename(c.filename)!==c.filename)throw fail('الشهادة غير موجودة.',404);
  res.set('Cache-Control','no-store');res.download(path.join(privateDir,c.filename),'INEXC-'+c.certificate_number.replace(/[^\w-]/g,'')+'.pdf',{dotfiles:'allow'});
 }));
 app.get('/api/admin/learner-records/:id',auth,asyncRoute(async(req,res)=>{
  if(!uuid(req.params.id))throw fail('التسجيل غير موجود.',404);
  const r=(await pool.query('SELECT id,name,email,course_name,certificate_fee_amount,certificate_fee_status,EXISTS(SELECT 1 FROM certificate_requests q WHERE q.registration_id=registrations.id) AS certificate_payment_managed FROM registrations WHERE id=$1',[req.params.id])).rows[0];if(!r)throw fail('التسجيل غير موجود.',404);
  const progress=(await pool.query('SELECT * FROM learner_progress WHERE registration_id=$1',[r.id])).rows[0]||{state:'not_started',progress_percent:0,attended_hours:0};
  const certificates=(await pool.query('SELECT id,title,certificate_number,issued_on FROM learner_certificates WHERE registration_id=$1 ORDER BY created_at DESC',[r.id])).rows;
  res.json({registration:r,progress,certificates});
 }));
 app.put('/api/admin/learner-records/:id',auth,asyncRoute(async(req,res)=>{
  if(!uuid(req.params.id))throw fail('التسجيل غير موجود.',404);
  const state=text(req.body?.state),progress=Number(req.body?.progress),hours=Number(req.body?.hours);
  if(!['not_started','in_progress','completed'].includes(state)||!Number.isInteger(progress)||progress<0||progress>100||!Number.isFinite(hours)||hours<0||hours>100000)throw fail('راجع حالة الدورة ونسبة التقدم والساعات.');
  if(!(await pool.query('SELECT id FROM registrations WHERE id=$1',[req.params.id])).rowCount)throw fail('التسجيل غير موجود.',404);
  await pool.query(`INSERT INTO learner_progress(registration_id,state,progress_percent,attended_hours,completed_at) VALUES($1,$2,$3,$4,CASE WHEN $2='completed' THEN now() ELSE NULL END) ON CONFLICT(registration_id) DO UPDATE SET state=EXCLUDED.state,progress_percent=EXCLUDED.progress_percent,attended_hours=EXCLUDED.attended_hours,completed_at=CASE WHEN EXCLUDED.state='completed' THEN COALESCE(learner_progress.completed_at,now()) ELSE NULL END,updated_at=now()`,[req.params.id,state,state==='completed'?100:state==='not_started'?0:progress,hours]);
  if(['paid','pending'].includes(req.body?.certificateFeeStatus))await pool.query('UPDATE registrations SET certificate_fee_status=$1 WHERE id=$2 AND certificate_fee_amount>0 AND NOT EXISTS(SELECT 1 FROM certificate_requests q WHERE q.registration_id=registrations.id)',[req.body.certificateFeeStatus,req.params.id]);
  res.json({ok:true});
 }));
 app.post('/api/admin/learner-records/:id/access',auth,asyncRoute(async(req,res)=>{
  if(!uuid(req.params.id))throw fail('التسجيل غير موجود.',404);
  const r=(await pool.query('SELECT email FROM registrations WHERE id=$1',[req.params.id])).rows[0];if(!r)throw fail('التسجيل غير موجود.',404);
  const code=crypto.randomBytes(24).toString('hex');
  await pool.query('INSERT INTO learner_access_keys(email,token_hash) VALUES($1,$2)',[email(r.email),hash(code)]);
  res.json({code,email:email(r.email)});
 }));
 app.post('/api/admin/learner-records/:id/certificates',auth,certUpload.single('file'),asyncRoute(async(req,res)=>{
  if(!uuid(req.params.id))throw fail('التسجيل غير موجود.',404);
  const r=(await pool.query('SELECT id,certificate_fee_amount,certificate_fee_status FROM registrations WHERE id=$1',[req.params.id])).rows[0];if(!r)throw fail('التسجيل غير موجود.',404);
  if(Number(r.certificate_fee_amount)>0&&r.certificate_fee_status!=='paid')throw fail('راجع رسوم الشهادة وأكّد استلامها قبل إتاحة الشهادة.');
  const title=text(req.body?.title),number=text(req.body?.number,100),issuedOn=text(req.body?.issuedOn,10);
  if(!title||!number||!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)||(!Number.isFinite(Date.parse(issuedOn))||new Date(issuedOn).toISOString().slice(0,10)!==issuedOn))throw fail('أكمل اسم الشهادة ورقمها وتاريخ إصدارها.');
  if(!req.file||req.file.buffer.subarray(0,5).toString()!=='%PDF-')throw fail('ارفع ملف PDF صالحًا.');
  fs.mkdirSync(privateDir,{recursive:true,mode:0o700});const filename=crypto.randomUUID()+'.pdf',filePath=path.join(privateDir,filename);fs.writeFileSync(filePath,req.file.buffer,{mode:0o600});
  try{const c=(await pool.query('INSERT INTO learner_certificates(registration_id,title,certificate_number,issued_on,filename,original_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[r.id,title,number,issuedOn,filename,text(req.file.originalname)])).rows[0];res.status(201).json({ok:true,id:c.id})}catch(error){fs.unlinkSync(filePath);if(error.code==='23505')throw fail('رقم الشهادة مستخدم بالفعل.',409);throw error}
 }));
}
