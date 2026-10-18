// Run explicitly for one already confirmed registration after reviewing the requested fee.
import pg from 'pg';
import {repairRequestedCertificate} from './certificate-requests.js';
const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
try{
 if(!String(process.env.RESEND_API_KEY||'').trim())throw Error('Email delivery is not configured; no request was repaired.');
 const amount=process.env.INEXC_REPAIR_AMOUNT;
 if(!/^\d+(\.\d{1,2})?$/.test(amount||''))throw Error('A reviewed nonnegative certificate fee is required.');
 const result=await repairRequestedCertificate(pool,{reference:process.env.INEXC_REPAIR_REFERENCE,email:process.env.INEXC_REPAIR_EMAIL,courseId:process.env.INEXC_REPAIR_COURSE,expectedAmount:Number(amount)});
 console.log(JSON.stringify(result));
 console.log(result.created?'Existing registration repaired. Its requested certificate email is due now and will be processed by the normal mail worker. No new booking or card debit was made.':'This registration already has a certificate request. Its payment and email state were preserved; no duplicate was queued.');
}catch(error){console.error('Certificate repair stopped:',error.message);process.exitCode=1}finally{await pool.end()}
