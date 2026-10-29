// Independent per-course board-card links. Never sends mail or marks a payment paid.
import fs from 'node:fs';
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
 if(body.enabled===true&&!paymentUrl)throw fail('أضف رابط الدفع قبل تفعيل صفحة البطاقة.');
 return {name,description,price,paymentUrl,sampleUrl,enabled:body.enabled===true};
}
export async function setupBoardCardOffers(db){await db.query(`CREATE TABLE IF NOT EXISTS board_card_offers (
 course_id UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
 name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',price NUMERIC(10,2) NOT NULL CHECK(price>0),
 payment_url TEXT NOT NULL DEFAULT '',sample_url TEXT NOT NULL DEFAULT '',enabled BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);}
const present=r=>({courseId:r.course_id,courseName:r.course_name,name:r.name,description:r.description,price:Number(r.price),currency:'AED',paymentUrl:r.payment_url,sampleUrl:r.sample_url,enabled:r.enabled});
export async function saveBoardCardOffer(db,id,body){
 if(!uuid(id))throw fail('معرّف الدورة غير صحيح.');const p=cardOfferInput(body);
 if(!(await db.query('SELECT id FROM courses WHERE id=$1',[id])).rows.length)throw fail('الدورة غير موجودة.',404);
 const r=await db.query(`INSERT INTO board_card_offers(course_id,name,description,price,payment_url,sample_url,enabled)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(course_id) DO UPDATE SET name=$2,description=$3,price=$4,payment_url=$5,sample_url=$6,enabled=$7,updated_at=now() RETURNING *`,[id,p.name,p.description,p.price,p.paymentUrl,p.sampleUrl,p.enabled]);return present(r.rows[0]);
}
export function installBoardCardOffers({app,pool,auth,courseMediaUpload,apiOrigin}){
 app.get('/api/board-cards/capabilities',(_req,res)=>res.json({version:1}));
 app.get('/api/admin/board-cards',auth,async(_req,res,next)=>{try{const courses=(await pool.query('SELECT id,name,active FROM courses ORDER BY active DESC,created_at DESC')).rows;const offers=(await pool.query('SELECT * FROM board_card_offers')).rows.map(present);res.set('Cache-Control','no-store').json({courses,offers});}catch(e){next(e);}});
 app.put('/api/admin/board-cards/:id',auth,async(req,res,next)=>{try{res.json(await saveBoardCardOffer(pool,req.params.id,req.body||{}));}catch(e){next(e);}});
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
