import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {updateAiLicenceCover,prepareCourseImage} from '../update-ai-licence-cover.js';
const data=JSON.parse(await fs.readFile(new URL('../ai-licence-cover-20261018.json',import.meta.url),'utf8'));
const assetDir=fileURLToPath(new URL('../../assets/courses/',import.meta.url));

test('installs only the free course image; failures roll back and retries preserve administrator edits',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const uploadDir=await fs.mkdtemp(path.join(os.tmpdir(),'inexc-cover-test-'));t.after(()=>fs.rm(uploadDir,{recursive:true,force:true}));
 await db.exec(`CREATE TABLE courses(id UUID PRIMARY KEY,name TEXT,price NUMERIC,image_path TEXT DEFAULT '',certificate_price NUMERIC DEFAULT 199,certificate_issuer TEXT DEFAULT 'Existing issuer',description TEXT DEFAULT 'Existing curriculum',payment_link TEXT DEFAULT 'https://example.invalid/pay',active BOOLEAN DEFAULT true,updated_at TIMESTAMPTZ DEFAULT now());`);
 await db.query('INSERT INTO courses(id,name,price) VALUES($1,$2,0) RETURNING id',[data.courseId,data.courseName]);
 await db.query("INSERT INTO courses(id,name,price,image_path) VALUES('00000000-0000-0000-0000-000000000001','Other course',300,'/uploads/original.webp')");
 const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};
 const pool={connect:async()=>({query,release(){}})};
 const options={prepareImage:c=>prepareCourseImage(c,assetDir,uploadDir)};
 const before=(await db.query('SELECT * FROM courses ORDER BY id')).rows;
 await db.query("UPDATE courses SET image_path='/uploads/admin-image.webp' WHERE id=$1",[data.courseId]);
 await assert.rejects(updateAiLicenceCover(pool,data,options),/changed since/);
 await db.query("UPDATE courses SET image_path='' WHERE id=$1",[data.courseId]);
 await assert.rejects(updateAiLicenceCover(pool,{...data,imageSha256:'0'.repeat(64)},options),/integrity/);
 assert.deepEqual((await db.query('SELECT * FROM courses ORDER BY id')).rows,before);
 assert.equal((await updateAiLicenceCover(pool,data,options)).updated,1);
 const after=(await db.query('SELECT * FROM courses ORDER BY id')).rows;
 for(let i=0;i<after.length;i++){
  const {image_path,updated_at,...fields}=after[i],{image_path:oldImage,updated_at:oldDate,...original}=before[i];
  assert.deepEqual(fields,original);
  assert.equal(image_path,after[i].id===data.courseId?data.imagePath:oldImage);
 }
 assert.equal((await db.query('SELECT before_image_path FROM course_artwork_updates')).rows[0].before_image_path,'');
 await prepareCourseImage(data,assetDir,uploadDir);
 await fs.writeFile(path.join(uploadDir,path.basename(data.imagePath)),'ADMIN FILE');
 await assert.rejects(prepareCourseImage(data,assetDir,uploadDir),/refusing to overwrite/);
 await db.query("UPDATE courses SET image_path='/uploads/later-edit.webp' WHERE id=$1",[data.courseId]);
 assert.equal((await updateAiLicenceCover(pool,data,options)).alreadyApplied,true);
 assert.equal((await db.query('SELECT image_path FROM courses WHERE id=$1',[data.courseId])).rows[0].image_path,'/uploads/later-edit.webp');
});
