// Course checkout policy. Opening a payment link never confirms payment.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const COURSE_PAYMENT_METHODS=['stripe','bank','link'];
const uuid=value=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(value||''));
export function coursePaymentMethods(value){
 if(!Array.isArray(value)||value.some(method=>!COURSE_PAYMENT_METHODS.includes(method)))throw fail('طرق الدفع غير صالحة.');
 return COURSE_PAYMENT_METHODS.filter(method=>value.includes(method));
}
export function validCoursePaymentLink(value){
 if(typeof value!=='string'||value.length>500)return '';
 try{const url=new URL(value.trim());return url.protocol==='https:'&&url.hostname&&!url.username&&!url.password?url.href:''}catch{return ''}
}
export function validateCoursePayment(course,{method,total,hasReceipt}){
 if(!Number.isFinite(total)||total<0)throw fail('تعذّر تحديد مبلغ التسجيل. تواصل مع الإدارة.');
 if(total===0)return {method:'free',status:'مسجل',paymentLink:''};
 const methods=Array.isArray(course.payment_methods)?course.payment_methods:[];
 if(!['link','bank'].includes(method)||!methods.includes(method))throw fail('اختر وسيلة دفع متاحة لهذه الدورة.');
 if(method==='link'){
  const paymentLink=validCoursePaymentLink(course.payment_link);
  if(!paymentLink)throw fail('رابط الدفع لهذه الدورة غير جاهز. اختر وسيلة أخرى أو تواصل مع الإدارة.');
  return {method,status:'بانتظار الدفع',paymentLink};
 }
 if(!hasReceipt)throw fail('يرجى إرفاق وصل التحويل البنكي.');
 return {method,status:'بانتظار مراجعة الوصل',paymentLink:''};
}

// One migration enables Stripe for the existing catalog as requested. Later choices, including [], survive restarts.
export async function setupCoursePaymentControls(pool){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query(`CREATE TABLE IF NOT EXISTS course_payment_settings(id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),default_methods TEXT[] NOT NULL DEFAULT ARRAY['stripe','bank'],default_membership_enabled BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const inserted=await db.query('INSERT INTO course_payment_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING RETURNING id');
  if(inserted.rows.length)await db.query("UPDATE courses SET payment_methods=array_prepend('stripe',array_remove(payment_methods,'stripe')),updated_at=now()");
  await db.query("ALTER TABLE courses ALTER COLUMN payment_methods SET DEFAULT ARRAY['stripe','bank']::text[]");
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function coursePaymentInput(pool,input,previous){
 let defaults;
 if(!previous&&(input.payments===undefined||input.membershipEnabled===undefined))defaults=(await pool.query('SELECT * FROM course_payment_settings WHERE id=true')).rows[0];
 const methods=input.payments===undefined?(previous?.payment_methods??defaults?.default_methods??['stripe','bank']):coursePaymentMethods(input.payments);
 if(input.membershipEnabled!==undefined&&typeof input.membershipEnabled!=='boolean')throw fail('إعداد بطاقة INEXC غير صالح.');
 const membershipEnabled=input.membershipEnabled??previous?.membership_enabled??defaults?.default_membership_enabled??true;
 if(methods.includes('link')&&!validCoursePaymentLink(input.paymentLink??previous?.payment_link))throw fail('أدخل رابط دفع خارجي صالحًا يبدأ بـ https:// أو أوقف طريقة الرابط الخارجي. Stripe لا يحتاج رابطًا يدويًا.');
 return {methods,membershipEnabled};
}

export function createCoursePaymentControls({pool,stripe,publicCourse}){
 async function settings(){
  const row=(await pool.query('SELECT * FROM course_payment_settings WHERE id=true')).rows[0];
  return {version:2,defaults:{payments:row.default_methods,membershipEnabled:row.default_membership_enabled},stripe:{configured:stripe.enabled(),...stripe.readiness()},courses:(await pool.query('SELECT * FROM courses ORDER BY active DESC,created_at DESC')).rows.map(publicCourse)};
 }
 async function update(input){
  const all=input.scope==='all',id=input.courseId;
  if(!all&&!uuid(id))throw fail('حدد الدورة أو اختر جميع الدورات.');
  const action=input.action||'replace';
  if(!['replace','enable-stripe','disable-stripe'].includes(action))throw fail('الإجراء غير صالح.');
  const requested=action==='replace'?coursePaymentMethods(input.payments):null;
  if(action==='replace'&&typeof input.membershipEnabled!=='boolean')throw fail('حدد حالة بطاقة INEXC.');
  const db=await pool.connect();let count=0;
  try{
   await db.query('BEGIN');
   const rows=(await db.query('SELECT * FROM courses'+(all?'':' WHERE id=$1')+' ORDER BY id FOR UPDATE',all?[]:[id])).rows;
   if(!rows.length&&!all)throw fail('الدورة غير موجودة.',404);
   for(const row of rows){
    const methods=action==='replace'?requested:action==='enable-stripe'?[...new Set(['stripe',...row.payment_methods])]:row.payment_methods.filter(method=>method!=='stripe');
    if(action==='replace'&&methods.includes('link')&&!validCoursePaymentLink(row.payment_link))throw fail('لا يوجد رابط خارجي صالح للدورة «'+row.name+'». أضف الرابط من تعديل الدورة أو ألغِ اختيار الرابط الخارجي.');
    await db.query('UPDATE courses SET payment_methods=$1,membership_enabled=$2,updated_at=now() WHERE id=$3',[methods,action==='replace'?input.membershipEnabled:row.membership_enabled,row.id]);count++;
   }
   if(all&&input.applyToNew===true){
    if(requested?.includes('link'))throw fail('لا يمكن جعل الرابط الخارجي افتراضيًا قبل إدخال رابط خاص بكل دورة.');
    const current=(await db.query('SELECT * FROM course_payment_settings WHERE id=true FOR UPDATE')).rows[0];
    const methods=action==='replace'?requested:action==='enable-stripe'?[...new Set(['stripe',...current.default_methods])]:current.default_methods.filter(method=>method!=='stripe');
    await db.query('UPDATE course_payment_settings SET default_methods=$1,default_membership_enabled=$2,updated_at=now() WHERE id=true',[methods,action==='replace'?input.membershipEnabled:current.default_membership_enabled]);
   }
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  return {ok:true,updated:count,...await settings()};
 }
 function install(app,auth){
  const route=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await fn(req))}catch(error){next(error)}};
  app.get('/api/admin/course-payments',auth,route(()=>settings()));
  app.put('/api/admin/course-payments',auth,route(req=>update(req.body||{})));
  app.post('/api/admin/course-payments/stripe-check',auth,route(()=>stripe.checkReadiness()));
 }
 return {settings,update,install};
}
