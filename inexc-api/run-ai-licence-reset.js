// Explicit operator command. Importing this file never starts a web server or other workers.
import pg from 'pg';
import {setupRegistrationDeletion} from './registration-deletion.js';
import {resetAiLicenceRegistrations,resetSummary} from './ai-licence-reset.js';
const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
try{
 const mode=process.argv[2];if(!['--apply','--status'].includes(mode))throw Error('Use --apply or --status.');
 if(mode==='--apply'){
  if(!String(process.env.RESEND_API_KEY||'').trim())throw Error('Mail is not configured. Nothing was deleted.');
  await setupRegistrationDeletion(pool);
  console.log(JSON.stringify(await resetAiLicenceRegistrations(pool),null,2));
  console.log('The selected earlier registrations were removed and archived. One apology per email is queued in the existing message center; existing suppression preferences remain enforced. Later registrations are preserved.');
 }
 console.log(JSON.stringify(await resetSummary(pool),null,2));
}catch(error){console.error('Course registration operation stopped:',error.message);process.exitCode=1}finally{await pool.end()}
