// Optional certificates are independent of the confirmed free-course registration.
import crypto from 'node:crypto';
import {amountInFils, stripeClient} from './stripe-payments.js';

const SITE='https://www.inexctraining.com';
const SOURCE='inexc-certificates-v1';
const uuid=v=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v||''));
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const certificateLink=row=>SITE+'/certificate-request.html#request='+row.id+'&token='+row.access_token;

export async function setupCertificateRequests(db){
 await db.query(`CREATE TABLE IF NOT EXISTS certificate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), registration_id UUID UNIQUE NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  access_token TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), currency TEXT NOT NULL DEFAULT 'aed',
  arabic_name TEXT NOT NULL DEFAULT '', english_name TEXT NOT NULL DEFAULT '', names_confirmed_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','awaiting_payment','paid','no_fee')),
  paid_at TIMESTAMPTZ, payment_intent TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'pending', email_due_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '3 minutes',
  email_attempts INTEGER NOT NULL DEFAULT 0, email_locked_until TIMESTAMPTZ, email_sent_at TIMESTAMPTZ,
  email_provider_id TEXT NOT NULL DEFAULT '', email_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS certificate_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES certificate_requests(id) ON DELETE CASCADE,
  params JSONB NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'aed',
  stripe_session_id TEXT UNIQUE, checkout_url TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'creating',
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db.query('CREATE INDEX IF NOT EXISTS certificate_request_email_due ON certificate_requests(email_status,email_due_at)');
 await db.query('CREATE INDEX IF NOT EXISTS certificate_attempt_request ON certificate_payment_attempts(request_id,created_at DESC)');
 await db.query("CREATE UNIQUE INDEX IF NOT EXISTS certificate_intent_unique ON certificate_requests(payment_intent) WHERE payment_intent<>''");
}

// Called inside the registration transaction: no orphaned request and no premature mail.
export async function enqueueCertificateRequest(db,{registrationId,amount}){
 const row=(await db.query(`INSERT INTO certificate_requests(registration_id,access_token,amount)
  VALUES($1,$2,$3) ON CONFLICT(registration_id) DO NOTHING RETURNING id`,[registrationId,crypto.randomBytes(32).toString('hex'),amountInFils(Number(amount).toFixed(2))])).rows[0];
 return row?.id||null;
}

// Operator-only repair of one explicitly requested certificate. Never books or debits a card.
// The CLI must supply the registration, recipient, course and reviewed fee; it is not a public route.
export async function repairRequestedCertificate(pool,{reference,email,courseId,expectedAmount}){
 if(!clean(reference)||!clean(email)||!uuid(courseId)||!Number.isFinite(expectedAmount)||expectedAmount<0)throw fail('Incomplete certificate repair parameters.');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`SELECT r.*,c.price AS course_price,c.certificate_mode,c.certificate_name,c.certificate_price,p.certificate_discount
   FROM registrations r JOIN courses c ON c.id=r.course_id
   JOIN membership_cards m ON m.id=r.membership_card_id JOIN membership_plans p ON p.id=m.plan_id
   WHERE r.reference=$1 AND lower(r.email)=$2 AND r.course_id=$3 FOR UPDATE OF r`,[reference,email.trim().toLowerCase(),courseId])).rows[0];
  if(!row||row.status!=='مسجل بالبطاقة'||row.payment_method!=='membership'||Number(row.course_price)!==0||row.certificate_mode!=='optional')throw fail('Registration does not match an eligible confirmed free-course booking.',409);
  const existing=(await db.query('SELECT id,amount,state,email_status FROM certificate_requests WHERE registration_id=$1 FOR UPDATE',[row.id])).rows[0];
  if(existing){await db.query('COMMIT');return {created:false,amount:existing.amount/100,state:existing.state,emailStatus:existing.email_status}}
  if(row.certificate_fee_status==='paid'||Number(row.certificate_fee_amount)!==0||Number(row.total)!==0||row.certificate!=='لا')throw fail('Existing certificate or fee requires review; no data changed.',409);
  const discount=Math.max(0,Math.min(100,Number(row.certificate_discount)||0));
  const amount=Math.round(Number(row.certificate_price)*(100-discount))/100;
  if(!Number.isFinite(amount)||amount<0||amount!==expectedAmount)throw fail('Certificate price differs from the reviewed amount; no data changed.',409);
  await db.query("UPDATE registrations SET certificate=$1,total=$2,certificate_fee_amount=$2,certificate_fee_status=$3,updated_at=now() WHERE id=$4",[row.certificate_name,amount,amount>0?'awaiting_payment':'not_required',row.id]);
  const id=await enqueueCertificateRequest(db,{registrationId:row.id,amount});
  await db.query('UPDATE certificate_requests SET email_due_at=now() WHERE id=$1',[id]);
  await db.query('COMMIT');
  return {created:true,amount,state:'requested',emailStatus:'pending'};
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export function certificateNames(input){
 const normalize=v=>String(v??'').trim().replace(/\s+/g,' ');
 const arabic=normalize(input.arabicName),english=normalize(input.englishName);
 if(arabic.length>180||arabic.split(' ').length<3||!/^\p{Script=Arabic}[\p{Script=Arabic}\p{M} '\-]+$/u.test(arabic)||/[\p{N}]/u.test(arabic))throw fail('اكتب الاسم الثلاثي باللغة العربية كما تريد ظهوره على الشهادة.');
 if(english.length>180||english.split(' ').length<2||!/^\p{Script=Latin}[\p{Script=Latin}\p{M} .’'\-]+$/u.test(english))throw fail('اكتب الاسم الكامل باللغة الإنجليزية بحروف إنجليزية.');
 return {arabic,english};
}

export function certificateEmail(row,emailShell){
 const paid=Number(row.amount)>0,title=paid?'استكمال طلب شهادتك':'تأكيد بيانات شهادتك',url=certificateLink(row);
 const amount=(row.amount/100).toLocaleString('ar-AE',{minimumFractionDigits:2});
 const content=`<div style="font-size:12px;color:#0866c6;font-weight:bold">شؤون المتدربين · طلب الشهادة</div><h1 style="font-size:25px;line-height:1.6;color:#103b70;margin:10px 0 18px">${title}</h1><p>الأستاذ/ة ${esc(row.name)}،</p><p>نؤكد تسجيلكم في دورة <strong>${esc(row.course_name)}</strong>. وبناءً على اختياركم الحصول على الشهادة، يرجى مراجعة بياناتها عبر الرابط أدناه.</p><table role="presentation" width="100%" cellpadding="14" cellspacing="0" style="background:#f3f8fe;border:1px solid #dceafb;border-radius:12px;margin:22px 0;font-size:14px"><tr><td style="color:#627b93">الشهادة المطلوبة</td><td style="font-weight:bold">${esc(row.certificate)}</td></tr><tr><td style="color:#627b93">رقم التسجيل</td><td dir="ltr" style="text-align:right">${esc(row.reference)}</td></tr><tr><td style="color:#627b93">رسوم الشهادة</td><td style="font-size:20px;font-weight:bold;color:#0866c6">${paid?amount+' د.إ':'دون رسوم'}</td></tr></table><p>يرجى كتابة الاسم الثلاثي بالعربية والاسم الكامل بالإنجليزية بدقة؛ ستُعتمد هذه البيانات في طلب الشهادة.</p><p style="text-align:center;margin:28px 0"><a href="${url}" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-size:16px;font-weight:bold">${paid?'مراجعة البيانات وسداد رسوم الشهادة':'تأكيد الاسم على الشهادة'}</a></p><p style="background:#edf8f4;border-right:3px solid #148260;padding:13px 16px;border-radius:8px;font-size:13px;color:#28634e">تسجيلكم في الدورة المجانية مؤكد. طلب الشهادة اختياري، ${paid?'ورسومها منفصلة عن حضور الدورة.':'ولا يلزم دفع أي مبلغ لهذا الطلب.'}</p><p style="font-size:13px;color:#627b93">إصدار الشهادة مرتبط باستيفاء متطلبات الدورة. هذا الرابط خاص بطلبكم؛ يرجى عدم مشاركته.</p><p>مع خالص التحية،<br><strong>شؤون المتدربين — INEXC Training</strong></p>`;
 return {to:row.email,subject:title+' | '+row.course_name,html:emailShell({title,preview:paid?'تسجيلك مؤكد. أكمل الاسم وسدّد رسوم الشهادة الاختيارية.':'تسجيلك مؤكد. أكمل بيانات اسمك على الشهادة.',content}),text:`${title}\n${row.name}\n${row.course_name}\nالشهادة: ${row.certificate}\nرقم التسجيل: ${row.reference}\nرسوم الشهادة: ${paid?row.amount/100+' د.إ':'دون رسوم'}\n\nأكمل الاسم الثلاثي بالعربية والاسم الكامل بالإنجليزية:\n${url}\n\nتسجيلك في الدورة المجانية مؤكد. طلب الشهادة اختياري. هذا الرابط خاص بك.`,marketing:false,idempotencyKey:'certificate-request/'+row.id};
}

export function createCertificateRequests({pool,env=process.env,client,sendEmail,emailShell,mailEnabled=false,mailAllowed=async()=>true,now=()=>Date.now(),logger=console}){
 const secret=clean(env.STRIPE_SECRET_KEY,300),live=/^(sk|rk)_live_/.test(secret),stripe=client||stripeClient(secret);
 const enabled=()=>env.STRIPE_CHECKOUT_ENABLED==='1'&&live&&String(env.STRIPE_WEBHOOK_SECRET||'').startsWith('whsec_');
 const rowSQL=`SELECT q.*,r.reference,r.name,r.email,r.course_name,r.certificate,r.course_id,r.status AS registration_status,c.payment_methods
  FROM certificate_requests q JOIN registrations r ON r.id=q.registration_id LEFT JOIN courses c ON c.id=r.course_id`;
 function credentials(input){if(!uuid(input.request)||!/^[a-f\d]{64}$/.test(String(input.token||'')))throw fail('رابط طلب الشهادة غير صالح.',404);return [input.request,input.token]}
 async function find(input,db=pool,lock=false){const row=(await db.query(rowSQL+' WHERE q.id=$1 AND q.access_token=$2'+(lock?' FOR UPDATE OF q,r':''),credentials(input))).rows[0];if(!row)throw fail('رابط طلب الشهادة غير صالح.',404);return row}
 const latest=(db,id)=>db.query('SELECT * FROM certificate_payment_attempts WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id]).then(r=>r.rows[0]);
 function view(row,attempt){
  const cancelled=row.registration_status==='ملغى',paid=row.state==='paid',noFee=row.amount===0;
  return {id:row.id,reference:row.reference,courseName:row.course_name,certificateName:row.certificate,amount:row.amount/100,currency:'AED',arabicName:row.arabic_name,englishName:row.english_name,namesConfirmed:!!row.names_confirmed_at,
   state:cancelled?'cancelled':row.state,paidAt:row.paid_at,canPay:!cancelled&&!paid&&!noFee&&enabled()&&row.payment_methods?.includes('stripe')===true,
   namesLocked:!!attempt&&!['expired','failed'].includes(attempt.state)&&(!!attempt.stripe_session_id||new Date(attempt.expires_at).getTime()>now())||paid,processing:attempt?.state==='processing',paymentLink:!cancelled&&!paid&&enabled()&&row.payment_methods?.includes('stripe')&&attempt?.state==='open'?attempt.checkout_url:''};
 }
 async function reconcile(session,failed=false){
  const meta=session.metadata||{};if(meta.source!==SOURCE||!uuid(meta.request_id)||!uuid(meta.attempt_id))return;
  const db=await pool.connect();try{
   await db.query('BEGIN');
   const row=(await db.query('SELECT * FROM certificate_requests WHERE id=$1 FOR UPDATE',[meta.request_id])).rows[0];
   const attempt=(await db.query('SELECT * FROM certificate_payment_attempts WHERE id=$1 AND request_id=$2',[meta.attempt_id,meta.request_id])).rows[0];
   if(!row||!attempt){await db.query('COMMIT');return}
   if(session.livemode!==live||session.mode!=='payment'||session.amount_total!==row.amount||session.amount_total!==attempt.amount||session.currency!=='aed'||session.client_reference_id!==row.id||meta.registration_id!==row.registration_id||(attempt.stripe_session_id&&attempt.stripe_session_id!==session.id))throw fail('تعذّر مطابقة تفاصيل دفع الشهادة.',409);
   if(session.payment_status==='paid'){
    const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
    if(!intent)throw fail('تعذّر التحقق من عملية الدفع.',409);
    if(row.state==='paid'&&row.payment_intent!==intent)throw fail('توجد عملية دفع مسجلة لهذا الطلب. راجع الإدارة.',409);
    await db.query("UPDATE certificate_requests SET state='paid',paid_at=COALESCE(paid_at,now()),payment_intent=$1,updated_at=now() WHERE id=$2",[intent,row.id]);
    await db.query("UPDATE registrations SET certificate_fee_status='paid',updated_at=now() WHERE id=$1",[row.registration_id]);
    await db.query("UPDATE certificate_payment_attempts SET state='paid',stripe_session_id=$1 WHERE id=$2",[session.id,attempt.id]);
   }else if(row.state!=='paid'){
    const state=session.status==='expired'?'expired':failed?'failed':session.status==='complete'?'processing':'open';
    await db.query('UPDATE certificate_payment_attempts SET state=CASE WHEN state=\'failed\' AND $1=\'processing\' THEN state ELSE $1 END,stripe_session_id=$2 WHERE id=$3 AND state<>\'paid\'',[state,session.id,attempt.id]);
   }
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }
 async function status(input){
  let row=await find(input),attempt=await latest(pool,row.id);
  if(row.state!=='paid'&&attempt?.stripe_session_id&&secret){await reconcile(await stripe.retrieve(attempt.stripe_session_id));row=await find(input);attempt=await latest(pool,row.id)}
  return view(row,attempt);
 }
 async function checkout(input){
  const names=certificateNames(input);await status(input); // Reconcile any previous session before permitting another.
  const db=await pool.connect();let row,attempt;
  try{
   await db.query('BEGIN');row=await find(input,db,true);
   if(row.registration_status==='ملغى')throw fail('أُلغي تسجيل الدورة. تواصل مع الإدارة قبل طلب الشهادة.',409);
   attempt=await latest(db,row.id);
   if(row.state==='paid'){await db.query('COMMIT');return {state:'paid',paymentLink:''}}
   const active=attempt&&!['expired','failed'].includes(attempt.state)&&(attempt.stripe_session_id||new Date(attempt.expires_at).getTime()>now());
   if(active&&(row.arabic_name!==names.arabic||row.english_name!==names.english))throw fail('توجد صفحة دفع مفتوحة بهذه الأسماء. أكملها أو انتظر انتهاء صلاحيتها قبل تعديل الاسم.',409);
   row=(await db.query('UPDATE certificate_requests SET arabic_name=$1,english_name=$2,names_confirmed_at=now(),updated_at=now() WHERE id=$3 RETURNING *',[names.arabic,names.english,row.id])).rows[0];
   if(row.amount===0){await db.query("UPDATE certificate_requests SET state='no_fee' WHERE id=$1",[row.id]);await db.query('COMMIT');return {state:'no_fee',paymentLink:''}}
   const current=await find(input,db);
   if(!enabled()||!current.payment_methods?.includes('stripe'))throw fail('الدفع الإلكتروني للشهادة غير متاح حاليًا. تسجيلك في الدورة مؤكد؛ تواصل مع الإدارة لاستكمال طلب الشهادة.',503);
   if(active&&attempt.state==='processing'){await db.query('COMMIT');return {state:'processing',paymentLink:''}}
   if(!active){
    const id=crypto.randomUUID(),expiresAt=new Date(now()+23*60*60*1000),url=certificateLink(current);
    const params={mode:'payment',customer_email:current.email,client_reference_id:row.id,locale:'auto','adaptive_pricing[enabled]':'false',integration_identifier:'inexc-certificates-'+Array.from(crypto.randomBytes(8),x=>String.fromCharCode(97+x%26)).join(''),success_url:url,cancel_url:url+'&cancelled=1',expires_at:String(Math.floor(expiresAt.getTime()/1000)),
     'metadata[source]':SOURCE,'metadata[request_id]':row.id,'metadata[attempt_id]':id,'metadata[registration_id]':row.registration_id,
     'payment_intent_data[metadata][source]':SOURCE,'payment_intent_data[metadata][request_id]':row.id,
     'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'aed','line_items[0][price_data][unit_amount]':String(row.amount),
     'line_items[0][price_data][product_data][name]':current.certificate,
     'line_items[0][price_data][product_data][description]':current.course_name,
     'custom_text[submit][message]':names.arabic+' — '+names.english};
    attempt=(await db.query('INSERT INTO certificate_payment_attempts(id,request_id,params,amount,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,row.id,JSON.stringify(params),row.amount,expiresAt])).rows[0];
   }
   await db.query("UPDATE certificate_requests SET state='awaiting_payment' WHERE id=$1",[row.id]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  if(attempt.stripe_session_id)return {state:'awaiting_payment',paymentLink:attempt.checkout_url};
  const session=await stripe.create(attempt.params,'inexc-certificate-'+attempt.id);
  if(session.livemode!==live||session.amount_total!==row.amount||session.currency!=='aed'||session.client_reference_id!==row.id||!/^cs_(live|test)_/.test(session.id||'')||!String(session.url||'').startsWith('https://checkout.stripe.com/'))throw fail('تعذّر التحقق من صفحة الدفع.',503);
  await pool.query("UPDATE certificate_payment_attempts SET stripe_session_id=$1,checkout_url=$2,state=CASE WHEN state IN ('paid','processing','expired') THEN state ELSE 'open' END WHERE id=$3 AND (stripe_session_id IS NULL OR stripe_session_id=$1)",[session.id,session.url,attempt.id]);
  return {state:'awaiting_payment',paymentLink:session.url};
 }
 async function handleWebhook(event){if(event.data?.object?.metadata?.source!==SOURCE)return;if(!/^cs_(live|test)_/.test(event.data.object.id||''))throw fail('إشعار الدفع غير صالح.');await reconcile(await stripe.retrieve(event.data.object.id),event.type==='checkout.session.async_payment_failed')}

 let working=false;
 async function processEmailQueue(){
  if(working||!mailEnabled||typeof sendEmail!=='function')return;working=true;
  try{await pool.query("UPDATE certificate_requests SET email_status='failed',email_locked_until=NULL,email_error='تعذّر تأكيد إرسال الرسالة' WHERE email_status='sending' AND email_locked_until<now() AND email_attempts>=5");for(let i=0;i<10;i++){
   const claimed=(await pool.query(`UPDATE certificate_requests SET email_status='sending',email_locked_until=now()+interval '90 seconds',email_attempts=email_attempts+1
    WHERE id=(SELECT id FROM certificate_requests WHERE ((email_status='pending' AND email_due_at<=now()) OR (email_status='sending' AND email_locked_until<now())) AND email_attempts<5 ORDER BY email_due_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`)).rows[0];
   if(!claimed)break;
   try{
    const row=(await pool.query(rowSQL+' WHERE q.id=$1',[claimed.id])).rows[0];
    if(!row)continue;
    if(row.registration_status==='ملغى'||row.state==='paid'||row.state==='no_fee'||!await mailAllowed(row.email)){await pool.query("UPDATE certificate_requests SET email_status='skipped',email_locked_until=NULL WHERE id=$1",[row.id]);continue}
    const sent=await sendEmail(certificateEmail(row,emailShell));
    if(!sent?.id)throw fail('Mail provider did not acknowledge delivery.',503);
    await pool.query("UPDATE certificate_requests SET email_status='sent',email_provider_id=$1,email_sent_at=now(),email_locked_until=NULL,email_error='' WHERE id=$2",[sent.id,row.id]);
   }catch(error){
    await pool.query("UPDATE certificate_requests SET email_status=CASE WHEN email_attempts>=5 THEN 'failed' ELSE 'pending' END,email_due_at=now()+interval '3 minutes',email_locked_until=NULL,email_error=$1 WHERE id=$2",['تعذّر إرسال الرسالة؛ '+(Number(error.status)||500),claimed.id]);
    logger.error('Certificate request mail failed',{status:Number(error.status)||500});
   }
  }}catch(error){logger.error('Certificate request queue unavailable',{status:Number(error.status)||500})}finally{working=false}
 }

 const listing=`SELECT r.id AS registration_id,q.id AS request_id,r.reference,r.course_id,r.course_name,r.name,r.email,r.certificate,
  q.arabic_name,q.english_name,q.names_confirmed_at,COALESCE(q.created_at,r.created_at) AS requested_at,q.paid_at,
  CASE WHEN q.id IS NOT NULL THEN q.amount/100.0 WHEN r.certificate_fee_amount>0 THEN r.certificate_fee_amount WHEN r.total>0 THEN NULL ELSE 0 END AS certificate_amount,q.email_status,q.email_sent_at,q.email_error,
  CASE WHEN r.status='ملغى' THEN 'cancelled' WHEN q.state='paid' OR (q.id IS NULL AND r.certificate_fee_status='paid') THEN 'paid'
   WHEN q.id IS NULL AND r.total>0 AND r.payment_method IN ('stripe','bank','link') AND r.status='مؤكد' THEN 'paid'
   WHEN q.amount=0 OR (q.id IS NULL AND r.certificate_fee_amount=0 AND (r.total=0 OR r.payment_method='membership')) THEN 'no_fee' ELSE 'pending' END AS state
  FROM registrations r LEFT JOIN certificate_requests q ON q.registration_id=r.id
  WHERE r.certificate IS NOT NULL AND btrim(r.certificate) NOT IN ('','لا','غير محدد') AND COALESCE(r.request_kind,'individual')='individual'`;
 async function list(input={}){
  const courseId=clean(input.course,80),state=clean(input.state,30),search=clean(input.search,120),offset=Math.max(0,Math.min(1000000,Number.parseInt(input.offset,10)||0));
  if(courseId&&!uuid(courseId))throw fail('اختر دورة صالحة.');if(state&&!['paid','pending','no_fee','cancelled'].includes(state))throw fail('حالة الطلب غير صالحة.');
  const args=[courseId||null,state||null,search?'%'+search.replace(/[\\%_]/g,'\\$&')+'%':null],where=`($1::uuid IS NULL OR course_id=$1) AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR name ILIKE $3 OR arabic_name ILIKE $3 OR english_name ILIKE $3 OR email ILIKE $3 OR reference ILIKE $3)`;
  const result=await pool.query(`WITH requests AS (${listing}) SELECT * FROM requests WHERE ${where} ORDER BY requested_at DESC,registration_id LIMIT 50 OFFSET $4`,[...args,offset]);
  const summary=(await pool.query(`WITH requests AS (${listing}) SELECT count(*)::int AS total,count(*) FILTER(WHERE state='paid')::int AS paid,count(*) FILTER(WHERE state='pending')::int AS pending,count(*) FILTER(WHERE state='no_fee')::int AS no_fee FROM requests WHERE ${where}`,args)).rows[0];
  const courses=(await pool.query(`WITH requests AS (${listing}) SELECT course_id,course_name,count(*)::int AS total,count(*) FILTER(WHERE state='paid')::int AS paid FROM requests GROUP BY course_id,course_name ORDER BY course_name`)).rows;
  return {items:result.rows.map(r=>({...r,certificate_amount:r.certificate_amount==null?null:Number(r.certificate_amount)})),summary,courses,offset,hasMore:offset+result.rows.length<summary.total};
 }
 const limits=new Map();
 function limit(req){const key=String(req.ip||req.socket?.remoteAddress),at=now();for(const [k,v]of limits)if(v.until<at)limits.delete(k);const current=limits.get(key)||{count:0,until:at+300000};current.count++;limits.set(key,current);if(current.count>180)throw fail('محاولات كثيرة. انتظر دقائق ثم أعد المحاولة.',429)}
 const route=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});logger.error('Certificate request operation failed',{status:500});res.status(500).json({error:'تعذّر إكمال طلب الشهادة. حاول لاحقًا.'})}};
 function install(app,auth){
  app.get('/api/certificate-requests/capabilities',(_req,res)=>res.set('Cache-Control','no-store').json({version:1,deferredFreeCourse:true,emailDelayMinutes:3,electronicEnabled:enabled(),emailEnabled:mailEnabled}));
  app.post('/api/certificate-requests/status',route(async(req,res)=>{limit(req);res.json(await status(req.body||{}))}));
  app.post('/api/certificate-requests/checkout',route(async(req,res)=>{limit(req);res.json(await checkout(req.body||{}))}));
  app.get('/api/admin/certificate-requests',auth,route(async(req,res)=>res.json(await list(req.query))));
  app.get('/api/admin/certificate-requests/:id/link',auth,route(async(req,res)=>{
   if(!uuid(req.params.id))throw fail('طلب الشهادة غير موجود.',404);
   const row=(await pool.query(rowSQL+' WHERE q.id=$1',[req.params.id])).rows[0];if(!row)throw fail('طلب الشهادة غير موجود.',404);
   res.json({url:certificateLink(row)});
  }));
 }
 return {install,status,checkout,reconcile,handleWebhook,processEmailQueue,list};
}
