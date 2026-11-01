import {projectReceipt,projectReceiptWorker} from './project-receipt.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const tokenPattern=/^[a-f0-9]{64}$/;
const maxBytes=10*1024*1024,quotaBytes=1024*1024*1024;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail('تحقق من البيانات المطلوبة وطول النص.');return value.trim()};
const scheduleDate=value=>{if(value===null)return null;if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw fail('أدخل تاريخًا ووقتًا صحيحين للاستقبال.');return new Date(value).toISOString()};
export function projectWindow(portal,now=Date.now()){
 if(portal.closes_at&&now>=new Date(portal.closes_at).getTime())return 'closed';
 if(portal.opens_at&&now<new Date(portal.opens_at).getTime())return 'upcoming';
 return 'open';
}
export async function setupCourseProjects(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS course_project_portals(course_id UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,token TEXT UNIQUE NOT NULL,enabled BOOLEAN NOT NULL DEFAULT true,title TEXT NOT NULL DEFAULT 'مشروع الدورة',instructions TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await pool.query('ALTER TABLE course_project_portals ADD COLUMN IF NOT EXISTS opens_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ');
 await pool.query(`CREATE TABLE IF NOT EXISTS course_project_files(id UUID PRIMARY KEY,course_id UUID NOT NULL REFERENCES course_project_portals(course_id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('material','submission')),name TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',file_name TEXT NOT NULL,stored_name TEXT NOT NULL UNIQUE,size_bytes BIGINT NOT NULL,ip_hash TEXT NOT NULL DEFAULT '',fingerprint TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS course_project_receipts(id UUID PRIMARY KEY REFERENCES course_project_files(id) ON DELETE CASCADE,email TEXT NOT NULL,message JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,due_at TIMESTAMPTZ NOT NULL DEFAULT now(),locked_until TIMESTAMPTZ,first_attempt_at TIMESTAMPTZ,provider_id TEXT,sent_at TIMESTAMPTZ,error TEXT NOT NULL DEFAULT '')`);
 await pool.query('CREATE INDEX IF NOT EXISTS course_project_files_course ON course_project_files(course_id,created_at DESC)');
}
export function installCourseProjects({app,pool,auth,uploadDir,sendEmail,mailEnabled=false,mailAllowed}){
 // Already blocked by /uploads/trainee-private middleware. Downloads require an admin or portal token.
 const dir=path.join(uploadDir,'trainee-private','projects');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const uploader=multer({storage:multer.diskStorage({destination:dir,filename:(_r,_f,cb)=>cb(null,crypto.randomUUID()+'.bin')}),limits:{fileSize:maxBytes,files:1,fields:8,fieldSize:12000,parts:10}}).single('file');
 const wrap=fn=>async(req,res,next)=>{res.set('Cache-Control','no-store');try{await fn(req,res)}catch(e){next(e)}};
 const adminCourse=(req,_res,next)=>{if(!uuid.test(req.params.id))return next(fail('معرّف الدورة غير صالح.'));next()};
 const gate=async(req,res,next)=>{try{if(!tokenPattern.test(req.params.token||''))throw fail('الرابط غير متاح.',404);const p=(await pool.query('SELECT p.*,c.name AS course_name,clock_timestamp() AS server_now FROM course_project_portals p JOIN courses c ON c.id=p.course_id WHERE p.token=$1 AND p.enabled=true',[req.params.token])).rows[0];if(!p)throw fail('الرابط غير متاح أو أوقفته الإدارة.',404);req.projectPortal=p;res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next()}catch(e){next(e)}};
 const portal=(r)=>r?{courseId:r.course_id,title:r.title,instructions:r.instructions,enabled:r.enabled,opensAt:r.opens_at||null,closesAt:r.closes_at||null,url:'https://www.inexctraining.com/course-project.html?key='+r.token}:null;
 const files=async(id,kind,offset=0)=>(await pool.query('SELECT id,name,email,title,description,file_name,size_bytes,created_at,(SELECT status FROM course_project_receipts WHERE id=course_project_files.id) AS receipt_status FROM course_project_files WHERE course_id=$1 AND kind=$2 ORDER BY created_at DESC,id LIMIT 101 OFFSET $3',[id,kind,offset])).rows;
 app.get('/api/admin/course-projects/:id',auth,adminCourse,wrap(async(req,res)=>{const p=(await pool.query('SELECT * FROM course_project_portals WHERE course_id=$1',[req.params.id])).rows[0];const offset=Math.max(0,Math.min(100000,parseInt(req.query.offset)||0));const submissions=p?await files(req.params.id,'submission',offset):[];res.json({portal:portal(p),materials:p?(await files(req.params.id,'material')).slice(0,100):[],submissions:submissions.slice(0,100),hasMore:submissions.length>100,offset,maxBytes,receiptEmailEnabled:mailEnabled})}));
 app.put('/api/admin/course-projects/:id',auth,adminCourse,wrap(async(req,res)=>{
  const b=req.body||{},title=text(b.title,160,true),instructions=text(b.instructions,10000);
  if(typeof b.enabled!=='boolean')throw fail('حدد حالة الرابط.');
  const scheduleProvided=Object.hasOwn(b,'opensAt')||Object.hasOwn(b,'closesAt');let opensAt=null,closesAt=null;
  if(scheduleProvided){opensAt=scheduleDate(b.opensAt);closesAt=scheduleDate(b.closesAt);if(opensAt&&closesAt&&Date.parse(closesAt)<=Date.parse(opensAt))throw fail('موعد الإغلاق يجب أن يكون بعد موعد بدء الاستقبال.');}
  if(!(await pool.query('SELECT id FROM courses WHERE id=$1',[req.params.id])).rowCount)throw fail('الدورة غير موجودة.',404);
  const r=await pool.query(`INSERT INTO course_project_portals(course_id,token,title,instructions,enabled,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(course_id) DO UPDATE SET title=EXCLUDED.title,instructions=EXCLUDED.instructions,enabled=EXCLUDED.enabled,opens_at=CASE WHEN $8 THEN EXCLUDED.opens_at ELSE course_project_portals.opens_at END,closes_at=CASE WHEN $8 THEN EXCLUDED.closes_at ELSE course_project_portals.closes_at END,updated_at=now() RETURNING *`,[req.params.id,crypto.randomBytes(32).toString('hex'),title,instructions,b.enabled,opensAt,closesAt,scheduleProvided]);res.json({portal:portal(r.rows[0])})
 }));
 app.post('/api/admin/course-projects/:id/rotate',auth,adminCourse,wrap(async(req,res)=>{const r=await pool.query('UPDATE course_project_portals SET token=$2,updated_at=now() WHERE course_id=$1 RETURNING *',[req.params.id,crypto.randomBytes(32).toString('hex')]);if(!r.rowCount)throw fail('احفظ إعدادات المشروع أولًا.',404);res.json({portal:portal(r.rows[0])})}));
 app.get('/api/course-projects/:token',gate,wrap(async(req,res)=>{const p=req.projectPortal;const m=await files(p.course_id,'material');res.json({courseName:p.course_name,title:p.title,instructions:p.instructions,maxBytes,receiptEmailEnabled:mailEnabled,opensAt:p.opens_at||null,closesAt:p.closes_at||null,submissionStatus:projectWindow(p,new Date(p.server_now).getTime()),serverNow:p.server_now,materials:m.slice(0,100).map(f=>({id:f.id,title:f.title,fileName:f.file_name,size:Number(f.size_bytes)}))})}));
 const download=async(req,res,kind,courseId)=>{if(!uuid.test(req.params.fileId))throw fail('الملف غير موجود.',404);const r=(await pool.query('SELECT stored_name,file_name FROM course_project_files WHERE id=$1 AND course_id=$2 AND kind=$3',[req.params.fileId,courseId,kind])).rows[0];if(!r||!/^[-a-f0-9]+\.bin$/.test(r.stored_name))throw fail('الملف غير موجود.',404);res.set({'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox','Cache-Control':'no-store'});res.download(path.join(dir,r.stored_name),r.file_name)};
 app.get('/api/course-projects/:token/materials/:fileId',gate,wrap((req,res)=>download(req,res,'material',req.projectPortal.course_id)));
 app.get('/api/admin/course-projects/:id/:kind/:fileId',auth,adminCourse,wrap(async(req,res)=>{if(!['material','submission'].includes(req.params.kind))throw fail('نوع الملف غير صالح.');await download(req,res,req.params.kind,req.params.id)}));
 const adminGate=async(req,_res,next)=>{try{const p=(await pool.query('SELECT * FROM course_project_portals WHERE course_id=$1',[req.params.id])).rows[0];if(!p)throw fail('احفظ إعدادات المشروع أولًا.');req.projectPortal=p;next()}catch(e){next(e)}};
 const receive=kind=>(req,res,next)=>uploader(req,res,async uploadError=>{
  let client,keep=false;try{
   if(uploadError)throw fail(uploadError.code==='LIMIT_FILE_SIZE'?'الحد الأقصى للملف 10 ميغابايت.':'تعذّر رفع الملف. ارفع ملفًا واحدًا بحجم لا يتجاوز 10 ميغابايت.');
   const b=req.body||{},p=req.projectPortal;if(!req.file)throw fail('اختر الملف أولًا.');if(!uuid.test(b.requestId||''))throw fail('أعد تحميل الصفحة وحاول مجددًا.');
   const name=kind==='submission'?text(b.name,150,true):'',email=kind==='submission'?text(b.email||'',190):'',title=text(b.title,200,true),description=text(b.description||'',5000,kind==='submission');
   if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('البريد الإلكتروني غير صحيح.');if(b.website)throw fail('تعذّر استلام الطلب.');
   const fileName=path.basename(Buffer.from(req.file.originalname,'latin1').toString('utf8')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,200)||'project-file';
   const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(req.file.path))hash.update(chunk);const fingerprint=crypto.createHash('sha256').update(JSON.stringify([name,email,title,description,hash.digest('hex')])).digest('hex'),ipHash=crypto.createHash('sha256').update(String(req.ip)).digest('hex');
   client=await pool.connect();await client.query('BEGIN');await client.query('SELECT course_id FROM course_project_portals WHERE course_id=$1 FOR UPDATE',[p.course_id]);
   const live=(await client.query('SELECT enabled,token,opens_at,closes_at,clock_timestamp() AS server_now FROM course_project_portals WHERE course_id=$1',[p.course_id])).rows[0];if(kind==='submission'&&(!live?.enabled||live.token!==req.params.token))throw fail('أوقفت الإدارة هذا الرابط. أعد التواصل معها.',404);
   const prior=(await client.query('SELECT fingerprint,course_id,kind FROM course_project_files WHERE id=$1',[b.requestId])).rows[0];
   if(prior){if(prior.fingerprint!==fingerprint||prior.course_id!==p.course_id||prior.kind!==kind)throw fail('رقم الطلب مستخدم لبيانات أخرى. أعد تحميل الصفحة.',409);await client.query('ROLLBACK');return res.json({ok:true,reference:b.requestId,emailQueued:kind==='submission'&&!!email&&mailEnabled})}
   if(kind==='submission'){const state=projectWindow(live,new Date(live.server_now).getTime());if(state==='upcoming')throw fail('لم يبدأ استقبال المشاريع بعد. راجع موعد الفتح المعروض في صفحة المشروع.',409);if(state==='closed')throw fail('انتهى موعد استقبال المشاريع. تواصل مع إدارة الدورة إذا كنت تحتاج إلى تمديد.',409);}
   const stats=(await client.query('SELECT COALESCE(sum(size_bytes),0) AS bytes,count(*) FILTER(WHERE kind=\'material\') AS materials FROM course_project_files WHERE course_id=$1',[p.course_id])).rows[0];if(Number(stats.bytes)+req.file.size>quotaBytes)throw fail('مساحة ملفات هذه الدورة ممتلئة. تواصل مع الإدارة.',409);if(kind==='material'&&Number(stats.materials)>=100)throw fail('الحد الأقصى 100 ملف تعليمي لكل دورة.');
   if(kind==='submission'){const count=(await client.query("SELECT count(*) AS n FROM course_project_files WHERE course_id=$1 AND ip_hash=$2 AND kind='submission' AND created_at>now()-interval '1 hour'",[p.course_id,ipHash])).rows[0];if(Number(count.n)>=100)throw fail('طلبات كثيرة من هذه الشبكة. حاول لاحقًا.',429)}
   await client.query('INSERT INTO course_project_files(id,course_id,kind,name,email,title,description,file_name,stored_name,size_bytes,ip_hash,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[b.requestId,p.course_id,kind,name,email,title,description,fileName,req.file.filename,req.file.size,ipHash,fingerprint]);if(kind==='submission'&&email&&mailEnabled){const message=projectReceipt({name,courseName:p.course_name,title,reference:b.requestId});await client.query('INSERT INTO course_project_receipts(id,email,message) VALUES($1,$2,$3)',[b.requestId,email,JSON.stringify(message)])}
   await client.query('COMMIT');keep=true;res.status(201).json({ok:true,reference:b.requestId,emailQueued:kind==='submission'&&!!email&&mailEnabled});
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client?.release();if(!keep&&req.file?.path)fs.unlink(req.file.path,()=>{})}
 });
 app.post('/api/admin/course-projects/:id/materials',auth,adminCourse,adminGate,receive('material'));
 app.post('/api/course-projects/:token/submissions',gate,receive('submission'));
 return {processEmailQueue:projectReceiptWorker({pool,sendEmail,mailEnabled,mailAllowed})};
}
