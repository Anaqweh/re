/* Independent service catalogue. No course, payment, registration or mail writes. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const fields=['name','category','summary','details','audience','delivery','duration','price_text','image_url','action_label','action_url','published','sort_order'];
const columns='id,'+fields.join(',')+',revision,created_at,updated_at';
export async function setupServiceCatalog(pool){await pool.query(`CREATE TABLE IF NOT EXISTS service_catalog (
 id UUID PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '',
 audience TEXT NOT NULL DEFAULT '', delivery TEXT NOT NULL DEFAULT '', duration TEXT NOT NULL DEFAULT '', price_text TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '', action_label TEXT NOT NULL DEFAULT 'اطلب الخدمة', action_url TEXT NOT NULL DEFAULT '',
 published BOOLEAN NOT NULL DEFAULT false, sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 999999),
 revision INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`)}
function url(value,image=false){
 if(!value)return '';
 if(value.startsWith('/')&&!value.startsWith('//')&&!/[\\\s\u0000-\u001f]/.test(value))return value;
 let parsed;try{parsed=new URL(value)}catch{throw fail(image?'رابط الصورة غير صالح.':'رابط طلب الخدمة غير صالح.')}
 if(parsed.username||parsed.password||!(image?['https:']:['https:','mailto:','tel:']).includes(parsed.protocol))throw fail('استخدم رابط HTTPS أو رابط تواصل صالحًا.');return value;
}
export function serviceInput(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail('بيانات الخدمة غير صالحة.');const out={};
 for(const [key,max]of Object.entries({name:160,category:80,summary:400,details:6000,audience:200,delivery:100,duration:100,price_text:100,image_url:1000,action_label:60,action_url:1000})){
  if(body[key]!=null&&typeof body[key]!=='string')throw fail('تحقق من النصوص المدخلة.');out[key]=String(body[key]||'').trim();if(out[key].length>max)throw fail('النص أطول من الحد المسموح: '+key);
 }
 if(!out.name)throw fail('اكتب اسم الخدمة.');out.image_url=url(out.image_url,true);out.action_url=url(out.action_url);out.action_label||='اطلب الخدمة';
 if(typeof body.published!=='boolean')throw fail('حدد حالة ظهور الخدمة.');out.published=body.published;
 if(!Number.isInteger(body.sort_order)||body.sort_order<0||body.sort_order>999999)throw fail('ترتيب الظهور يجب أن يكون عددًا صحيحًا موجبًا أو صفرًا.');out.sort_order=body.sort_order;
 if(out.published&&(!out.summary||!out.action_url))throw fail('أضف وصفًا مختصرًا ورابطًا للطلب قبل نشر الخدمة.');return out;
}
export function serviceImageExtension(buffer){
 if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'jpg';
 if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'webp';
 throw fail('اختر صورة PNG أو JPG أو WebP صالحة.');
}
export function installServiceCatalog({app,pool,auth,uploadDir}){
 const route=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(e){next(e)}};
 app.get('/api/services',route(async(_req,res)=>{const result=await pool.query(`SELECT ${columns} FROM service_catalog WHERE published=true ORDER BY sort_order,created_at,id`);res.set('Cache-Control','no-store').json({version:1,items:result.rows})}));
 app.get('/api/admin/services',auth,route(async(_req,res)=>{const result=await pool.query(`SELECT ${columns} FROM service_catalog ORDER BY sort_order,created_at,id`);res.set('Cache-Control','no-store').json({version:1,items:result.rows})}));
 app.post('/api/admin/services',auth,route(async(req,res)=>{
  if(!uuid.test(req.body?.id||''))throw fail('معرّف الخدمة غير صالح.');const data=serviceInput(req.body),values=fields.map(k=>data[k]);
  const result=await pool.query(`INSERT INTO service_catalog(id,${fields.join(',')}) VALUES($1,${fields.map((_,i)=>'$'+(i+2)).join(',')}) ON CONFLICT(id) DO NOTHING RETURNING ${columns}`,[req.body.id,...values]);
  if(result.rows[0])return res.status(201).json(result.rows[0]);
  const existing=(await pool.query(`SELECT ${columns} FROM service_catalog WHERE id=$1`,[req.body.id])).rows[0];
  if(!existing||fields.some(k=>existing[k]!==data[k]))throw fail('حُفظت هذه الخدمة سابقًا. حدّث القائمة قبل تعديلها.',409);res.json(existing);
 }));
 app.put('/api/admin/services/:id',auth,route(async(req,res)=>{
  if(!uuid.test(req.params.id))throw fail('معرّف الخدمة غير صالح.');const data=serviceInput(req.body);
  if(!Number.isInteger(req.body.revision)||req.body.revision<1)throw fail('حدّث الخدمة قبل تعديلها.');
  const result=await pool.query(`UPDATE service_catalog SET ${fields.map((k,i)=>k+'=$'+(i+1)).join(',')},revision=revision+1,updated_at=now() WHERE id=$${fields.length+1} AND revision=$${fields.length+2} RETURNING ${columns}`,[...fields.map(k=>data[k]),req.params.id,req.body.revision]);
  if(!result.rows[0])throw fail('تغيرت هذه الخدمة منذ فتحها. احتفظ بتعديلاتك ثم أعد تحميل السجل.',409);res.json(result.rows[0]);
 }));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
 app.post('/api/admin/services/image',auth,upload.single('image'),route(async(req,res)=>{
  if(!req.file)throw fail('اختر صورة الخدمة.');const ext=serviceImageExtension(req.file.buffer),filename='service-'+crypto.randomUUID()+'.'+ext;
  await fs.mkdir(uploadDir,{recursive:true});await fs.writeFile(path.join(uploadDir,filename),req.file.buffer,{flag:'wx',mode:0o644});res.status(201).json({url:'/uploads/'+filename});
 }));
}
