// Run inside the existing API container via node --input-type=module -.
// Local database reads only: no Stripe API calls, writes, emails or server startup.
import pg from 'pg';
const [courseId,...inputs]=process.argv.slice(2);
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const targets=inputs.map(value=>{const [email,intent,...extra]=value.split('=');if(extra.length||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^pi_[A-Za-z0-9]+$/.test(intent||''))throw Error('Pass email=payment_intent pairs.');return {email:email.trim().toLowerCase(),intent}});
if(!uuid.test(courseId||'')||!targets.length||targets.length>20)throw Error('Pass one course UUID and 1-20 email=payment_intent pairs.');
const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});let db;
try{
 db=await pool.connect();await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='10s'");
 const course=(await db.query('SELECT id,name,certificate_name,certificate_price FROM courses WHERE id=$1',[courseId])).rows[0];if(!course)throw Error('Course not found');
 const results=[];
 for(const {email,intent} of targets){
  const matches=(await db.query(`SELECT r.id,r.reference,r.name,r.email,r.status,r.certificate,r.certificate_fee_amount,r.certificate_fee_status,q.id AS certificate_request_id,q.amount AS request_amount_fils,q.state AS request_state,q.payment_intent AS recorded_payment_intent,q.paid_at FROM registrations r LEFT JOIN certificate_requests q ON q.registration_id=r.id WHERE r.course_id=$1 AND lower(btrim(r.email))=$2 ORDER BY r.created_at DESC LIMIT 100`,[courseId,email])).rows;
  const linked=(await db.query('SELECT id,registration_id,state FROM certificate_requests WHERE payment_intent=$1',[intent])).rows;
  results.push({email,paymentIntent:intent,matchCount:matches.length,matchingRegistrations:matches,alreadyLinked:linked});
 }
 await db.query('ROLLBACK');console.log(JSON.stringify({audit:'DATABASE_READ_ONLY_NO_CHANGES',course,results},null,2));
}catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});console.error('Audit stopped without changes. '+(e.code||e.message||'Unknown error'));process.exitCode=1}finally{db?.release();await pool.end()}
