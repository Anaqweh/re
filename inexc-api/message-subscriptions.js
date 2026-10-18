import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { normalizeEmail, blockedEmails } from './message-suppression.js';
import { validEmail } from './message-studio.js';
import { subscriptionSettings, subscriptionUrl } from './message-subscription-links.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const accepted = {ok:true,message:'تم استلام طلب الاشتراك. شكرًا لاهتمامك برسائل INEXC.'};
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
    ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMPTZ;
    ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;
    ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS signup_method TEXT NOT NULL DEFAULT 'verified';
    ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES message_contacts(id) ON DELETE SET NULL;
    ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS added_new_contact BOOLEAN;
    UPDATE message_subscriptions SET subscribed_at=confirmed_at WHERE subscribed_at IS NULL AND confirmed_at IS NOT NULL;
    UPDATE message_subscriptions s SET contact_id=c.id FROM message_contacts c WHERE c.normalized_email=s.email AND s.subscribed_at IS NOT NULL AND s.contact_id IS NULL;
    CREATE INDEX IF NOT EXISTS message_subscriptions_new ON message_subscriptions(subscribed_at DESC) WHERE subscribed_at IS NOT NULL;
    UPDATE message_subscription_settings SET value=value-'note' WHERE value->>'note'='سنرسل رابطًا لتأكيد بريدك أولًا. يمكنك إلغاء الاشتراك من أي رسالة.';
    CREATE INDEX IF NOT EXISTS message_subscriptions_campaign ON message_subscriptions(campaign_id);
    CREATE TABLE IF NOT EXISTS message_subscription_limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS message_blocked_signup_attempts(
      email TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 1,
      first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_code TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT ''
    );
    ALTER TABLE message_blocked_signup_attempts ADD COLUMN IF NOT EXISTS last_channel TEXT NOT NULL DEFAULT 'newsletter';
    ALTER TABLE message_blocked_signup_attempts ADD COLUMN IF NOT EXISTS last_course TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS message_blocked_signup_recent ON message_blocked_signup_attempts(last_attempt_at DESC);
    CREATE TABLE IF NOT EXISTS message_subscription_group(id INTEGER PRIMARY KEY CHECK(id=1),list_id UUID REFERENCES message_recipient_lists(id) ON DELETE SET NULL);
    INSERT INTO message_subscription_group(id) VALUES(1) ON CONFLICT DO NOTHING;
    UPDATE message_recipient_lists SET name='مشتركو الرسائل' WHERE id IN (SELECT list_id FROM message_subscription_group) AND name='مشتركو الرسائل — اشتراك مؤكد';
  `);
}
export async function subscriptionList(db) {
  const row=(await db.query('SELECT list_id FROM message_subscription_group WHERE id=1 FOR UPDATE')).rows[0];
  if(row?.list_id) return row.list_id;
  const id=(await db.query("INSERT INTO message_recipient_lists(name) VALUES('مشتركو الرسائل') RETURNING id")).rows[0].id;
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
  async function recordBlockedSignup(email,source){await recordBlockedAttempt(pool,email,{source});}
  async function activate(db,record,verified=false){
    const existed=(await db.query('SELECT id FROM message_contacts WHERE normalized_email=$1',[record.email])).rows.length>0;
    const tag=verified?'اشتراك مؤكد':'اشتراك من الموقع';
    const contact=(await db.query(`INSERT INTO message_contacts(full_name,email,normalized_email,language,tags,source)
      VALUES($1,$2,$2,'ar',ARRAY[$3::text],'رابط الاشتراك') ON CONFLICT(normalized_email) WHERE normalized_email<>''
      DO UPDATE SET tags=ARRAY(SELECT DISTINCT unnest(message_contacts.tags||ARRAY[$3::text])),updated_at=now() RETURNING id`,[record.full_name,record.email,tag])).rows[0];
    if(!contact)throw fail('تعذر تفعيل الاشتراك لهذا البريد.');
    const listId=await subscriptionList(db);
    await db.query('INSERT INTO message_recipient_list_members(list_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[listId,contact.id]);
    await db.query(`UPDATE message_subscriptions SET subscribed_at=COALESCE(subscribed_at,now()),
      confirmed_at=CASE WHEN $3 THEN COALESCE(confirmed_at,now()) ELSE confirmed_at END,
      signup_method=CASE WHEN $3 THEN 'verified' ELSE 'direct' END,contact_id=$2,added_new_contact=COALESCE(added_new_contact,$4)
      WHERE email=$1`,[record.email,contact.id,verified,!existed]);
  }
  route('get','/api/message-subscriptions/config',async(_req,res)=>res.json({settings:await settings(),available:true,version:2,mode:'instant'}));
  route('post','/api/message-subscriptions/request',async(req,res)=>{
    const config=await settings();const acknowledgement={...accepted,message:config.successText};if(!config.enabled)throw fail('الاشتراك غير متاح الآن. يرجى المحاولة لاحقًا.',503);
    const email=normalizeEmail(req.body?.email),name=String(req.body?.name||'').trim().slice(0,160);
    if(!validEmail(email))throw fail('أدخل بريدًا إلكترونيًا صحيحًا.');
    if(req.body?.consent!==true)throw fail('يرجى الموافقة على استقبال الرسائل.');
    if(req.body?.website)return res.status(202).json(acknowledgement);
    await limit('ip:'+digest(String(req.ip)),120,900);
    await pool.query("DELETE FROM message_subscription_limits WHERE expires_at<now()-interval '1 day'");
    if((await blockedEmails(pool,[email])).has(email)){
      await recordBlockedSignup(email,req.body.source);
      return res.status(409).json({error:'قمت بإلغاء المتابعة سابقًا، ولا يسمح لك بالتسجيل في القائمة البريدية.'});
    }
    const source=await campaign(req.body.source);
    const result=await tx(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[email]);
      if((await blockedEmails(db,[email],false)).has(email))return 'blocked';
      const existing=(await db.query('SELECT * FROM message_subscriptions WHERE email=$1 FOR UPDATE',[email])).rows[0];
      if(existing?.subscribed_at)return;
      await limit('global',2000,86400,db);
      await db.query(`INSERT INTO message_subscriptions(email,full_name,campaign_id,consent_text,consent_version,signup_method)
        VALUES($1,$2,$3,$4,2,'direct') ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,
        campaign_id=EXCLUDED.campaign_id,consent_text=EXCLUDED.consent_text,consent_version=2,
        requested_at=now(),token_hash=NULL,expires_at=NULL,signup_method='direct'`,[email,name,source?.id||null,config.consentLabel]);
      await activate(db,{email,full_name:name});
    });
    if(result==='blocked'){
      await recordBlockedSignup(email,req.body.source);
      return res.status(409).json({error:'قمت بإلغاء المتابعة سابقًا، ولا يسمح لك بالتسجيل في القائمة البريدية.'});
    }
    res.status(202).json(acknowledgement);
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
      if(record.subscribed_at)return {ok:true,alreadyConfirmed:true};
      if(!record.expires_at||new Date(record.expires_at)<=new Date())throw fail('انتهت صلاحية الرابط. ابدأ طلب اشتراك جديدًا.');
      if(!(await settings()).enabled)throw fail('الاشتراك غير متاح الآن.',503);
      await activate(db,record,true);
      return {ok:true};
    });res.json(result);
  });
  const prefix='/api/admin/message-studio/subscriptions';
  route('get',prefix+'/blocked-attempts',async(req,res)=>{
    const search=String(req.query.search||'').trim().slice(0,160),page=Math.min(10000,Math.max(0,parseInt(req.query.page,10)||0));
    const q='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
    const total=(await pool.query('SELECT count(*)::int AS n FROM message_blocked_signup_attempts WHERE email ILIKE $1',[q])).rows[0].n;
    const rows=(await pool.query(`SELECT a.email,a.attempts,a.first_attempt_at,a.last_attempt_at,a.reason,a.last_channel,a.last_course,c.subject AS campaign_subject
      FROM message_blocked_signup_attempts a LEFT JOIN email_campaigns c ON c.subscription_code=a.source_code
      WHERE a.email ILIKE $1 ORDER BY a.last_attempt_at DESC,a.email LIMIT 50 OFFSET $2`,[q,page*50])).rows;
    res.json({rows,total,page});
  },true);
  const active="s.subscribed_at IS NOT NULL AND b.email IS NULL";
  route('get',prefix,async(_req,res)=>{
    const config=await settings();
    const stats=(await pool.query(`SELECT count(*) FILTER(WHERE ${active})::int AS subscribed,
      count(*) FILTER(WHERE ${active} AND s.seen_at IS NULL)::int AS new,
      count(*) FILTER(WHERE s.subscribed_at IS NULL AND s.expires_at>now() AND b.email IS NULL)::int AS pending,
      count(*) FILTER(WHERE b.email IS NOT NULL)::int AS blocked FROM message_subscriptions s LEFT JOIN message_suppressions b ON b.email=s.email`)).rows[0];
    const campaigns=(await pool.query(`SELECT c.id,c.subject,c.subscription_code,c.created_at,
      count(s.email) FILTER(WHERE ${active})::int AS subscribed,
      count(s.email) FILTER(WHERE s.subscribed_at IS NULL AND s.expires_at>now() AND b.email IS NULL)::int AS pending
      FROM email_campaigns c LEFT JOIN message_subscriptions s ON s.campaign_id=c.id LEFT JOIN message_suppressions b ON b.email=s.email
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`)).rows.map(c=>({...c,url:subscriptionUrl(c.subscription_code,false,publicOrigin)}));
    res.json({settings:config,stats,campaigns,url:subscriptionUrl('',false,publicOrigin),listId:(await pool.query('SELECT list_id FROM message_subscription_group WHERE id=1')).rows[0]?.list_id,mailEnabled});
  },true);
  route('get',prefix+'/new',async(req,res)=>{
    const search=String(req.query.search||'').trim().slice(0,160),page=Math.min(100000,Math.max(0,parseInt(req.query.page,10)||0));
    const stats=(await pool.query(`SELECT count(*) FILTER(WHERE ${active})::int AS total,
      count(*) FILTER(WHERE ${active} AND s.seen_at IS NULL)::int AS unread FROM message_subscriptions s LEFT JOIN message_suppressions b ON b.email=s.email`)).rows[0];
    if(req.query.countOnly==='1')return res.json(stats);
    const where="s.subscribed_at IS NOT NULL AND (s.full_name ILIKE $1 OR s.email ILIKE $1)"+(req.query.filter==='new'?" AND s.seen_at IS NULL AND b.email IS NULL":"");
    const q='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
    const total=(await pool.query(`SELECT count(*)::int AS n FROM message_subscriptions s LEFT JOIN message_suppressions b ON b.email=s.email WHERE ${where}`,[q])).rows[0].n;
    const rows=(await pool.query(`SELECT s.email,s.full_name,s.subscribed_at,s.confirmed_at,s.seen_at,s.signup_method,s.added_new_contact,s.contact_id,c.subject,
      CASE WHEN b.email IS NOT NULL THEN 'blocked' WHEN s.contact_id IS NULL THEN 'removed' ELSE 'active' END AS status
      FROM message_subscriptions s LEFT JOIN message_suppressions b ON b.email=s.email LEFT JOIN email_campaigns c ON c.id=s.campaign_id
      WHERE ${where} ORDER BY s.subscribed_at DESC,s.email LIMIT 50 OFFSET $2`,[q,page*50])).rows;
    res.json({rows,total,page,...{stats},listId:(await pool.query('SELECT list_id FROM message_subscription_group WHERE id=1')).rows[0]?.list_id});
  },true);
  route('post',prefix+'/new/seen',async(req,res)=>{
    if(!Array.isArray(req.body?.emails)||req.body.emails.length>50)throw fail('حدد حتى 50 مشتركًا للمراجعة.');
    const emails=[...new Set(req.body.emails.map(normalizeEmail).filter(validEmail))];
    const changed=await pool.query('UPDATE message_subscriptions SET seen_at=COALESCE(seen_at,now()) WHERE email=ANY($1::text[]) AND subscribed_at IS NOT NULL RETURNING email',[emails]);
    res.json({ok:true,reviewed:changed.rowCount});
  },true);
  route('put',prefix+'/settings',async(req,res)=>{const config=subscriptionSettings(req.body);await pool.query('UPDATE message_subscription_settings SET value=$1 WHERE id=1',[config]);res.json({settings:config});},true);
  route('get',prefix+'/qr',async(req,res)=>{const c=await campaign(req.query.source);const url=subscriptionUrl(c?.subscription_code||'',false,publicOrigin);res.set({'Content-Type':'image/svg+xml','Content-Disposition':'attachment; filename="inexc-subscribe-qr.svg"'}).send(await QRCode.toString(url,{type:'svg',errorCorrectionLevel:'M',margin:4,width:600,color:{dark:'#0868ce',light:'#ffffff'}}));},true);
}

export async function recordBlockedAttempt(db,email,{source='',channel='newsletter',course=''}={}){
  email=normalizeEmail(email);
  const reason=(await db.query('SELECT reason FROM message_suppressions WHERE email=$1',[email])).rows[0]?.reason||'shared';
  await db.query(`INSERT INTO message_blocked_signup_attempts(email,source_code,reason,last_channel,last_course) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(email) DO UPDATE SET attempts=message_blocked_signup_attempts.attempts+1,
    last_attempt_at=now(),source_code=EXCLUDED.source_code,reason=EXCLUDED.reason,
    last_channel=EXCLUDED.last_channel,last_course=EXCLUDED.last_course`,
    [email,String(source||'').slice(0,36),reason,channel,String(course||'').slice(0,160)]);
}
