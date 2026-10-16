// Explicit content update only. Never import server.js or start background workers.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

const batch='inexc-course-content-20261016';
const lines=value=>String(value||'').split(/\r?\n/).map(x=>x.replace(/^[\s•\-–—*\d.)]+/,'').trim()).filter(Boolean);
const snapshot=row=>({description:row.description,axes:lines(row.axes),outcomes:lines(row.outcomes).slice(0,8),trainer:row.trainer,date:row.course_date,location:row.location,imageUrl:row.image_path});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validateCourseContent(data){
 if(data?.batch!==batch||data.timezone!=='Asia/Dubai'||data.courses?.length!==11)throw Error('Unexpected content update.');
 const ids=new Set(),files=new Set(),slots=[];
 for(const c of data.courses){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.id)||ids.has(c.id))throw Error('Invalid course identity.');
  if(!c.name||!c.description||c.description.length>1000||!c.trainer||!c.date||c.date.length>80||!c.location||c.location.length>160)throw Error('Incomplete course content: '+c.name);
  if(!Array.isArray(c.axes)||c.axes.filter(x=>x.startsWith('المحور ')).length<4||!Array.isArray(c.outcomes)||c.outcomes.length<4||c.outcomes.length>8)throw Error('Incomplete curriculum: '+c.name);
  if(!/^[a-z0-9-]+$/.test(c.slug)||c.imageFile!==`assets/courses/${c.slug}-20261016.webp`||c.imagePath!==`/uploads/course-content-20261016-${c.slug}.webp`||!/^[a-f0-9]{64}$/.test(c.imageSha256)||files.has(c.imagePath))throw Error('Invalid artwork.');
  if(!c.expected||Object.keys(snapshot({description:'',axes:'',outcomes:'',trainer:'',course_date:'',location:'',image_path:''})).some(k=>!(k in c.expected)))throw Error('Missing original content.');
  if(!Array.isArray(c.schedule)||!c.schedule.length||c.schedule[0].date<'2026-10-23'||c.schedule[0].date>'2026-10-30')throw Error('Start outside the requested week.');
  let hours=0;
  for(const s of c.schedule){
   if(!/^2026-\d{2}-\d{2}$/.test(s.date)||!/^\d{2}:\d{2}$/.test(s.start)||!/^\d{2}:\d{2}$/.test(s.end)||s.timezone!=='Asia/Dubai')throw Error('Invalid session.');
   const start=Date.parse(`${s.date}T${s.start}:00+04:00`),end=Date.parse(`${s.date}T${s.end}:00+04:00`);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Invalid session length.');
   hours+=(end-start)/3600000;slots.push({start,end,trainer:c.trainer,name:c.name});
  }
  if(hours!==c.hours)throw Error('Session hours do not match: '+c.name);
  ids.add(c.id);files.add(c.imagePath);
 }
 slots.sort((a,b)=>a.start-b.start);
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length&&slots[j].start<slots[i].end;j++)if(slots[i].trainer===slots[j].trainer)throw Error('Overlapping trainer sessions.');
}

export async function updateCourseContent(pool,data,{prepareImage=async()=>{}}={}){
 validateCourseContent(data);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS course_content_updates(batch TEXT PRIMARY KEY,before_content JSONB NOT NULL DEFAULT '[]'::jsonb,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const claim=await client.query('INSERT INTO course_content_updates(batch) VALUES($1) ON CONFLICT(batch) DO NOTHING RETURNING batch',[data.batch]);
  if(!claim.rowCount){await client.query('COMMIT');return {updated:0,alreadyApplied:true,message:'Already applied; later admin edits were preserved.'}}
  const rows=(await client.query('SELECT id,name,description,axes,outcomes,trainer,course_date,location,image_path,training_hours FROM courses WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[data.courses.map(c=>c.id)])).rows;
  if(rows.length!==data.courses.length)throw Error('A course is missing; nothing was changed.');
  for(const c of data.courses){
   const row=rows.find(r=>r.id===c.id),before=snapshot(row);
   if(Number(row.training_hours)!==c.hours||Object.keys(c.expected).some(k=>!equal(before[k],c.expected[k])))throw Error('Course content changed since preparation; review before applying: '+row.name);
  }
  // Backup only changed public content. Payment, registration and campaign data are not read or written.
  await client.query('UPDATE course_content_updates SET before_content=$2::jsonb WHERE batch=$1',[data.batch,JSON.stringify(rows)]);
  for(const c of data.courses)await prepareImage(c);
  for(const c of data.courses)await client.query('UPDATE courses SET description=$1,axes=$2,outcomes=$3,trainer=$4,course_date=$5,location=$6,image_path=$7,updated_at=now() WHERE id=$8',[c.description,c.axes.join('\n'),c.outcomes.join('\n'),c.trainer,c.date,c.location,c.imagePath,c.id]);
  await client.query('COMMIT');
  return {updated:data.courses.length,images:data.courses.length,startsBetween:['2026-10-23','2026-10-30'],timezone:'Asia/Dubai',backupBatch:data.batch};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
 try{
  const data=JSON.parse(await fs.readFile(new URL('./course-content-20261016.json',import.meta.url),'utf8'));
  const assetDir=new URL('./assets/',import.meta.url),uploadDir='/app/uploads';
  const prepareImage=async c=>{
   const bytes=await fs.readFile(new URL(path.basename(c.imageFile),assetDir));
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==c.imageSha256)throw Error('Artwork integrity check failed: '+c.slug);
   const target=path.join(uploadDir,path.basename(c.imagePath));
   try{await fs.writeFile(target,bytes,{flag:'wx',mode:0o644})}catch(error){
    if(error.code!=='EEXIST')throw error;
    if(crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex')!==c.imageSha256)throw Error('Existing image differs; refusing to overwrite it.');
   }
  };
  console.log(JSON.stringify(await updateCourseContent(pool,data,{prepareImage}),null,2));
  console.log('Course content update complete. No emails, registrations, payment settings or scheduled campaigns were created or changed. No API restart was needed.');
 }catch(error){console.error('Content update stopped; database transaction rolled back:',error.message);process.exitCode=1}finally{await pool.end()}
}
