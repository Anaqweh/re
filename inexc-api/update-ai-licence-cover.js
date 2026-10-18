// Explicit artwork update. Do not import the server or start its scheduled workers.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

const batch='inexc-ai-licence-cover-20261018';
const courseId='ea14c5bd-ab64-4e77-8b1b-b5c09aa8eed0';
const filename='international-ai-licence-20261018.webp';
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export async function prepareCourseImage(data,assetDir,uploadDir){
 const bytes=await fs.readFile(path.join(assetDir,filename));
 if(sha256(bytes)!==data.imageSha256)throw Error('Artwork integrity check failed.');
 const target=path.join(uploadDir,filename);
 try{await fs.writeFile(target,bytes,{flag:'wx',mode:0o644})}catch(error){
  if(error.code!=='EEXIST')throw error;
  if(sha256(await fs.readFile(target))!==data.imageSha256)throw Error('Existing image differs; refusing to overwrite it.');
 }
}

export async function updateAiLicenceCover(pool,data,{prepareImage}={}){
 if(data?.batch!==batch||data.courseId!==courseId||!data.courseName||data.expectedPrice!==0||data.expectedImagePath!==''||data.imageFile!==`assets/courses/${filename}`||data.imagePath!==`/uploads/${filename}`||!/^[a-f0-9]{64}$/.test(data.imageSha256))throw Error('Unexpected course artwork manifest.');
 if(typeof prepareImage!=='function')throw Error('Artwork preparation is required.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS course_artwork_updates(batch TEXT PRIMARY KEY,course_id UUID NOT NULL,before_image_path TEXT NOT NULL DEFAULT '',after_image_path TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const claim=await client.query('INSERT INTO course_artwork_updates(batch,course_id,after_image_path) VALUES($1,$2,$3) ON CONFLICT(batch) DO NOTHING RETURNING batch',[batch,courseId,data.imagePath]);
  if(!claim.rowCount){await client.query('COMMIT');return {updated:0,alreadyApplied:true,message:'Already applied; later administrator edits were preserved.'}}
  const row=(await client.query('SELECT id,name,price,image_path FROM courses WHERE id=$1 FOR UPDATE',[courseId])).rows[0];
  if(!row||row.name!==data.courseName||Number(row.price)!==0)throw Error('The expected free AI licence course was not found; no course was changed.');
  if((row.image_path||'')!==data.expectedImagePath)throw Error('The course image changed since preparation; review before applying.');
  await client.query('UPDATE course_artwork_updates SET before_image_path=$2 WHERE batch=$1',[batch,row.image_path||'']);
  await prepareImage(data);
  await client.query('UPDATE courses SET image_path=$1,updated_at=now() WHERE id=$2',[data.imagePath,courseId]);
  await client.query('COMMIT');
  return {updated:1,courseId,courseName:row.name,imagePath:data.imagePath,backupBatch:batch};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
 try{
  const data=JSON.parse(await fs.readFile(new URL('./ai-licence-cover-20261018.json',import.meta.url),'utf8'));
  const assetDir=path.join(path.dirname(process.argv[1]),'assets');
  console.log(JSON.stringify(await updateAiLicenceCover(pool,data,{prepareImage:c=>prepareCourseImage(c,assetDir,'/app/uploads')}),null,2));
  console.log('Course image installed. Only the free AI licence course artwork was updated. No restart, emails or registrations were triggered.');
 }catch(error){console.error('Artwork update stopped; database changes rolled back:',error.message);process.exitCode=1}finally{await pool.end()}
}
