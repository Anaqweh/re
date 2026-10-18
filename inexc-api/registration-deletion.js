// Administrator deletion only. Keep an audit copy and return card units atomically.
const uuid=value=>/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(value||''));
const fail=(message,status=409)=>Object.assign(new Error(message),{status});

export async function setupRegistrationDeletion(db){
 await db.query(`CREATE TABLE IF NOT EXISTS registration_deletions (
  registration_id UUID PRIMARY KEY, batch TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL,
  snapshot JSONB NOT NULL, restored_units INTEGER NOT NULL DEFAULT 0, deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS registration_reset_batches (
  batch TEXT PRIMARY KEY, course_id UUID NOT NULL, cutoff TIMESTAMPTZ NOT NULL,
  campaign_id UUID, deleted_count INTEGER NOT NULL DEFAULT 0, recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
}

// The caller owns this transaction. Check the whole selection before removing any row.
export async function deleteRegistrationRows(db,ids,{batch='',reason='حذف التسجيل من لوحة الإدارة'}={}){
 if(!Array.isArray(ids)||ids.some(id=>!uuid(id)))throw fail('معرّف التسجيل غير صالح.',400);
 ids=[...new Set(ids)].sort();if(!ids.length)return {deleted:0,restoredUnits:0,registrations:[]};
 const initial=(await db.query('SELECT id,membership_card_id FROM registrations WHERE id=ANY($1::uuid[])',[ids])).rows;
 const linked=(await db.query('SELECT card_id FROM membership_redemptions WHERE registration_id=ANY($1::uuid[])',[ids])).rows;
 const cardIds=[...new Set([...initial.map(r=>r.membership_card_id),...linked.map(r=>r.card_id)].filter(Boolean))].sort();
 // Match card checkout's card-before-registration locking order.
 const cards=(await db.query('SELECT id,units_total,units_remaining FROM membership_cards WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[cardIds])).rows;
 const checkouts=(await db.query('SELECT * FROM stripe_checkouts WHERE registration_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
 const requests=(await db.query('SELECT * FROM certificate_requests WHERE registration_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
 const rows=(await db.query('SELECT * FROM registrations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
 if(rows.length!==ids.length)throw fail('أحد التسجيلات غير موجود أو حُذف مسبقًا. حدّث القائمة.',404);
 const attempts=requests.length?(await db.query('SELECT * FROM certificate_payment_attempts WHERE request_id=ANY($1::uuid[]) FOR UPDATE',[requests.map(r=>r.id)])).rows:[];
 const certificates=(await db.query('SELECT * FROM learner_certificates WHERE registration_id=ANY($1::uuid[])',[ids])).rows;
 const progress=(await db.query('SELECT * FROM learner_progress WHERE registration_id=ANY($1::uuid[])',[ids])).rows;
 const redemptions=(await db.query('SELECT * FROM membership_redemptions WHERE registration_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
 for(const row of rows){
  const request=requests.find(q=>q.registration_id===row.id);
  // Payment-linked records need explicit financial review; deletion never refunds money or erases payment evidence.
  if(checkouts.some(c=>c.registration_id===row.id)||attempts.some(a=>a.request_id===request?.id)||request?.state==='paid'||row.certificate_fee_status==='paid'||(Number(row.total)>0&&['مدفوع','مؤكد'].includes(row.status))||row.receipt_path||certificates.some(c=>c.registration_id===row.id))throw fail('التسجيل '+row.reference+' مرتبط بدفع أو إيصال أو شهادة صادرة؛ يلزم مراجعته قبل الحذف. لم تُحذف أي تسجيلات.');
  if(request?.email_status==='sending'&&request.email_locked_until&&new Date(request.email_locked_until)>new Date())throw fail('تُرسل رسالة شهادة للتسجيل '+row.reference+' الآن. انتظر دقيقة ثم أعد المحاولة.');
  if(row.payment_method==='membership'&&(!row.membership_card_id||!redemptions.some(r=>r.registration_id===row.id)||redemptions.some(r=>r.registration_id===row.id&&r.card_id!==row.membership_card_id)))throw fail('تعذّر مطابقة البطاقة وسجل الخصم للتسجيل '+row.reference+'. راجع السجل قبل الحذف.');
  if(row.membership_redemption_id&&!redemptions.some(r=>r.id===row.membership_redemption_id&&r.registration_id===row.id))throw fail('تعذّر مطابقة رصيد البطاقة للتسجيل '+row.reference+'. راجع السجل قبل الحذف.');
 }
 const refunds=new Map();
 for(const redemption of redemptions.filter(r=>r.status==='used')){
  const units=Number(redemption.units_used);if(!Number.isInteger(units)||units<=0)throw fail('تعذّر تحديد الرصيد المراد إعادته.');
  refunds.set(redemption.card_id,(refunds.get(redemption.card_id)||0)+units);
 }
 for(const [id,units] of refunds){const card=cards.find(c=>c.id===id);if(!card||Number(card.units_remaining)+units>Number(card.units_total))throw fail('تحتاج أرصدة البطاقات إلى مراجعة قبل الحذف. لم تُحذف أي تسجيلات.');}
 for(const row of rows){
  const request=requests.find(q=>q.registration_id===row.id),{access_token,...requestAudit}=request||{};
  const entries=redemptions.filter(d=>d.registration_id===row.id),units=entries.filter(d=>d.status==='used').reduce((n,d)=>n+Number(d.units_used),0);
  await db.query('INSERT INTO registration_deletions(registration_id,batch,reason,snapshot,restored_units) VALUES($1,$2,$3,$4::jsonb,$5)',[row.id,batch,reason,JSON.stringify({registration:row,certificateRequest:request?requestAudit:null,progress:progress.find(p=>p.registration_id===row.id)||null,redemptions:entries}),units]);
 }
 for(const [id,units] of refunds)await db.query('UPDATE membership_cards SET units_remaining=units_remaining+$1,updated_at=now() WHERE id=$2',[units,id]);
 await db.query("UPDATE membership_redemptions SET status=CASE WHEN status='used' THEN 'reversed' ELSE status END,registration_id=NULL WHERE registration_id=ANY($1::uuid[])",[ids]);
 // Pending certificate requests and progress cascade. Issued certificates/payment attempts were refused above.
 await db.query('DELETE FROM registrations WHERE id=ANY($1::uuid[])',[ids]);
 return {deleted:rows.length,restoredUnits:[...refunds.values()].reduce((a,b)=>a+b,0),registrations:rows};
}

export async function deleteRegistration(pool,id){
 if(!uuid(id))throw fail('معرّف التسجيل غير صالح.',400);
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='10s'");
  if(!(await db.query('SELECT id FROM registrations WHERE id=$1',[id])).rowCount){
   const old=(await db.query('SELECT restored_units FROM registration_deletions WHERE registration_id=$1',[id])).rows[0];
   if(!old)throw fail('طلب التسجيل غير موجود.',404);
   await db.query('COMMIT');return {ok:true,deleted:0,alreadyDeleted:true,restoredUnits:0};
  }
  const result=await deleteRegistrationRows(db,[id]);await db.query('COMMIT');
  return {ok:true,deleted:result.deleted,restoredUnits:result.restoredUnits};
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
