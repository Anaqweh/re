// Stripe-hosted Checkout for the current PostgreSQL registration system.
// Prices come from courses, payment is confirmed server-to-server, and retries reuse one session.
import crypto from 'node:crypto';
import express from 'express';

const SITE='https://www.inexctraining.com';
const SOURCE='inexc-courses-v1';
const uuid=value=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(value||''));
const text=(value,max=200)=>String(value??'').trim().slice(0,max);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function amountInFils(value){
 const match=String(value??'').match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
 if(!match)throw fail('تعذّر تحديد مبلغ الدفع. تواصل مع الإدارة.');
 return Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
}

export async function setupStripePayments(db){
 await db.query(`CREATE TABLE IF NOT EXISTS stripe_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_key UUID UNIQUE NOT NULL,
  request_hash TEXT NOT NULL, registration_id UUID UNIQUE REFERENCES registrations(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'aed',
  params JSONB, stripe_session_id TEXT UNIQUE, checkout_url TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'creating', payment_intent TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS stripe_checkout_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db.query("CREATE UNIQUE INDEX IF NOT EXISTS stripe_checkout_payment_unique ON stripe_checkouts(payment_intent) WHERE payment_intent<>''");
}

export function verifyStripeEvent(raw,signature,secret,now=Date.now()){
 if(!secret||!Buffer.isBuffer(raw))throw fail('توقيع الدفع غير صالح.',400);
 const parts=String(signature||'').split(',').map(part=>part.trim().split('='));
 const timestamp=parts.find(([key])=>key==='t')?.[1];
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)throw fail('توقيع الدفع غير صالح.',400);
 const expected=crypto.createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
 if(!parts.some(([key,value])=>key==='v1'&&/^[a-f\d]{64}$/.test(value||'')&&crypto.timingSafeEqual(expected,Buffer.from(value,'hex'))))throw fail('توقيع الدفع غير صالح.',400);
 try{return JSON.parse(raw.toString('utf8'))}catch{throw fail('إشعار الدفع غير صالح.',400)}
}

// Standard Stripe REST API; no secrets or provider responses are logged or returned to visitors.
export function stripeClient(secret,fetcher=fetch){
 async function request(route,{params,key}={}){
  const response=await fetcher('https://api.stripe.com/v1/'+route,{
   method:params?'POST':'GET',signal:AbortSignal.timeout(20000),
   headers:{Authorization:'Bearer '+secret,'Stripe-Version':'2023-10-16',...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},
   ...(params?{body:new URLSearchParams(params).toString()}:{}),
  }).catch(()=>{throw fail('تعذّر الاتصال بالدفع الآن. حاول مجددًا؛ لن ننشئ عملية دفع مكررة.',503)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data)throw fail('تعذّر تجهيز الدفع عبر Stripe. حاول مجددًا أو استخدم التحويل البنكي.',503);
  return data;
 }
 return {create:(params,key)=>request('checkout/sessions',{params,key}),retrieve:id=>request('checkout/sessions/'+encodeURIComponent(id)+'?expand[]=line_items')};
}

export function createStripePayments({pool,env=process.env,client,notify=()=>{},now=()=>Date.now()}){
 const secret=text(env.STRIPE_SECRET_KEY,300),webhookSecret=text(env.STRIPE_WEBHOOK_SECRET,300);
 const live=/^(sk|rk)_live_/.test(secret);
 const enabled=()=>env.STRIPE_CHECKOUT_ENABLED==='1'&&live&&webhookSecret.startsWith('whsec_');
 const stripe=client||stripeClient(secret);
 const nextUrl=row=>SITE+'/payment-status.html#checkout='+row.id+'&token='+row.request_key;
 const asyncRoute=fn=>async(req,res)=>{try{await fn(req,res)}catch(error){res.status([400,404,409,410,429,503].includes(error.status)?error.status:500).json({error:error.status?error.message:'تعذّر إتمام عملية الدفع. حاول مجددًا.'})}};
 const limits=new Map();
 function rateLimit(req,scope,max){
  const key=scope+':'+(req.ip||req.socket?.remoteAddress||'unknown'),at=now();
  for(const [key,value] of limits)if(value.until<at)limits.delete(key);
  const current=limits.get(key)||{until:at+300000,count:0};current.count++;limits.set(key,current);
  if(current.count>max)throw fail('طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.',429);
 }

 async function checkout(input){
  if(!enabled())throw fail('الدفع عبر Stripe غير مفعّل حاليًا. اختر التحويل البنكي أو بطاقة INEXC.',503);
  const data={name:text(input.name,150),email:text(input.email,180).toLowerCase(),phone:text(input.phone,50),courseId:text(input.course_id,80),certificate:input.certificate==='yes'};
  const key=text(input.request_key,80);
  if(!uuid(key)||!uuid(data.courseId)||!data.name||!data.phone||!/^\S+@\S+\.\S+$/.test(data.email))throw fail('أكمل بيانات التسجيل والدورة والبريد الإلكتروني.');
  const fingerprint=digest(JSON.stringify(data));
  const db=await pool.connect();let row;
  try{
   await db.query('BEGIN');
   row=(await db.query(`INSERT INTO stripe_checkouts(request_key,request_hash) VALUES($1,$2)
    ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *`,[key,fingerprint])).rows[0];
   if(row.request_hash!==fingerprint)throw fail('تغيّرت بيانات التسجيل. أعد بدء عملية الدفع.',409);
   if(!row.params){
    const course=(await db.query('SELECT * FROM courses WHERE id=$1 AND active=true FOR SHARE',[data.courseId])).rows[0];
    if(!course)throw fail('الدورة غير متاحة للتسجيل.');
    if(course.public_booking_opens_at&&new Date(course.public_booking_opens_at).getTime()>now())throw fail('التسجيل العام لهذه الدورة لم يبدأ بعد.');
    const base=amountInFils(course.price),cert=course.certificate_mode==='optional'&&data.certificate?amountInFils(course.certificate_price):0,total=base+cert;
    if(total<=0||total>99999999)throw fail('استخدم التسجيل المجاني لهذه الدورة أو راجع الإدارة بشأن المبلغ.');
    const reference='INX-'+crypto.randomBytes(9).toString('hex').toUpperCase();
    const certificate=course.certificate_mode==='included'||(course.certificate_mode==='optional'&&data.certificate)?course.certificate_name:'لا';
    const registration=(await db.query(`INSERT INTO registrations(reference,name,email,phone,course_id,course_name,certificate,total,payment_method,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'stripe','بانتظار الدفع') RETURNING id`,[reference,data.name,data.email,data.phone,course.id,course.name,certificate,(total/100).toFixed(2)])).rows[0];
    const params={mode:'payment',customer_email:data.email,client_reference_id:registration.id,'payment_method_types[0]':'card',locale:'auto',
     success_url:nextUrl(row),cancel_url:nextUrl(row)+'&cancelled=1',expires_at:String(Math.floor(now()/1000)+3600),
     'metadata[source]':SOURCE,'metadata[checkout_id]':row.id,'metadata[registration_id]':registration.id,
     'payment_intent_data[metadata][source]':SOURCE,'payment_intent_data[metadata][registration_id]':registration.id};
    let index=0;for(const [name,amount] of [[course.name,base],[course.certificate_name||'الشهادة الاختيارية',cert]])if(amount>0){
     params[`line_items[${index}][quantity]`]='1';params[`line_items[${index}][price_data][currency]`]='aed';
     params[`line_items[${index}][price_data][unit_amount]`]=String(amount);params[`line_items[${index}][price_data][product_data][name]`]=name;index++;
    }
    row=(await db.query('UPDATE stripe_checkouts SET registration_id=$1,amount=$2,params=$3 WHERE id=$4 RETURNING *',[registration.id,total,JSON.stringify(params),row.id])).rows[0];
   }
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  if(row.state==='paid')return {paymentLink:nextUrl(row),checkoutId:row.id};
  if(row.state==='expired'||Number(row.params.expires_at)*1000<=now())throw fail('انتهت مهلة الدفع السابقة. أعد الضغط لبدء عملية جديدة.',410);
  if(row.stripe_session_id)return {paymentLink:row.checkout_url,checkoutId:row.id};
  // The reservation above persists BEFORE Stripe is contacted. A lost response can safely retry.
  const session=await stripe.create(row.params,'inexc-course-'+row.id);
  if(session.livemode!==live||session.amount_total!==row.amount||session.currency!==row.currency||session.client_reference_id!==row.registration_id||!/^cs_(live|test)_/.test(session.id||'')||!String(session.url||'').startsWith('https://checkout.stripe.com/'))throw fail('تعذّر التحقق من صفحة الدفع.',503);
  await pool.query(`UPDATE stripe_checkouts SET stripe_session_id=$1,checkout_url=$2,state=CASE WHEN state='paid' THEN state ELSE 'open' END,updated_at=now()
   WHERE id=$3 AND (stripe_session_id IS NULL OR stripe_session_id=$1)`,[session.id,session.url,row.id]);
  return {paymentLink:session.url,checkoutId:row.id};
 }

 async function reconcile(session,eventId){
  const meta=session.metadata||{};
  if(meta.source!==SOURCE||!uuid(meta.checkout_id))return;
  const db=await pool.connect();let notification;
  try{
   await db.query('BEGIN');
   const row=(await db.query('SELECT * FROM stripe_checkouts WHERE id=$1 FOR UPDATE',[meta.checkout_id])).rows[0];
   if(!row){await db.query('COMMIT');return}
   if(session.livemode!==live||session.mode!=='payment'||session.currency!==row.currency||session.amount_total!==row.amount||session.client_reference_id!==row.registration_id||meta.registration_id!==row.registration_id||(row.stripe_session_id&&row.stripe_session_id!==session.id))throw fail('تعذّر مطابقة تفاصيل الدفع.',409);
   const paid=session.payment_status==='paid';
   if(paid&&row.state!=='paid'){
    const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
    if(!intent)throw fail('تعذّر مطابقة عملية الدفع.',409);
    await db.query("UPDATE stripe_checkouts SET state='paid',stripe_session_id=$1,payment_intent=$2,paid_at=now(),updated_at=now() WHERE id=$3",[session.id,intent,row.id]);
    // Keep an administrator's cancellation intact; the payment record still records the receipt.
    const saved=await db.query("UPDATE registrations SET status='مؤكد',updated_at=now() WHERE id=$1 AND status<>'ملغى' RETURNING *",[row.registration_id]);
    if(saved.rows[0]){const r=saved.rows[0];notification={paymentMethod:'stripe',reference:r.reference,name:r.name,email:r.email,phone:r.phone,courseName:r.course_name,total:Number(r.total),status:'مؤكد — تم الدفع عبر Stripe'};}
   }else if(!paid&&session.status==='expired'&&row.state!=='paid'){
    await db.query("UPDATE stripe_checkouts SET state='expired',updated_at=now() WHERE id=$1",[row.id]);
   }
   if(eventId)await db.query('INSERT INTO stripe_checkout_events(id,session_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[eventId,session.id]);
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  if(notification){try{await notify(notification)}catch{/* Payment stays confirmed even if a notification is unavailable. */}}
 }

 async function status(input){
  if(!uuid(input.checkout)||!uuid(input.token))throw fail('رابط متابعة الدفع غير صالح.',404);
  let row=(await pool.query('SELECT * FROM stripe_checkouts WHERE id=$1 AND request_key=$2',[input.checkout,input.token])).rows[0];
  if(!row)throw fail('لم نجد عملية دفع مطابقة لهذا الرابط.',404);
  if(row.state!=='paid'&&row.stripe_session_id&&secret){await reconcile(await stripe.retrieve(row.stripe_session_id));row=(await pool.query('SELECT * FROM stripe_checkouts WHERE id=$1',[row.id])).rows[0];}
  const registration=(await pool.query('SELECT reference,course_name,status FROM registrations WHERE id=$1',[row.registration_id])).rows[0];
  return {state:row.state,amount:row.amount/100,currency:'AED',reference:registration?.reference||'',courseName:registration?.course_name||'',registrationStatus:registration?.status||'',paymentLink:row.state==='open'&&Number(row.params.expires_at)*1000>now()?row.checkout_url:''};
 }

 function installWebhook(app){
  app.post('/api/payments/stripe/webhook',express.raw({type:'application/json',limit:'1mb'}),asyncRoute(async(req,res)=>{
   if(!secret||!webhookSecret)throw fail('خدمة الدفع غير مهيأة.',503);
   const event=verifyStripeEvent(req.body,req.headers['stripe-signature'],webhookSecret,now());
   if(event.livemode!==live)throw fail('وضع الدفع غير مطابق.',400);
   const accepted=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'];
   if(accepted.includes(event.type)&&event.data?.object?.metadata?.source===SOURCE){
    if(!/^evt_/.test(event.id||'')||!/^cs_(live|test)_/.test(event.data.object.id||''))throw fail('إشعار الدفع غير صالح.');
    const existing=await pool.query('SELECT id FROM stripe_checkout_events WHERE id=$1',[event.id]);
    if(!existing.rows.length)await reconcile(await stripe.retrieve(event.data.object.id),event.id);
   }
   res.json({received:true});
  }));
 }
 function installRoutes(app){
  app.get('/api/payments/stripe/capabilities',(_req,res)=>res.set('Cache-Control','no-store').json({version:1,enabled:enabled(),currency:'AED'}));
  app.post('/api/payments/stripe/checkout',asyncRoute(async(req,res)=>{rateLimit(req,'checkout',120);res.set('Cache-Control','no-store').status(201).json(await checkout(req.body||{}))}));
  app.post('/api/payments/stripe/status',asyncRoute(async(req,res)=>{rateLimit(req,'status',180);res.set('Cache-Control','no-store').json(await status(req.body||{}))}));
 }
 return {enabled,checkout,status,reconcile,installWebhook,installRoutes};
}
