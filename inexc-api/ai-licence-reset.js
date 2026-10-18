import {deleteRegistrationRows} from './registration-deletion.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const RESET={batch:'ai-licence-registration-reset-20261018-170251',courseId:'ea14c5bd-ab64-4e77-8b1b-b5c09aa8eed0',courseName:'الرخصة الدولية لقيادة الذكاء الاصطناعي في التعليم',cutoff:'2026-10-18T17:02:51.000Z'};
export const resetSubject='اعتذار وتوضيح بشأن التسجيل في دورة الرخصة الدولية لقيادة الذكاء الاصطناعي';
export function resetMessage(name){
 const paragraphs=[`الأستاذ/ة ${name}،`,'السلام عليكم ورحمة الله وبركاته،',`نعتذر لكم عن حذف تسجيلكم السابق في دورة «${RESET.courseName}»، إذ لم تكن الإجراءات الإدارية وآلية التسجيل الخاصة بالدورة واضحة ومكتملة عند استقبال التسجيلات.`, 'حرصًا على تنظيم التسجيل وتوحيد التعليمات، ألغينا التسجيل السابق. وإذا كنتم مشتركين في قائمتنا البريدية، فستصلكم رسالة تتضمن التعليمات والخطوات الصحيحة للتسجيل.', 'نقدّر تفهّمكم، ونعتذر عن أي إرباك تسبب فيه هذا الإجراء.','مع خالص التقدير،\nفريق INEXC Training\nالتميز الابتكاري للتعليم والتدريب'];
 const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f6fc;color:#213d58;font-family:Tahoma,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#fff;border:1px solid #dce8f5;border-radius:16px;overflow:hidden"><tr><td style="background:#103b70;padding:25px 28px;text-align:right;color:#fff"><span dir="ltr" style="font-size:23px;font-weight:bold">INEXC</span><div style="font-size:13px;margin-top:7px;color:#d5eaff">شؤون المتدربين</div></td></tr><tr><td dir="rtl" style="padding:28px;text-align:right;line-height:2;font-size:16px"><h1 style="font-size:23px;line-height:1.7;color:#103b70;margin:0 0 22px">اعتذار وتوضيح بشأن تسجيلكم</h1>${paragraphs.map((p,i)=>`<p style="margin:0 0 18px;${i===3?'padding:16px;background:#f0f7ff;border-right:3px solid #0866c6;border-radius:8px;':''}">${esc(p).replaceAll('\n','<br>')}</p>`).join('')}</td></tr><tr><td style="text-align:center;padding:18px;border-top:1px solid #e2edf7;font-size:13px;color:#4d6883"><a href="https://www.inexctraining.com/" style="color:#0866c6;text-decoration:none" dir="ltr">www.inexctraining.com</a></td></tr></table></td></tr></table></body></html>`;
 return {subject:resetSubject,html,text:paragraphs.join('\n\n')};
}

export async function resetAiLicenceRegistrations(pool){
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='10s'");
  const claim=await db.query('INSERT INTO registration_reset_batches(batch,course_id,cutoff) VALUES($1,$2,$3) ON CONFLICT(batch) DO NOTHING RETURNING batch',[RESET.batch,RESET.courseId,RESET.cutoff]);
  if(!claim.rowCount){const old=(await db.query('SELECT * FROM registration_reset_batches WHERE batch=$1',[RESET.batch])).rows[0];await db.query('COMMIT');return {alreadyApplied:true,deleted:old.deleted_count,recipients:old.recipient_count,campaignId:old.campaign_id};}
  const course=(await db.query('SELECT name,price FROM courses WHERE id=$1',[RESET.courseId])).rows[0];
  if(!course||course.name!==RESET.courseName||Number(course.price)!==0)throw Error('Expected free AI licence course was not found. No changes applied.');
  const ids=(await db.query('SELECT id FROM registrations WHERE course_id=$1 AND created_at<=$2 ORDER BY id',[RESET.courseId,RESET.cutoff])).rows.map(r=>r.id);
  const result=await deleteRegistrationRows(db,ids,{batch:RESET.batch,reason:'إعادة تنظيم التسجيل بعد توضيح الإجراءات الإدارية للدورة'});
  const recipients=new Map();for(const row of result.registrations){const email=row.email.trim().toLowerCase();if(!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email))throw Error('A registration has an invalid email. No changes applied.');if(!recipients.has(email))recipients.set(email,row.name);}
  let campaignId=null;
  if(recipients.size){
   campaignId=(await db.query(`INSERT INTO email_campaigns(subject,body,audience,status,total_recipients,course_name,submission_key)
    VALUES($1,$2,'custom','queued',$3,$4,$5) RETURNING id`,[resetSubject,resetMessage('المشارك الكريم').text,recipients.size,RESET.courseName,RESET.batch])).rows[0].id;
   for(const [email,name] of recipients)await db.query("INSERT INTO email_deliveries(campaign_id,email,recipient_name,status,payload_snapshot) VALUES($1,$2,$3,'queued',$4::jsonb)",[campaignId,email,name,JSON.stringify(resetMessage(name))]);
  }
  await db.query('UPDATE registration_reset_batches SET campaign_id=$2,deleted_count=$3,recipient_count=$4 WHERE batch=$1',[RESET.batch,campaignId,result.deleted,recipients.size]);
  await db.query('COMMIT');return {alreadyApplied:false,deleted:result.deleted,restoredUnits:result.restoredUnits,recipients:recipients.size,campaignId};
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function resetSummary(db){
 const batch=(await db.query('SELECT * FROM registration_reset_batches WHERE batch=$1',[RESET.batch])).rows[0];if(!batch)return {applied:false};
 const campaign=batch.campaign_id?(await db.query('SELECT status FROM email_campaigns WHERE id=$1',[batch.campaign_id])).rows[0]:null;
 const deliveries=batch.campaign_id?(await db.query('SELECT status,count(*)::int AS count FROM email_deliveries WHERE campaign_id=$1 GROUP BY status',[batch.campaign_id])).rows:[];
 return {applied:true,deleted:batch.deleted_count,recipients:batch.recipient_count,campaignId:batch.campaign_id,campaignStatus:campaign?.status||'empty',deliveries:Object.fromEntries(deliveries.map(r=>[r.status,r.count]))};
}
