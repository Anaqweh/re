// Read-only operator audit. Does not import server.js, write rows, or send messages.
import pg from 'pg';
import {STRIPE_API_VERSION} from './stripe-payments.js';
const [linkId,courseId]=process.argv.slice(2),secret=String(process.env.STRIPE_SECRET_KEY||'').trim();
if(!/^plink_[A-Za-z0-9]+$/.test(linkId||'')||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(courseId||''))throw Error('Pass a payment link ID and course UUID.');
if(!/^(sk|rk)_live_/.test(secret))throw Error('A live Stripe key is required for this read-only audit.');
async function stripe(route,params={}){
 const r=await fetch('https://api.stripe.com/v1/'+route+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+secret,'Stripe-Version':STRIPE_API_VERSION},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Object.assign(Error('Stripe read failed'),{code:'STRIPE_HTTP_'+r.status});return r.json();
}
const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});let db;
try{
 const link=await stripe('payment_links/'+linkId);if(link.livemode!==true)throw Error('Unexpected Stripe mode');
 const sessions=[];let cursor='';
 for(let page=0;page<20;page++){const r=await stripe('checkout/sessions',{payment_link:linkId,status:'complete',limit:'100',...(cursor?{starting_after:cursor}:{})});if(!Array.isArray(r.data))throw Error('Invalid Stripe response');sessions.push(...r.data);if(!r.has_more)break;if(!r.data.length||page===19)throw Error('Pagination limit reached; audit incomplete');cursor=r.data.at(-1).id;}
 const verified=[];for(const s of sessions){if(s.livemode!==true||s.payment_link!==linkId||s.payment_status!=='paid')continue;const intent=typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id;if(!/^pi_[A-Za-z0-9]+$/.test(intent||''))continue;const p=await stripe('payment_intents/'+intent,{'expand[]':'latest_charge'});verified.push({session:s,intent:p});}
 db=await pool.connect();await db.query('BEGIN READ ONLY');
 const course=(await db.query('SELECT id,name,certificate_name,certificate_price FROM courses WHERE id=$1',[courseId])).rows[0];if(!course)throw Error('Course not found');
 const report=[];
 for(const {session:s,intent:p} of verified){
  const email=String(s.customer_details?.email||s.customer_email||'').trim().toLowerCase();
  const matches=email?(await db.query(`SELECT r.id,r.reference,r.name,r.email,r.status,r.certificate,r.certificate_fee_amount,r.certificate_fee_status,q.id AS certificate_request_id,q.amount AS request_amount_fils,q.state AS request_state,q.payment_intent AS recorded_payment_intent,q.paid_at FROM registrations r LEFT JOIN certificate_requests q ON q.registration_id=r.id WHERE r.course_id=$1 AND lower(btrim(r.email))=$2 ORDER BY r.created_at DESC`,[courseId,email])).rows:[];
  const linked=(await db.query('SELECT id,registration_id,state FROM certificate_requests WHERE payment_intent=$1',[p.id])).rows;
  report.push({sessionId:s.id,paymentIntent:p.id,paidAt:p.latest_charge?.created?new Date(p.latest_charge.created*1000).toISOString():null,email,payerName:s.customer_details?.name,amountFils:p.amount_received,currency:p.currency,paymentStatus:p.status,refundedFils:p.latest_charge?.amount_refunded??null,disputed:p.latest_charge?.disputed??null,metadata:s.metadata,clientReference:s.client_reference_id,alreadyLinked:linked,matchingRegistrations:matches,matchCount:matches.length});
 }
 await db.query('ROLLBACK');
 console.log(JSON.stringify({audit:'READ_ONLY_NO_CHANGES',course,paymentLink:{id:link.id,url:link.url,active:link.active,metadata:link.metadata},paidSessionCount:report.length,payments:report},null,2));
}catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});console.error('Audit stopped without changes. '+(e.code||e.message||'Unknown error'));process.exitCode=1}finally{db?.release();await pool.end()}
