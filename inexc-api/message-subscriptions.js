import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { normalizeEmail, blockedEmails } from './message-suppression.js';
import { validEmail } from './message-studio.js';
import { escapeMail } from './message-mail.js';
import { subscriptionDefaults, subscriptionSettings, subscriptionUrl } from './message-subscription-links.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const accepted = {ok:true,message:'إذا كان البريد مؤهلًا للاشتراك، فستصلك رسالة تأكيد. تحقق من الوارد والبريد غير المرغوب فيه. إذا سبق أن أكدت اشتراكك فلا تحتاج إلى تأكيد جديد.'};
export async function setupMessageSubscriptions(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS message_subscription_settings(id INTEGER PRIMARY KEY CHECK(id=1),value JSONB NOT NULL DEFAULT '{}');
    INSERT INTO message_subscription_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
    ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS subscription_code TEXT NOT NULL DEFAULT gen_random_uuid()::text;
    CREATE UNIQUE INDEX IF NOT EXISTS message_campaign_subscription_code ON email_campaigns(subscription_code);
    CREATE TABLE IF NOT EXISTS message_subscriptions(
      email TEXT PRIMARY KEY CHECK(email=lower(trim(email))), full_name TEXT NOT NULL DEFAULT '',
      token_hash TEXT UNIQUE, expires_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ,
      campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
      consent_text TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ,
      consent_version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS message_subscriptions_campaign ON message_subscriptions(campaign_id);
    CREATE TABLE IF NOT EXISTS message_subscription_limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS message_subscription_group(id INTEGER PRIMARY KEY CHECK(id=1),list_id UUID REFERENCES message_recipient_lists(id) ON DELETE SET NULL);
    INSERT INTO message_subscription_group(id) VALUES(1) ON CONFLICT DO NOTHING;
  `);
}
export async function subscriptionList(db) {
  const row=(await db.query('SELECT list_id FROM message_subscription_group WHERE id=1 FOR UPDATE')).rows[0];
  if(row?.list_id) return row.list_id;
  const id=(await db.query("INSERT INTO message_recipient_lists(name) VALUES('مشتركو الرسائل — اشتراك مؤكد') RETURNING id")).rows[0].id;
  await db.query('UPDATE message_subscription_group SET list_id=$1 WHERE id=1',[id]);
  return id;
}
export function installMessageSubscriptions({app,pool,auth,sendEmail,mailEnabled,publicOrigin='https://www.inexctraining.com'}) {
  const settings=async()=>subscriptionSettings((await pool.query('SELECT value FROM message_subscription_settings WHERE id=1')).rows[0]?.value);
  const tx=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release()}};
  const route=(method,path,handler,admin=false)=>app[method](path,...(admin?[auth]:[]),async(req,res)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    try{await handler(req,res)}catch(e){const status=e.status>=400&&e.status<500?e.status:503;res.status(status).json({error:status===503?'تعذر إكمال الطلب الآن. أعد المحاولة لاحقًا.':e.message});}
  });
  async function limit(key,max,seconds,db=pool){
    const r=(await db.query(`INSERT INTO message_subscription_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second')
      ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN message_subscription_limits.expires_at<=now() THEN 1 ELSE message_subscription_limits.hits+1 END,
      expires_at=CASE WHEN message_subscription_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE message_subscription_limits.expires_at END RETURNING hits`,[key,seconds])).rows[0];
    if(r.hits>max)throw fail('طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.',429);
  }
  async function campaign(source){return (await pool.query('SELECT id,subscription_code FROM email_campaigns WHERE subscription_code=$1',[String(source||'').slice(0,36)])).rows[0]||null;}
  route('get','/api/message-subscriptions/config',async(_req,res)=>res.json({settings:await settings(),available:mailEnabled,version:1}));
  route('post','/api/message-subscriptions/request',async(req,res)=>{
    const config=await settings();if(!config.enabled||!mailEnabled)throw fail('الاشتراك غير متاح الآن. يرجى المحاولة لاحقًا.',503);
    const email=normalizeEmail(req.body?.email),name=String(req.body?.name||'').trim().slice(0,160);
    if(!validEmail(email))throw fail('أدخل بريدًا إلكترونيًا صحيحًا.');
    if(req.body?.consent!==true)throw fail('يرجى الموافقة على استقبال الرسائل.');
    if(req.body?.website)return res.status(202).json(accepted);
    // Never trust caller-supplied forwarding headers. IP limits may be shared behind a proxy.
    await limit('ip:'+digest(String(req.ip)),120,900);
    await pool.query('DELETE FROM message_subscription_limits WHERE expires_at<now()-interval \'1 day\'');
    if((await blockedEmails(pool,[email])).has(email))return res.status(202).json(accepted);
    const source=await campaign(req.body.source),token=crypto.randomBytes(32).toString('hex'),hash=digest(token);
    const reserved=await tx(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[email]);
      if((await blockedEmails(db,[email],false)).has(email))return false;
      const existing=(await db.query('SELECT * FROM message_subscriptions WHERE email=$1 FOR UPDATE',[email])).rows[0];
      if(existing?.confirmed_at||(existing?.sent_at&&Date.now()-new Date(existing.sent_at).getTime()<3600000))return false;
      await limit('email:'+digest(email),3,86400,db);await limit('global',2000,86400,db);
      await db.query(`INSERT INTO message_subscriptions(email,full_name,token_hash,expires_at,campaign_id,consent_text,sent_at)
        VALUES($1,$2,$3,now()+interval '24 hours',$4,$5,now()) ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,
        token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,campaign_id=EXCLUDED.campaign_id,
        consent_text=EXCLUDED.consent_text,requested_at=now(),sent_at=now()`,[email,name,hash,source?.id||null,config.consentLabel]);
      return true;
    });
    if(reserved){
      // Atomic reservations prevent concurrent requests from generating duplicate emails.
      try{
        const url=subscriptionUrl('',false,publicOrigin)+'#confirm='+token;
        const html=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="margin:0;background:#f2f7ff;font-family:Tahoma,Arial,sans-serif;color:#353b44"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:580px;background:white;border-top:6px solid #0868ce"><tr><td dir="rtl" style="padding:32px;line-height:1.9"><p style="color:#0868ce;font-weight:bold">${escapeMail(config.brandName)}</p><h1 style="font-size:26px">${escapeMail(config.confirmationTitle)}</h1><p>${escapeMail(config.confirmationText)}</p><p><a href="${escapeMail(url)}" style="display:inline-block;padding:13px 24px;background:#0868ce;color:white;text-decoration:none;border-radius:8px">${escapeMail(config.confirmationButton)}</a></p><p style="font-size:13px;color:#626a76">هذا الرابط صالح لمدة 24 ساعة. لن يبدأ الاشتراك قبل تأكيدك.</p></td></tr></table></td></tr></table></body></html>`;
        const result=await sendEmail({to:email,marketing:true,subject:config.emailSubject,html,text:config.confirmationText+'\n\n'+url+'\nالرابط صالح لمدة 24 ساعة.',idempotencyKey:'subscription/'+hash});
        if(!result?.id)throw Error('Provider did not accept confirmation');
      }catch(e){
        // Keep a cooldown even on uncertain provider outcomes. Never retry automatically.
        if(e.code==='EMAIL_SUPPRESSED')return res.status(202).json(accepted);
        throw fail('تعذر إرسال التأكيد الآن. أعد المحاولة بعد ساعة.',503);
      }
    }
    res.status(202).json(accepted);
  });
  route('post','/api/message-subscriptions/confirm',async(req,res)=>{
    await limit('confirm:'+digest(String(req.ip)),240,900);
    const token=String(req.body?.token||'');if(!/^[a-f\d]{64}$/.test(token))throw fail('رابط التأكيد غير صالح أو انتهت صلاحيته.');
    const result=await tx(async db=>{
      const found=(await db.query('SELECT email FROM message_subscriptions WHERE token_hash=$1',[digest(token)])).rows[0];
      if(!found)throw fail('رابط التأكيد غير صالح أو انتهت صلاحيته.');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[found.email]);
      const record=(await db.query('SELECT * FROM message_subscriptions WHERE token_hash=$1 FOR UPDATE',[digest(token)])).rows[0];
      if(!record)throw fail('رابط التأكيد غير صالح أو انتهت صلاحيته.');
      if((await blockedEmails(db,[record.email])).has(record.email))throw fail('تعذر تفعيل الاشتراك لهذا الرابط.');
      if(record.confirmed_at)return {ok:true,alreadyConfirmed:true};
      if(!record.expires_at||new Date(record.expires_at)<=new Date())throw fail('انتهت صلاحية الرابط. ابدأ طلب اشتراك جديدًا.');
      if(!(await settings()).enabled)throw fail('الاشتراك غير متاح الآن.',503);
      const contact=(await db.query(`INSERT INTO message_contacts(full_name,email,normalized_email,language,tags,source)
        VALUES($1,$2,$2,'ar',ARRAY['اشتراك مؤكد'],'رابط الاشتراك') ON CONFLICT(normalized_email) WHERE normalized_email<>''
        DO UPDATE SET tags=ARRAY(SELECT DISTINCT unnest(message_contacts.tags||ARRAY['اشتراك مؤكد'])),updated_at=now() RETURNING id`,[record.full_name,record.email])).rows[0];
      if(!contact)throw fail('تعذر تفعيل الاشتراك لهذا الرابط.');
      const listId=await subscriptionList(db);
      await db.query('INSERT INTO message_recipient_list_members(list_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[listId,contact.id]);
      await db.query('UPDATE message_subscriptions SET confirmed_at=now() WHERE email=$1',[record.email]);
      return {ok:true};
    });res.json(result);
  });
  const prefix='/api/admin/message-studio/subscriptions';
  route('get',prefix,async(_req,res)=>{
    const config=await settings();
    const stats=(await pool.query(`SELECT count(*) FILTER(WHERE s.confirmed_at IS NOT NULL AND b.email IS NULL)::int AS confirmed,
      count(*) FILTER(WHERE s.confirmed_at IS NULL AND s.expires_at>now() AND b.email IS NULL)::int AS pending,
      count(*) FILTER(WHERE s.confirmed_at IS NULL AND s.expires_at<=now() AND b.email IS NULL)::int AS expired,
      count(*) FILTER(WHERE b.email IS NOT NULL)::int AS blocked FROM message_subscriptions s LEFT JOIN message_suppressions b ON b.email=s.email`)).rows[0];
    const campaigns=(await pool.query(`SELECT c.id,c.subject,c.subscription_code,c.created_at,
      count(s.email) FILTER(WHERE s.confirmed_at IS NOT NULL AND b.email IS NULL)::int AS confirmed,
      count(s.email) FILTER(WHERE s.confirmed_at IS NULL AND s.expires_at>now() AND b.email IS NULL)::int AS pending
      FROM email_campaigns c LEFT JOIN message_subscriptions s ON s.campaign_id=c.id LEFT JOIN message_suppressions b ON b.email=s.email
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`)).rows.map(c=>({...c,url:subscriptionUrl(c.subscription_code,false,publicOrigin)}));
    const recent=(await pool.query(`SELECT s.email,s.full_name,s.requested_at,s.confirmed_at,c.subject,
      CASE WHEN b.email IS NOT NULL THEN 'blocked' WHEN s.confirmed_at IS NOT NULL THEN 'confirmed' WHEN s.expires_at<=now() THEN 'expired' ELSE 'pending' END AS status
      FROM message_subscriptions s LEFT JOIN message_suppressions b ON b.email=s.email LEFT JOIN email_campaigns c ON c.id=s.campaign_id ORDER BY s.requested_at DESC LIMIT 50`)).rows;
    res.json({settings:config,stats,campaigns,recent,url:subscriptionUrl('',false,publicOrigin),listId:(await pool.query('SELECT list_id FROM message_subscription_group WHERE id=1')).rows[0]?.list_id,mailEnabled});
  },true);
  route('put',prefix+'/settings',async(req,res)=>{const config=subscriptionSettings(req.body);await pool.query('UPDATE message_subscription_settings SET value=$1 WHERE id=1',[config]);res.json({settings:config});},true);
  route('get',prefix+'/qr',async(req,res)=>{const c=await campaign(req.query.source);const url=subscriptionUrl(c?.subscription_code||'',false,publicOrigin);res.set({'Content-Type':'image/svg+xml','Content-Disposition':'attachment; filename="inexc-subscribe-qr.svg"'}).send(await QRCode.toString(url,{type:'svg',errorCorrectionLevel:'M',margin:4,width:600,color:{dark:'#0868ce',light:'#ffffff'}}));},true);
}
