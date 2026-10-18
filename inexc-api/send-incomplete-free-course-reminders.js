import pg from 'pg';
import {blockedEmails} from './message-suppression.js';

const mode=process.argv[2];
if(!['--preview','--send'].includes(mode))throw Error('Usage: node send-incomplete-free-course-reminders.js --preview|--send');
const pool=new pg.Pool({host:process.env.PGHOST||'db',port:Number(process.env.PGPORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
const campaign='free-course-booking-instructions-v1';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const base='https://www.inexctraining.com';
const button=(href,label,color='#0866c6')=>`<a href="${escape(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;border-radius:10px;padding:12px 19px;font-size:14px;font-weight:bold;margin:6px 0">${label}</a>`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function message(person){
  const courseUrl=`${base}/cards/free-course/?plan=${encodeURIComponent(person.plan_id)}`;
  const cardUrl=`${base}/my-card/?token=${encodeURIComponent(person.access_token)}`;
  const accountUrl=`${base}/account.html`;
  const subject='أكمل حجز دورتك المجانية باستخدام بطاقتك | INEXC Training';
  const content=`<p style="margin-top:0">مرحبًا <strong>${escape(person.holder_name)}</strong>،</p>
    <p>تم تسجيلك في <strong>${escape(person.plan_name)}</strong> وإصدار بطاقتك بنجاح. هذه <strong>الخطوة الأولى فقط</strong>؛ لا يُعدّ تسجيلك في الدورة مكتملًا حتى تختار الدورة وتؤكد الحجز باستخدام بطاقتك.</p>
    <div style="background:#fff8e8;border:1px solid #f1db9e;border-radius:12px;padding:14px 18px;margin:18px 0;color:#654a16"><strong>تنبيه:</strong> لم يظهر لدينا حجز دورة مكتمل مرتبط بهذه البطاقة. الدورة مجانية ولا يُطلب منك دفع أي مبلغ للتسجيل فيها.</div>
    <h2 style="font-size:19px;color:#103b70;margin:25px 0 12px">أكمل تسجيلك في 3 خطوات</h2>
    <p><strong>١. افتح صفحة الدورة المجانية</strong><br>اضغط الزر، ثم اختر <strong>${escape(person.course_name)}</strong> أو الدورة المجانية التي تناسبك من القائمة.<br>${button(courseUrl,'🎓 &nbsp;افتح صفحة التسجيل في الدورة')}</p>
    <p><strong>٢. أدخل رقم البطاقة والبريد الإلكتروني</strong><br>استخدم البريد الذي وصلتك عليه هذه الرسالة ورقم البطاقة التالي:</p>
    <div dir="ltr" style="direction:ltr;text-align:center;background:#f0f7ff;border:1px solid #cfe1f5;border-radius:12px;padding:12px;margin:12px 0;color:#103b70;font-size:19px;font-weight:bold">${escape(person.card_number)}</div>
    <p style="margin-top:0">إذا احتجت رؤية البطاقة، افتحها من الزر الآتي:<br>${button(cardUrl,'🪪 &nbsp;عرض بطاقتي','#285578')}</p>
    <p><strong>٣. أكّد الحجز</strong><br>بعد التحقق من البطاقة، اقرأ شرط مشاركة رابطها، ثم اضغط <strong>«موافق، أكّد تسجيلي»</strong>. عند اكتمال العملية يظهر رقم تسجيل الدورة وتصل رسالة تأكيد منفصلة إلى بريدك.</p>
    <div style="text-align:center;margin:22px 0">${button(courseUrl,'أكمل تسجيل الدورة الآن')}</div>
    <p style="font-size:13px;color:#526b83">يمكنك متابعة دوراتك من ${button(accountUrl,'👤 &nbsp;صفحتي التدريبية','#e7f2ff').replace('color:#fff','color:#075aaf')} باستخدام البريد ورقم البطاقة. إذا واجهتك مشكلة، <a href="https://wa.me/971543475500" style="color:#075aaf">تواصل معنا عبر واتساب</a>.</p>
    <p style="font-size:12px;color:#6d8297">احتفظ برقم البطاقة ورابطها الخاص لنفسك. مشاركة رابط البطاقة العام تتم من صفحة البطاقة.</p>`;
  const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#eef5fc;color:#17324d;font:15px/1.9 Tahoma,Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">تسجيل الباقة خطوة أولى؛ أكمل الآن حجز دورتك المجانية ببطاقتك.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef5fc;padding:22px 10px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border-radius:16px;overflow:hidden"><tr><td align="center" style="background:#0754a2;color:#fff;padding:24px;text-align:center"><strong style="font-size:21px">INEXC TRAINING</strong><br><span style="font-size:13px">شركة التميز الابتكاري للتعليم والتدريب</span></td></tr><tr><td dir="rtl" style="padding:26px;text-align:right">${content}</td></tr><tr><td style="background:#f7fbff;border-top:1px solid #dceafb;padding:16px;text-align:center;color:#62798f;font-size:11px">هذه رسالة إرشادية لإكمال حجز دورتك من INEXC Training.</td></tr></table></td></tr></table></body></html>`;
  const text=`مرحبًا ${person.holder_name}،\nتم تسجيلك في ${person.plan_name} وإصدار بطاقتك. هذه الخطوة الأولى فقط؛ لم يكتمل حجز الدورة. الدورة مجانية ولا يلزم دفع أي مبلغ.\n\n١. افتح صفحة الدورة واختر ${person.course_name}: ${courseUrl}\n٢. أدخل رقم البطاقة ${person.card_number} والبريد الذي وصلتك عليه هذه الرسالة. عرض البطاقة: ${cardUrl}\n٣. اقرأ شرط مشاركة الرابط واضغط «موافق، أكّد تسجيلي». سيظهر رقم التسجيل وتصل رسالة تأكيد منفصلة.\n\nصفحتك التدريبية: ${accountUrl}\nمساعدة واتساب: https://wa.me/971543475500\nاحتفظ برقم البطاقة ورابطها الخاص لنفسك.`;
  return {subject,html,text};
}

async function candidates(){
  const result=await pool.query(`SELECT c.id,c.card_number,c.access_token,c.plan_id,c.holder_name,lower(trim(c.holder_email)) AS email,p.name AS plan_name,
      (SELECT co.name FROM courses co WHERE co.active=true AND co.price=0 AND co.membership_enabled=true AND (co.membership_plan_ids IS NULL OR p.id=ANY(co.membership_plan_ids)) ORDER BY CASE WHEN co.name ILIKE '%الرخصة الدولية%الذكاء الاصطناعي%' THEN 0 ELSE 1 END,co.updated_at DESC LIMIT 1) AS course_name
    FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id
    WHERE p.price_usd=0 AND p.active=true AND c.status='active' AND c.deleted_at IS NULL AND c.expires_at>now() AND c.units_remaining>0
      AND EXISTS(SELECT 1 FROM courses co WHERE co.active=true AND co.price=0 AND co.membership_enabled=true AND (co.membership_plan_ids IS NULL OR p.id=ANY(co.membership_plan_ids)))
      AND NOT EXISTS(SELECT 1 FROM membership_redemptions d JOIN registrations r ON r.id=d.registration_id WHERE d.card_id=c.id AND d.status='used' AND r.status<>'ملغى')
      AND NOT EXISTS(SELECT 1 FROM registrations r JOIN courses co ON co.id=r.course_id WHERE lower(trim(r.email))=lower(trim(c.holder_email)) AND r.status<>'ملغى' AND co.price=0 AND co.membership_enabled=true AND (co.membership_plan_ids IS NULL OR p.id=ANY(co.membership_plan_ids)))
      AND NOT EXISTS(SELECT 1 FROM message_suppressions s WHERE s.email=lower(trim(c.holder_email)))
      AND NOT EXISTS(SELECT 1 FROM free_course_reminder_deliveries d WHERE d.card_id=c.id AND d.campaign=$1)
    ORDER BY c.activated_at ASC`,[campaign]);
  const emails=new Set();
  return result.rows.filter(row=>{if(emails.has(row.email))return false;emails.add(row.email);return true;});
}

async function main(){
  if(mode==='--send'&&!process.env.RESEND_API_KEY)throw Error('RESEND_API_KEY is missing; no email was sent.');
  await pool.query(`CREATE TABLE IF NOT EXISTS free_course_reminder_deliveries (
    card_id UUID NOT NULL REFERENCES membership_cards(id) ON DELETE CASCADE,campaign TEXT NOT NULL,
    email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'attempted',resend_email_id TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),sent_at TIMESTAMPTZ,
    PRIMARY KEY(card_id,campaign))`);
  const rows=await candidates();
  console.log(`${mode==='--preview'?'Eligible':'Sending to'}: ${rows.length} card(s).`);
  if(mode==='--preview')return;
  let sent=0,skipped=0;
  for(const person of rows){
    // Recheck against concurrent course registrations and both local and remote suppression immediately before sending.
    const stillEligible=(await candidates()).some(row=>row.id===person.id);
    if(!stillEligible){skipped++;continue;}
    if((await blockedEmails(pool,[person.email])).has(person.email)){skipped++;continue;}
    const claim=await pool.query(`INSERT INTO free_course_reminder_deliveries(card_id,campaign,email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING card_id`,[person.id,campaign,person.email]);
    if(!claim.rowCount){skipped++;continue;}
    const payload=message(person);
    try{
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`${campaign}-${person.id}`},body:JSON.stringify({from:process.env.EMAIL_FROM||'INEXC Training <registrations@inexctraining.com>',to:[person.email],...payload}),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(`Resend HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
      const data=await response.json();
      await pool.query(`UPDATE free_course_reminder_deliveries SET status='sent',resend_email_id=$3,sent_at=now() WHERE card_id=$1 AND campaign=$2`,[person.id,campaign,data.id||'']);
      sent++;
      console.log(`Sent ${sent}/${rows.length}`);
      await pause(650);
    }catch(error){
      await pool.query(`UPDATE free_course_reminder_deliveries SET status='failed',error=$3 WHERE card_id=$1 AND campaign=$2`,[person.id,campaign,String(error.message).slice(0,500)]);
      console.error(`Stopped after ${sent} successful sends; review the delivery ledger before retrying: ${error.message}`);
      process.exitCode=1;
      break;
    }
  }
  console.log(`Completed: sent=${sent}, skipped=${skipped}.`);
}

try{await main();}finally{await pool.end();}
