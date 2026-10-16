// Explicit one-time import only. Never import server.js or enqueue/send course alerts.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {validCoursePaymentLink} from './course-payment.js';

export function validateCatalog(catalog){
 if(catalog?.batch!=='inexc-catalog-20261016'||catalog.currency!=='AED'||catalog.courses?.length!==10)throw Error('Unexpected course catalog.');
 const ids=new Set(),slugs=new Set();
 for(const item of catalog.courses){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.id)||ids.has(item.id)||!/^[a-z0-9-]+$/.test(item.slug)||slugs.has(item.slug))throw Error('Invalid or duplicate catalog identity.');
  if(!['course','diploma'].includes(item.kind)||!item.name||item.name.length>180||!item.description||item.description.length>1000||!Number.isFinite(item.price)||item.price<=0||!Number.isFinite(item.hours)||item.hours<=0||!Array.isArray(item.axes)||item.axes.length<4||!Array.isArray(item.outcomes)||item.outcomes.length<3)throw Error('Incomplete course: '+item.slug);
  if(item.paymentLink&&!validCoursePaymentLink(item.paymentLink))throw Error('Invalid payment URL: '+item.slug);
  ids.add(item.id);slugs.add(item.slug);
 }
 if(catalog.courses.filter(x=>x.kind==='course').length!==5||catalog.courses.filter(x=>x.kind==='diploma').length!==5)throw Error('Catalog must contain five courses and five diplomas.');
}

export async function importCourseCatalog(pool,catalog){
 validateCatalog(catalog);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS course_catalog_imports(batch TEXT PRIMARY KEY,course_ids JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const claim=await client.query('INSERT INTO course_catalog_imports(batch) VALUES($1) ON CONFLICT(batch) DO NOTHING RETURNING batch',[catalog.batch]);
  if(!claim.rowCount){await client.query('COMMIT');return {created:0,alreadyImported:true,message:'The catalog was already imported. Later edits and deletions were preserved.'}}
  // Reuse the operator's existing receiving bank; never manufacture payment details or URLs.
  const bank=(await client.query("SELECT bank_name,bank_account,bank_iban FROM courses WHERE active=true AND 'bank'=ANY(payment_methods) AND (bank_account<>'' OR bank_iban<>'') ORDER BY updated_at DESC LIMIT 1")).rows[0];
  const created=[],skipped=[];
  for(const item of catalog.courses){
   const slug='catalog-'+item.slug;
   const exists=await client.query('SELECT id FROM courses WHERE id=$1 OR name=$2 OR share_slug=$3 LIMIT 1',[item.id,item.name,slug]);
   if(exists.rowCount){skipped.push(item.slug);continue}
   const link=validCoursePaymentLink(item.paymentLink),active=!!(bank||link);
   await client.query(`INSERT INTO courses(id,name,description,axes,outcomes,trainer,course_date,location,category,price,training_hours,certificate_mode,certificate_name,certificate_price,payment_methods,payment_link,bank_name,bank_account,bank_iban,active,share_slug,membership_enabled,membership_kind)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'included',$12,0,$13,$14,$15,$16,$17,$18,$19,true,$20)`,[
     item.id,item.name,item.description,item.axes.join('\n'),item.outcomes.join('\n'),item.trainer,item.date,item.location,item.category,item.price,item.hours,item.certificate.name,
     bank?['link','bank']:['link'],link,bank?.bank_name||'',bank?.bank_account||'',bank?.bank_iban||'',active,slug,item.kind
    ]);
   created.push({id:item.id,name:item.name,price:item.price,hours:item.hours,kind:item.kind,active,paymentLinkConfigured:!!link});
  }
  await client.query('UPDATE course_catalog_imports SET course_ids=$2::jsonb WHERE batch=$1',[catalog.batch,JSON.stringify(created.map(x=>x.id))]);
  await client.query('COMMIT');
  return {created:created.length,skipped,active:created.filter(x=>x.active).length,paymentLinksNeeded:created.filter(x=>!x.paymentLinkConfigured).length,courses:created};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
 try{
  const catalog=JSON.parse(await fs.readFile(new URL('./course-catalog-20261016.json',import.meta.url),'utf8'));
  console.log(JSON.stringify(await importCourseCatalog(pool,catalog),null,2));
  console.log('Catalog import finished. No registrations, email notifications or scheduled campaigns were created or changed.');
 }catch(error){console.error('Catalog import failed; transaction rolled back:',error.message);process.exitCode=1}finally{await pool.end()}
}
