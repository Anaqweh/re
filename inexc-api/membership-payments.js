function trainingPackageText(value){return String(value??'').replaceAll('بطاق','باق');}
// Membership purchases are isolated from course registration and course payment settings.
import crypto from 'node:crypto';
import {amountInFils as cents,stripeClient} from './stripe-payments.js';
const SOURCE='inexc-membership-v1',SITE='https://www.inexctraining.com';
const uuid=v=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v||''));
const text=(v,max=200)=>String(v??'').trim().slice(0,max);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const occupied="('مفعلة','بانتظار مراجعة الدفع','بانتظار الدفع')";
export async function setupMembershipPayments(pool){
 const db=await pool.connect();try{
  await db.query('BEGIN');
  await db.query("ALTER TABLE membership_orders DROP CONSTRAINT IF EXISTS membership_orders_payment_method_check");
  await db.query("ALTER TABLE membership_orders ADD CONSTRAINT membership_orders_payment_method_check CHECK(payment_method IN ('bank','link','stripe','free'))");
  await db.query('ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS request_key UUID');
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS membership_order_request_unique ON membership_orders(request_key)');
  await db.query(`CREATE TABLE IF NOT EXISTS membership_stripe_checkouts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_key UUID UNIQUE NOT NULL,request_hash TEXT NOT NULL,order_id UUID UNIQUE REFERENCES membership_orders(id),amount INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'usd',params JSONB,plan_snapshot JSONB,stripe_session_id TEXT UNIQUE,checkout_url TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'creating',payment_intent TEXT NOT NULL DEFAULT '',paid_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS membership_stripe_intent_unique ON membership_stripe_checkouts(payment_intent) WHERE payment_intent<>''");
  await db.query('CREATE TABLE IF NOT EXISTS membership_payment_migrations(id TEXT PRIMARY KEY,before_methods JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const inserted=await db.query("INSERT INTO membership_payment_migrations(id,before_methods) SELECT 'electronic-and-bank-v1',COALESCE(jsonb_agg(jsonb_build_object('id',id,'paymentMethods',payment_methods)),'[]'::jsonb) FROM membership_plans ON CONFLICT(id) DO NOTHING RETURNING id");
  if(inserted.rows.length)await db.query("UPDATE membership_plans SET payment_methods=ARRAY['stripe','bank'],updated_at=now()");
  await db.query("ALTER TABLE membership_plans ALTER COLUMN payment_methods SET DEFAULT ARRAY['stripe','bank']::text[]");
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
export async function membershipBank(db){
 const result=await db.query("SELECT bank_name,bank_account,bank_iban FROM courses WHERE active=true AND (bank_account<>'' OR bank_iban<>'') ORDER BY updated_at DESC,id");
 // A shared account is required; do not choose arbitrarily between different course accounts.
 const accounts=new Set(result.rows.map(row=>JSON.stringify([row.bank_account,row.bank_iban])));
 const row=accounts.size===1?result.rows[0]:{},parts=(row.bank_name||'').match(/^اسم البنك:\s*(.*?)\s*\|\s*صاحب الحساب:\s*(.*)$/);
 return {title:parts?.[1]||'',name:parts?.[2]==='—'?'':parts?.[2]||row.bank_name||'',account:row.bank_account||'',iban:row.bank_iban||''};
}
// Caller owns one transaction connection, including payment confirmation and card issuance.
export async function issueMembershipCard(db,orderId,snapshot){
 const order=(await db.query('SELECT * FROM membership_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
 if(!order)throw fail('طلب الباقة غير موجود.',404);
 if(order.card_id)return {created:false,card:(await db.query('SELECT * FROM membership_cards WHERE id=$1',[order.card_id])).rows[0]};
 if(order.status==='مرفوض'||!order.verified_at||!order.verified_reference)throw fail('لا يمكن إصدار البطاقة قبل تأكيد الدفع.');
 const plan=snapshot||(await db.query('SELECT * FROM membership_plans WHERE id=$1',[order.plan_id])).rows[0];
 const prefix=plan.slug==='leadership'?'RD':plan.slug==='mastery'?'TM':'IN';
 const cardNumber='INX-'+prefix+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
 const card=(await db.query(`INSERT INTO membership_cards(card_number,access_token,plan_id,order_id,holder_name,holder_email,holder_phone,units_total,units_remaining,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,now()+($9::text||' months')::interval) RETURNING *`,[cardNumber,crypto.randomBytes(24).toString('hex'),order.plan_id,order.id,order.name,order.email,order.phone,plan.booking_units,plan.valid_months])).rows[0];
 await db.query("UPDATE membership_orders SET card_id=$1,status='مفعلة',updated_at=now() WHERE id=$2",[card.id,order.id]);
 return {created:true,card};
}
export function createMembershipPayments({pool,env=process.env,client,notify=()=>{},now=()=>Date.now()}){
 const secret=text(env.STRIPE_SECRET_KEY,300),live=/^(rk|sk)_live_/.test(secret),stripe=client||stripeClient(secret);
 const enabled=()=>env.STRIPE_CHECKOUT_ENABLED==='1'&&live&&String(env.STRIPE_WEBHOOK_SECRET||'').startsWith('whsec_');
 const nextUrl=row=>SITE+'/cards/payment-status.html#checkout='+row.id+'&token='+row.request_key;
 const identity=input=>{const data={name:text(input.name,150),email:text(input.email,180).toLowerCase(),phone:text(input.phone,50),planId:text(input.plan_id,80)};if(!uuid(data.planId)||!data.name||!data.phone||!/^\S+@\S+\.\S+$/.test(data.email))throw fail('أكمل الاسم والبريد الإلكتروني والهاتف، واختر باقة متاحة.');return data};
 async function stock(db,plan,except){const count=(await db.query(`SELECT count(*)::int AS n FROM membership_orders WHERE plan_id=$1 AND status IN ${occupied} AND ($2::uuid IS NULL OR id<>$2)`,[plan.id,except||null])).rows[0].n;if(count>=Number(plan.max_cards))throw fail('نفدت هذه الفئة من الباقات.',409)}
 const send=async issued=>{if(issued?.created){try{await notify(issued.card)}catch{/* The issued card remains available through the private status page and card recovery. */}}};
 async function options(){const bank=await membershipBank(pool);return {version:1,electronicEnabled:enabled(),currency:'USD',bank,bankConfigured:!!(bank.account||bank.iban)}}
 async function offlineOrder(input,receiptPath){
  const data=identity(input),method=text(input.payment_method,20),key=input.request_key||crypto.randomUUID();if(!uuid(key)||!['bank','link'].includes(method))throw fail('اختر طريقة دفع صالحة.');
  const db=await pool.connect();try{
   await db.query('BEGIN');const plan=(await db.query('SELECT * FROM membership_plans WHERE id=$1 AND active=true FOR UPDATE',[data.planId])).rows[0];
   if(!plan||!plan.payment_methods?.includes(method))throw fail('طريقة الدفع غير متاحة لهذه الباقة.');
   const prior=(await db.query('SELECT * FROM membership_orders WHERE request_key=$1',[key])).rows[0];
   if(prior){if(prior.plan_id!==data.planId||prior.email!==data.email||prior.name!==data.name||prior.phone!==data.phone||prior.payment_method!==method)throw fail('تغيّرت بيانات الطلب. أعد المحاولة.',409);await db.query('COMMIT');return {ok:true,reference:prior.reference,status:prior.status,orderId:prior.id,paymentLink:method==='link'?plan.payment_link:''}}
   if(method==='bank'){const bank=await membershipBank(db);if(!bank.account&&!bank.iban)throw fail('بيانات التحويل البنكي غير جاهزة. اختر الدفع الإلكتروني.',503);if(!receiptPath)throw fail('يرجى رفع وصل التحويل البنكي.');}
   if(method==='link'&&!/^https:\/\//.test(plan.payment_link||''))throw fail('رابط الدفع غير متاح.');
   await stock(db,plan);const reference='CARD-'+crypto.randomBytes(9).toString('hex').toUpperCase(),status=method==='bank'?'بانتظار مراجعة الدفع':'بانتظار الدفع';
   const row=(await db.query('INSERT INTO membership_orders(reference,plan_id,name,email,phone,total,payment_method,status,receipt_path,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[reference,plan.id,data.name,data.email,data.phone,plan.price_usd,method,status,receiptPath||'',key])).rows[0];
   await db.query('COMMIT');return {ok:true,reference,status,orderId:row.id,paymentLink:method==='link'?plan.payment_link:''};
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 async function freeOrder(input){
  const data=identity(input),key=text(input.request_key,80);
  if(!uuid(key))throw fail('أعد فتح طلب الباقة المجانية ثم حاول مجددًا.');
  const db=await pool.connect();let issued,reference;
  try{
   await db.query('BEGIN');
   const plan=(await db.query('SELECT * FROM membership_plans WHERE id=$1 AND active=true FOR UPDATE',[data.planId])).rows[0];
   if(!plan||Number(plan.price_usd)!==0)throw fail('هذه الباقة غير متاحة للتسجيل المجاني.');
   const prior=(await db.query('SELECT * FROM membership_orders WHERE request_key=$1',[key])).rows[0];
   if(prior){if(prior.plan_id!==data.planId||prior.email!==data.email||prior.name!==data.name||prior.phone!==data.phone||prior.payment_method!=='free')throw fail('تغيّرت بيانات طلبك. أعد المحاولة.',409);await db.query('COMMIT');return {ok:false,alreadyRegistered:true,message:'أنت مشترك مسبقًا في هذه الباقة. استخدم رقم بطاقتك لحجز دورة متاحة، أو اطلب إرسال الرقم مرة أخرى إلى بريدك.'}}
   const existing=(await db.query("SELECT o.reference FROM membership_orders o JOIN membership_cards c ON c.id=o.card_id WHERE o.plan_id=$1 AND lower(o.email)=$2 AND o.payment_method='free' AND o.status='مفعلة' AND c.deleted_at IS NULL LIMIT 1",[plan.id,data.email])).rows[0];
   if(existing){await db.query('COMMIT');return {ok:false,alreadyRegistered:true,message:'أنت مشترك مسبقًا في هذه الباقة. استخدم رقم بطاقتك لحجز دورة متاحة، أو اطلب إرسال الرقم مرة أخرى إلى بريدك.'}}
   await stock(db,plan);
   reference='CARD-'+crypto.randomBytes(9).toString('hex').toUpperCase();
   const row=(await db.query("INSERT INTO membership_orders(reference,plan_id,name,email,phone,total,payment_method,status,request_key,verified_reference,verified_amount,verified_currency,verified_at) VALUES($1,$2,$3,$4,$5,0,'free','مفعلة',$6,$7,0,'USD',now()) RETURNING id",[reference,plan.id,data.name,data.email,data.phone,key,'FREE-'+reference])).rows[0];
   issued=await issueMembershipCard(db,row.id,plan);
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  await send(issued);
  return {ok:true,reference,email:data.email};
 }
 async function checkout(input){
  if(!enabled())throw fail('الدفع الإلكتروني غير متاح حاليًا. اختر التحويل البنكي.',503);
  const data=identity(input),key=text(input.request_key,80);if(!uuid(key))throw fail('أعد فتح طلب الباقة ثم حاول مجددًا.');
  const hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');const db=await pool.connect();let row;
  try{
   await db.query('BEGIN');row=(await db.query('INSERT INTO membership_stripe_checkouts(request_key,request_hash) VALUES($1,$2) ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',[key,hash])).rows[0];
   if(row.request_hash!==hash)throw fail('تغيّرت بيانات الطلب. أعد بدء الدفع.',409);
   const plan=(await db.query('SELECT * FROM membership_plans WHERE id=$1 AND active=true FOR UPDATE',[data.planId])).rows[0];
   if(!plan||!plan.payment_methods?.includes('stripe'))throw fail('الدفع الإلكتروني غير متاح لهذه الباقة.');
   if(row.order_id){const order=(await db.query('SELECT * FROM membership_orders WHERE id=$1 FOR UPDATE',[row.order_id])).rows[0];if(order.status==='مرفوض')throw fail('هذا الطلب مرفوض. تواصل مع الإدارة.',409);}
   if(row.state!=='paid'){
    if(row.state==='expired'||(row.params&&Number(row.params.expires_at)*1000<=now()))throw fail('انتهت مهلة الدفع. أعد المحاولة لإنشاء صفحة جديدة.',410);
    await stock(db,plan,row.order_id);
   }
   if(!row.params){
    const amount=cents(plan.price_usd);if(amount<50||amount>99999999)throw fail('تعذّر تحديد مبلغ الدفع لهذه الباقة. تواصل مع الإدارة.');
    const order=(await db.query("INSERT INTO membership_orders(reference,plan_id,name,email,phone,total,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,'stripe','بانتظار الدفع') RETURNING id",['CARD-'+crypto.randomBytes(9).toString('hex').toUpperCase(),plan.id,data.name,data.email,data.phone,plan.price_usd])).rows[0];
    const params={mode:'payment',customer_email:data.email,client_reference_id:order.id,locale:'auto','adaptive_pricing[enabled]':'false',integration_identifier:'inexc-membership-'+Array.from(crypto.randomBytes(8),x=>String.fromCharCode(97+x%26)).join(''),success_url:nextUrl(row),cancel_url:nextUrl(row)+'&cancelled=1',expires_at:String(Math.floor(now()/1000)+3600),'metadata[source]':SOURCE,'metadata[checkout_id]':row.id,'metadata[order_id]':order.id,'payment_intent_data[metadata][source]':SOURCE,'payment_intent_data[metadata][order_id]':order.id,'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(amount),'line_items[0][price_data][product_data][name]':trainingPackageText(plan.name)};
    const snapshot={name:trainingPackageText(plan.name),slug:plan.slug,booking_units:plan.booking_units,valid_months:plan.valid_months};
    row=(await db.query('UPDATE membership_stripe_checkouts SET order_id=$1,amount=$2,params=$3,plan_snapshot=$4 WHERE id=$5 RETURNING *',[order.id,amount,JSON.stringify(params),JSON.stringify(snapshot),row.id])).rows[0];
   }else if(row.state==='creating'){await db.query("UPDATE membership_orders SET status='بانتظار الدفع',updated_at=now() WHERE id=$1 AND status='تعذّر تجهيز الدفع'",[row.order_id]);}
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  if(row.state==='paid')return {paymentLink:nextUrl(row),checkoutId:row.id};
  if(row.stripe_session_id)return {paymentLink:row.checkout_url,checkoutId:row.id};
  let session;try{session=await stripe.create(row.params,'inexc-membership-'+row.id)}catch(error){
   if([400,401,403].includes(error.stripeDiagnostic?.httpStatus))await pool.query("UPDATE membership_orders SET status='تعذّر تجهيز الدفع',updated_at=now() WHERE id=$1 AND status='بانتظار الدفع' AND EXISTS(SELECT 1 FROM membership_stripe_checkouts WHERE id=$2 AND state='creating' AND stripe_session_id IS NULL)",[row.order_id,row.id]);throw error;
  }
  if(session.livemode!==live||session.amount_total!==row.amount||session.currency!=='usd'||session.client_reference_id!==row.order_id||!/^cs_live_/.test(session.id||'')||!String(session.url||'').startsWith('https://checkout.stripe.com/'))throw fail('تعذّر التحقق من صفحة الدفع.',503);
  await pool.query("UPDATE membership_stripe_checkouts SET stripe_session_id=$1,checkout_url=$2,state=CASE WHEN state='paid' THEN state ELSE 'open' END,updated_at=now() WHERE id=$3 AND (stripe_session_id IS NULL OR stripe_session_id=$1)",[session.id,session.url,row.id]);
  return {paymentLink:session.url,checkoutId:row.id};
 }
 async function reconcile(session,eventType=''){
  const meta=session.metadata||{};if(meta.source!==SOURCE||!uuid(meta.checkout_id))return;
  const db=await pool.connect();let issued;
  try{
   await db.query('BEGIN');const row=(await db.query('SELECT * FROM membership_stripe_checkouts WHERE id=$1 FOR UPDATE',[meta.checkout_id])).rows[0];
   if(!row){await db.query('COMMIT');return;}
   if(session.livemode!==live||session.mode!=='payment'||session.currency!=='usd'||session.amount_total!==row.amount||session.client_reference_id!==row.order_id||meta.order_id!==row.order_id||(row.stripe_session_id&&row.stripe_session_id!==session.id))throw fail('تعذّر مطابقة تفاصيل الدفع.',409);
   const order=(await db.query('SELECT * FROM membership_orders WHERE id=$1 FOR UPDATE',[row.order_id])).rows[0];
   if(session.payment_status==='paid'){
    const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;if(!/^pi_/.test(intent||''))throw fail('تعذّر مطابقة رقم العملية.',409);
    await db.query("UPDATE membership_stripe_checkouts SET state='paid',stripe_session_id=$1,payment_intent=$2,paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE id=$3",[session.id,intent,row.id]);
    await db.query("UPDATE membership_orders SET verified_reference=$1,verified_amount=total,verified_currency='USD',verified_at=COALESCE(verified_at,now()),updated_at=now() WHERE id=$2",[intent,order.id]);
    if(order.status!=='مرفوض')issued=await issueMembershipCard(db,order.id,row.plan_snapshot);
   }else if(row.state!=='paid'&&(session.status==='expired'||eventType==='checkout.session.async_payment_failed')){
    await db.query("UPDATE membership_stripe_checkouts SET state='expired',stripe_session_id=$1,updated_at=now() WHERE id=$2",[session.id,row.id]);
    await db.query("UPDATE membership_orders SET status=$1,updated_at=now() WHERE id=$2 AND card_id IS NULL AND status='بانتظار الدفع'",[session.status==='expired'?'انتهت مهلة الدفع':'لم يكتمل الدفع',order.id]);
   }
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  await send(issued);
 }
 async function handleWebhook(event){
  if(event.data?.object?.metadata?.source!==SOURCE)return;
  if(!/^evt_/.test(event.id||'')||!/^cs_live_/.test(event.data.object.id||''))throw fail('إشعار الدفع غير صالح.');
  await reconcile(await stripe.retrieve(event.data.object.id),event.type);
 }
 async function status(input){
  if(!uuid(input.checkout)||!uuid(input.token))throw fail('رابط متابعة الدفع غير صالح.',404);
  let row=(await pool.query('SELECT * FROM membership_stripe_checkouts WHERE id=$1 AND request_key=$2',[input.checkout,input.token])).rows[0];if(!row)throw fail('لم نجد عملية دفع مطابقة.',404);
  if(row.state!=='paid'&&row.stripe_session_id){await reconcile(await stripe.retrieve(row.stripe_session_id));row=(await pool.query('SELECT * FROM membership_stripe_checkouts WHERE id=$1',[row.id])).rows[0];}
  const order=(await pool.query('SELECT o.*,c.card_number,c.access_token FROM membership_orders o LEFT JOIN membership_cards c ON c.id=o.card_id WHERE o.id=$1',[row.order_id])).rows[0];
  return {state:row.state,amount:row.amount/100,currency:'USD',reference:order.reference,planName:trainingPackageText(row.plan_snapshot.name),orderStatus:order.status,paymentLink:row.state==='open'&&Number(row.params.expires_at)*1000>now()?row.checkout_url:'',cardNumber:order.card_number||'',cardUrl:order.access_token?SITE+'/my-card/?token='+order.access_token:''};
 }
 async function review(orderId){
  if(!uuid(orderId))throw fail('الطلب غير صالح.');const row=(await pool.query('SELECT * FROM membership_stripe_checkouts WHERE order_id=$1',[orderId])).rows[0];
  if(!row?.stripe_session_id)throw fail('لم تُنشأ صفحة دفع لهذا الطلب بعد.');await reconcile(await stripe.retrieve(row.stripe_session_id));return {ok:true};
 }
 async function approveOffline(orderId,input){
  const db=await pool.connect();let issued;try{
   await db.query('BEGIN');const order=(await db.query('SELECT * FROM membership_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];if(!order)throw fail('الطلب غير موجود.',404);
   if(order.card_id){await db.query('COMMIT');return {ok:true,alreadyActive:true}}
   if(order.payment_method==='stripe')throw fail('الدفع الإلكتروني يُؤكّد تلقائيًا. اضغط تحديث حالة الدفع.');
   if(order.status==='مرفوض')throw fail('لا يمكن اعتماد طلب مرفوض.');
   const reference=text(input.verifiedReference,120),amount=Number(input.verifiedAmount),currency=text(input.verifiedCurrency,3).toUpperCase();
   if(input.confirmedFromBank!==true||reference.length<4||!Number.isFinite(amount)||amount<=0||!['USD','AED'].includes(currency)||(currency==='USD'&&amount!==Number(order.total)))throw fail('طابق العملية في كشف البنك ثم أدخل رقم العملية والمبلغ الصحيح وأكّد المطابقة.');
   await db.query('UPDATE membership_orders SET verified_reference=$1,verified_amount=$2,verified_currency=$3,verified_at=now(),updated_at=now() WHERE id=$4',[reference,amount,currency,order.id]);issued=await issueMembershipCard(db,order.id);await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  await send(issued);return {ok:true,cardNumber:issued.card.card_number,email:issued.card.holder_email};
 }
 const limits=new Map();function limited(req,scope,max){const at=now(),key=scope+':'+(req.ip||req.socket?.remoteAddress||'unknown');for(const [k,v]of limits)if(v.until<at)limits.delete(k);const current=limits.get(key)||{until:at+300000,count:0};current.count++;limits.set(key,current);if(current.count>max)throw fail('طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.',429)}
 const route=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(error){res.status([400,404,409,410,429,503].includes(error.status)?error.status:500).json({error:error.status?error.message:'تعذّر إتمام الطلب. أعد المحاولة.'})}};
 function install(app,auth){
  app.get('/api/memberships/payment-options',route(()=>options()));
  app.post('/api/memberships/checkout',route(req=>{limited(req,'checkout',60);return checkout(req.body||{})}));
  app.post('/api/memberships/free',route(req=>{limited(req,'free',20);return freeOrder(req.body||{})}));
  app.post('/api/memberships/payment-status',route(req=>{limited(req,'status',180);return status(req.body||{})}));
  app.post('/api/admin/memberships/orders/:id/refresh-payment',auth,route(req=>review(req.params.id)));
 }
 return {options,checkout,freeOrder,offlineOrder,reconcile,handleWebhook,status,review,approveOffline,install};
}
