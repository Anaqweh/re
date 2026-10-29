// Course card offers with server-generated Stripe Payment Links. No email is sent.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {STRIPE_API_VERSION} from './stripe-payments.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=v=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v));
export function safeCardUrl(value){
 const text=String(value??'').trim();if(!text)return '';
 try{const u=new URL(text);if(u.protocol!=='https:'||u.username||u.password||text.length>2000)throw Error();return u.href;}catch{throw fail('استخدم رابط HTTPS كاملًا وصحيحًا دون بيانات دخول.');}
}
export function cardOfferInput(body){
 const name=String(body.name??'').trim();const description=String(body.description??'').trim();
 const price=Number(body.price);if(!name||name.length>180||description.length>2000)throw fail('أدخل اسم البطاقة ووصفًا لا يتجاوز 2000 حرف.');
 if(body.price===''||body.price==null||!Number.isFinite(price)||price<=0||price>999999||Math.abs(price*100-Math.round(price*100))>0.00001)throw fail('أدخل سعرًا موجبًا بحد أقصى منزلتين عشريتين.');
 const paymentUrl=safeCardUrl(body.paymentUrl),sampleUrl=safeCardUrl(body.sampleUrl);
 return {name,description,price,paymentUrl,sampleUrl,enabled:body.enabled===true};
}
export async function setupBoardCardOffers(db){await db.query(`CREATE TABLE IF NOT EXISTS board_card_offers (
 course_id UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
 name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',price NUMERIC(10,2) NOT NULL CHECK(price>0),
 payment_url TEXT NOT NULL DEFAULT '',sample_url TEXT NOT NULL DEFAULT '',enabled BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query("ALTER TABLE board_card_offers ADD COLUMN IF NOT EXISTS stripe_link_id TEXT NOT NULL DEFAULT ''");
}
const present=r=>({courseId:r.course_id,courseName:r.course_name,name:r.name,description:r.description,price:Number(r.price),currency:'AED',paymentUrl:r.payment_url,sampleUrl:r.sample_url,enabled:r.enabled});
export async function saveBoardCardOffer(db,id,body){
 if(!uuid(id))throw fail('معرّف الدورة غير صحيح.');const p=cardOfferInput(body);
 if(!(await db.query('SELECT id FROM courses WHERE id=$1',[id])).rows.length)throw fail('الدورة غير موجودة.',404);
 const r=await db.query(`INSERT INTO board_card_offers(course_id,name,description,price,payment_url,sample_url,enabled)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(course_id) DO UPDATE SET name=$2,description=$3,price=$4,payment_url=$5,sample_url=$6,enabled=$7,updated_at=now() RETURNING *`,[id,p.name,p.description,p.price,p.paymentUrl,p.sampleUrl,p.enabled]);return present(r.rows[0]);
}
export function installBoardCardOffers({app,pool,auth,courseMediaUpload,apiOrigin,env=process.env,fetcher=fetch}){
 app.get('/api/board-cards/capabilities',(_req,res)=>res.json({version:2,automaticPayment:true}));
 app.get('/api/admin/board-cards',auth,async(_req,res,next)=>{try{const courses=(await pool.query('SELECT id,name,active FROM courses ORDER BY active DESC,created_at DESC')).rows;const offers=(await pool.query('SELECT * FROM board_card_offers')).rows.map(present);res.set('Cache-Control','no-store').json({courses,offers});}catch(e){next(e);}});
 app.put('/api/admin/board-cards/:id',auth,async(req,res,next)=>{try{res.json(await saveAutomaticBoardCard(pool,req.params.id,req.body||{},{env,fetcher}));}catch(e){next(e);}});
 app.post('/api/admin/board-cards/:id/sample',auth,(req,res,next)=>{if(!uuid(req.params.id))return next(fail('معرّف الدورة غير صحيح.'));next();},courseMediaUpload.single('file'),async(req,res,next)=>{try{
  if(!req.file)throw fail('اختر نموذج البطاقة.');
  if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(req.file.mimetype))throw fail('ارفع PDF أو PNG أو JPG أو WEBP.');
  if(!(await pool.query('SELECT id FROM courses WHERE id=$1',[req.params.id])).rows.length)throw fail('الدورة غير موجودة.',404);
  res.status(201).json({sampleUrl:apiOrigin+'/uploads/'+encodeURIComponent(req.file.filename)});
 }catch(e){if(req.file)fs.unlink(req.file.path,()=>{});next(e);}});
 app.get('/api/board-cards/:id',async(req,res,next)=>{try{
  if(!uuid(req.params.id))throw fail('رابط البطاقة غير صحيح.',404);
  const r=(await pool.query('SELECT o.*,c.name AS course_name FROM board_card_offers o JOIN courses c ON c.id=o.course_id WHERE o.course_id=$1 AND o.enabled=true',[req.params.id])).rows[0];
  if(!r)throw fail('صفحة البطاقة غير متاحة حاليًا.',404);res.set('Cache-Control','no-store').json(present(r));
 }catch(e){next(e);}});
}

// Stripe hosts the checkout and records buyer details and payments in its dashboard.
// The price is read from validated admin input, never from the public browser.
export function boardCardStripe({env=process.env,fetcher=fetch}={}){
 const secret=String(env.STRIPE_SECRET_KEY||'').trim();
 const ready=()=>env.STRIPE_CHECKOUT_ENABLED==='1'&&/^(sk|rk)_live_/.test(secret);
 async function post(route,params,key){
  if(!ready())throw fail('الدفع الإلكتروني غير مفعّل على الخادم. راجع إعدادات Stripe.',503);
  let response,data;
  try{response=await fetcher('https://api.stripe.com/v1/'+route,{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+secret,'Stripe-Version':STRIPE_API_VERSION,'Content-Type':'application/x-www-form-urlencoded',...(key?{'Idempotency-Key':key}:{})},body:new URLSearchParams(params).toString()});data=await response.json();}catch{throw fail('تعذّر الاتصال بخدمة الدفع. أعد الحفظ للمحاولة مجددًا.',503);}
  if(!response.ok){throw fail(response.status===403?'مفتاح Stripe يحتاج صلاحية الكتابة على Payment Links وPrices وProducts لإنشاء رابط البطاقة.':'تعذّر إنشاء رابط الدفع. أعد الحفظ أو راجع إعدادات Stripe.',503);}
  return data;
 }
 return {
  async create({courseId,name,price,key}){
   const metadata={'metadata[source]':'inexc-board-card','metadata[course_id]':courseId};
   const p=await post('prices',{currency:'aed',unit_amount:String(Math.round(price*100)),'product_data[name]':name,...metadata},key+'/price');
   if(!/^price_/.test(p.id||'')||p.livemode!==true||p.unit_amount!==Math.round(price*100)||p.currency!=='aed')throw fail('تعذّر مطابقة سعر البطاقة لدى مزود الدفع.',503);
   const l=await post('payment_links',{'line_items[0][price]':p.id,'line_items[0][quantity]':'1','payment_method_types[0]':'card','billing_address_collection':'required','payment_intent_data[metadata][source]':'inexc-board-card','payment_intent_data[metadata][course_id]':courseId,...metadata},key+'/link');
   const url=safeCardUrl(l.url);
   if(!/^plink_/.test(l.id||'')||l.livemode!==true||l.active!==true||new URL(url).hostname!=='buy.stripe.com')throw fail('تعذّر التحقق من رابط الدفع الآمن.',503);
   return {id:l.id,url};
  },
  async active(id,active){if(!/^plink_[a-zA-Z0-9]+$/.test(id))throw fail('معرّف رابط الدفع غير صالح.');const r=await post('payment_links/'+id,{active:String(active)});if(r.active!==active)throw fail('تعذّر تحديث حالة رابط الدفع.',503);}
 };
}
export async function saveAutomaticBoardCard(pool,id,body,options={}){
 if(!uuid(id))throw fail('معرّف الدورة غير صحيح.');const p=cardOfferInput({...body,paymentUrl:''});
 const stripe=options.client||boardCardStripe(options),db=await pool.connect();
 try{
  await db.query('BEGIN');
  // Lock the parent so first saves and simultaneous price changes are serialized.
  if(!(await db.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[id])).rows.length)throw fail('الدورة غير موجودة.',404);
  const old=(await db.query('SELECT * FROM board_card_offers WHERE course_id=$1',[id])).rows[0];
  let linkId=old?.stripe_link_id||'',url=old?.payment_url||'';
  if(p.enabled){
   if(!linkId||Number(old.price)!==p.price||old.name!==p.name){
    const version=old?String(old.updated_at):'new';
    const key='board-card/'+crypto.createHash('sha256').update(JSON.stringify([id,p.name,p.price,version])).digest('hex');
    const link=await stripe.create({courseId:id,name:p.name,price:p.price,key});
    if(linkId)await stripe.active(linkId,false);
    linkId=link.id;url=link.url;
   }else if(!old.enabled)await stripe.active(linkId,true);
  }else if(linkId&&old.enabled)await stripe.active(linkId,false);
  const result=await saveBoardCardOffer(db,id,{...p,paymentUrl:url});
  // If a disabled offer's price changes, invalidate its old link for next activation.
  if(!p.enabled&&old&&(Number(old.price)!==p.price||old.name!==p.name)){linkId='';result.paymentUrl='';await db.query("UPDATE board_card_offers SET payment_url='' WHERE course_id=$1",[id]);}
  await db.query('UPDATE board_card_offers SET stripe_link_id=$2 WHERE course_id=$1',[id,linkId]);
  await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
