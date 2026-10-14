import crypto from 'node:crypto';
export const normalizeEmail = value => String(value || '').trim().toLowerCase();
export const suppressionError = () => Object.assign(new Error('هذا البريد ألغى اشتراكه أو أُوقف نهائيًا؛ لا يمكن إضافته أو إرسال بريد معاينة إليه.'), {status:409,code:'EMAIL_SUPPRESSED'});
export const deliveryUnsubscribeUrl = token => 'https://api.inexctraining.com/api/messages/unsubscribe?token='+encodeURIComponent(token);

// A separately retained ledger is authoritative, even after contact deletion.
export async function blockedEmails(db, values, remote = true) {
  const emails = [...new Set(values.map(normalizeEmail).filter(Boolean))];
  if (!emails.length) return new Set();
  const result = await db.query('SELECT email FROM message_suppressions WHERE email=ANY($1::text[])',[emails]);
  const blocked = new Set(result.rows.map(r=>r.email));
  const remoteUrl = process.env.MESSAGE_SUPPRESSION_REMOTE_URL;
  if (remote && remoteUrl) {
    if (!remoteUrl.startsWith('https://') || !process.env.MESSAGE_SUPPRESSION_SYNC_KEY) throw Object.assign(new Error('تعذر التحقق من سجل الحظر المشترك. توقفت العملية حتى استعادة الاتصال.'),{status:503});
    try {
      for(let offset=0;offset<emails.length;offset+=3000){
      const batch=emails.slice(offset,offset+3000);
      const response = await fetch(remoteUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.MESSAGE_SUPPRESSION_SYNC_KEY},body:JSON.stringify({emails:batch}),signal:AbortSignal.timeout(10000)});
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.blocked) || data.checked !== batch.length) throw Error('Invalid suppression response');
      for (const email of data.blocked) { if (!batch.includes(email)) throw Error('Invalid suppression record'); blocked.add(email); }
      }
    } catch { throw Object.assign(new Error('تعذر التحقق من سجل الحظر المشترك. توقفت العملية حتى استعادة الاتصال.'),{status:503}); }
  }
  return blocked;
}
export async function assertMailAllowed(db,email) { if ((await blockedEmails(db,[email])).size) throw suppressionError(); }
export async function suppressEmail(db, email, {reason='unsubscribe',source='email-link',campaignId=null,deliveryId=null}={}) {
  email=normalizeEmail(email); if (!email) return;
  await db.query('INSERT INTO message_suppressions(email,reason,source) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',[email,reason,source]);
  if (reason==='unsubscribe') await db.query(`INSERT INTO message_unsubscribe_events(email,campaign_id,delivery_id,source) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING`,[email,campaignId,deliveryId,source]);
  await db.query('INSERT INTO email_preferences(email,unsubscribe_token,marketing_opt_out) VALUES($1,$2,true) ON CONFLICT(email) DO UPDATE SET marketing_opt_out=true,updated_at=now()',[email,crypto.randomBytes(24).toString('hex')]);
  await db.query('UPDATE message_contacts SET suppressed=true,updated_at=now() WHERE normalized_email=$1',[email]);
  await db.query('UPDATE course_alert_subscribers SET active=false,suppressed=true,updated_at=now() WHERE email=$1',[email]);
  await db.query("UPDATE email_deliveries SET status='skipped',retryable=false,error='ألغى المستلم اشتراكه أو أُوقف بريده.' WHERE lower(trim(email))=$1 AND status='queued'",[email]);
}
export function installSuppressionRoutes({app,pool}) {
  app.post('/api/message-suppressions/check',async(req,res,next)=>{
    try {
      const expected=process.env.MESSAGE_SUPPRESSION_SYNC_KEY || '', actual=String(req.headers.authorization || '').replace(/^Bearer /,'');
      if(!expected || expected.length<32 || Buffer.byteLength(actual)!==Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:'Unauthorized'});
      if(!Array.isArray(req.body?.emails)||req.body.emails.length>3000)return res.status(400).json({error:'Provide up to 3000 emails.'});
      const emails=[...new Set(req.body.emails.map(normalizeEmail).filter(Boolean))];
      res.json({checked:emails.length,blocked:[...await blockedEmails(pool,emails,false)]});
    }catch(e){next(e)}
  });
  const unsubscribe=async(req,res,next)=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const token=String(req.query.token || '').slice(0,100);
      const delivery=(await client.query('SELECT id,email,campaign_id FROM email_deliveries WHERE unsubscribe_token=$1',[token])).rows[0];
      if(!delivery){await client.query('ROLLBACK');return res.status(400).type('html').send('<html lang="ar" dir="rtl"><meta charset="utf-8"><p>رابط إلغاء الاشتراك غير صالح.</p></html>')}
      await suppressEmail(client,delivery.email,{campaignId:delivery.campaign_id,deliveryId:delivery.id});
      await client.query('COMMIT');
      res.type('html').send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إلغاء الاشتراك | INEXC</title><body style="font-family:Tahoma,Arial;background:#f1f6fb;color:#17324d;padding:24px"><main style="max-width:500px;margin:12vh auto;background:white;padding:32px;border-radius:16px;text-align:center"><h1>تم إلغاء الاشتراك</h1><p style="line-height:1.9">تم إيقاف رسائل INEXC لهذا البريد. يبقى الإيقاف محفوظًا حتى عند إعادة استيراد قوائم الاتصال.</p><a href="https://www.inexctraining.com">العودة إلى الموقع</a></main></body></html>');
    }catch(e){await client.query('ROLLBACK');next(e)}finally{client.release()}
  };
  app.get('/api/messages/unsubscribe',unsubscribe);
  app.post('/api/messages/unsubscribe',unsubscribe);
}

export async function setupSuppressions(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS message_suppressions(email TEXT PRIMARY KEY,reason TEXT NOT NULL,source TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(email=lower(trim(email)) AND email<>''));
    CREATE TABLE IF NOT EXISTS message_unsubscribe_events(email TEXT PRIMARY KEY,campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,delivery_id UUID REFERENCES email_deliveries(id) ON DELETE SET NULL,source TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS message_unsubscribe_campaign_idx ON message_unsubscribe_events(campaign_id);
    ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT NOT NULL DEFAULT gen_random_uuid()::text;
    CREATE UNIQUE INDEX IF NOT EXISTS message_delivery_unsubscribe_idx ON email_deliveries(unsubscribe_token);
    ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS unsubscribe_tracking BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE email_campaigns ALTER COLUMN unsubscribe_tracking SET DEFAULT true;
    UPDATE email_campaigns c SET unsubscribe_tracking=true WHERE NOT unsubscribe_tracking AND status IN ('queued','scheduled') AND NOT EXISTS(SELECT 1 FROM email_deliveries d WHERE d.campaign_id=c.id AND (d.attempted_at IS NOT NULL OR d.resend_email_id<>'' OR d.payload_snapshot IS NOT NULL));
    INSERT INTO message_suppressions(email,reason,source,created_at) SELECT lower(trim(email)),'legacy','previous-preference',updated_at FROM email_preferences WHERE marketing_opt_out AND trim(email)<>'' ON CONFLICT DO NOTHING;
    INSERT INTO message_suppressions(email,reason,source,created_at) SELECT lower(trim(email)),'legacy','previous-contact',updated_at FROM message_contacts WHERE suppressed AND trim(email)<>'' ON CONFLICT DO NOTHING;
    INSERT INTO message_suppressions(email,reason,source,created_at) SELECT lower(trim(email)),'legacy','previous-course-alert',updated_at FROM course_alert_subscribers WHERE (suppressed OR NOT active) AND trim(email)<>'' ON CONFLICT DO NOTHING;
    CREATE OR REPLACE FUNCTION lock_message_suppression() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext(NEW.email)); RETURN NEW; END $$;
    DROP TRIGGER IF EXISTS message_suppression_lock ON message_suppressions;
    CREATE TRIGGER message_suppression_lock BEFORE INSERT ON message_suppressions FOR EACH ROW EXECUTE FUNCTION lock_message_suppression();
    CREATE OR REPLACE FUNCTION keep_message_suppression() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Permanent suppression records cannot be changed or removed' USING ERRCODE='23514'; END $$;
    DROP TRIGGER IF EXISTS message_suppression_immutable ON message_suppressions;
    CREATE TRIGGER message_suppression_immutable BEFORE UPDATE OR DELETE ON message_suppressions FOR EACH ROW EXECUTE FUNCTION keep_message_suppression();
    CREATE OR REPLACE FUNCTION guard_message_preference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW.email=lower(trim(NEW.email));
      PERFORM pg_advisory_xact_lock(hashtext(NEW.email));
      IF EXISTS(SELECT 1 FROM message_suppressions WHERE email=NEW.email) THEN NEW.marketing_opt_out=true; END IF;
      IF NEW.marketing_opt_out THEN INSERT INTO message_suppressions(email,reason,source) VALUES(NEW.email,'legacy','preference') ON CONFLICT DO NOTHING; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS message_preference_guard ON email_preferences;
    CREATE TRIGGER message_preference_guard BEFORE INSERT OR UPDATE ON email_preferences FOR EACH ROW EXECUTE FUNCTION guard_message_preference();
    CREATE OR REPLACE FUNCTION guard_message_contact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW.email=lower(trim(NEW.email)); NEW.normalized_email=NEW.email;
      IF NEW.email='' THEN RETURN NEW; END IF;
      PERFORM pg_advisory_xact_lock(hashtext(NEW.email));
      IF EXISTS(SELECT 1 FROM message_suppressions WHERE email=NEW.email) THEN
        IF TG_OP='INSERT' THEN RETURN NULL; END IF;
        IF NEW.email<>OLD.email THEN RAISE EXCEPTION 'هذا البريد موقوف نهائيًا ولا يمكن إضافته.' USING ERRCODE='23514'; END IF;
        NEW.suppressed=true;
      END IF;
      IF NEW.suppressed THEN INSERT INTO message_suppressions(email,reason,source) VALUES(NEW.email,'blocked','contact') ON CONFLICT DO NOTHING; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS message_contact_guard ON message_contacts;
    CREATE TRIGGER message_contact_guard BEFORE INSERT OR UPDATE ON message_contacts FOR EACH ROW EXECUTE FUNCTION guard_message_contact();
    CREATE OR REPLACE FUNCTION guard_message_membership() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE contact_email TEXT; contact_blocked BOOLEAN; BEGIN
      SELECT email,suppressed INTO contact_email,contact_blocked FROM message_contacts WHERE id=NEW.contact_id;
      IF contact_email<>'' THEN
        PERFORM pg_advisory_xact_lock(hashtext(contact_email));
        IF contact_blocked OR EXISTS(SELECT 1 FROM message_suppressions WHERE email=contact_email) THEN RETURN NULL; END IF;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS message_membership_guard ON message_recipient_list_members;
    CREATE TRIGGER message_membership_guard BEFORE INSERT OR UPDATE ON message_recipient_list_members FOR EACH ROW EXECUTE FUNCTION guard_message_membership();
    CREATE OR REPLACE FUNCTION guard_course_subscription() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW.email=lower(trim(NEW.email));
      PERFORM pg_advisory_xact_lock(hashtext(NEW.email));
      IF EXISTS(SELECT 1 FROM message_suppressions WHERE email=NEW.email) THEN
        IF TG_OP='INSERT' THEN RETURN NULL; END IF;
        NEW.active=false; NEW.suppressed=true;
      END IF;
      IF NEW.suppressed OR NOT NEW.active THEN INSERT INTO message_suppressions(email,reason,source) VALUES(NEW.email,'legacy','course-alert') ON CONFLICT DO NOTHING; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS course_subscription_guard ON course_alert_subscribers;
    CREATE TRIGGER course_subscription_guard BEFORE INSERT OR UPDATE ON course_alert_subscribers FOR EACH ROW EXECUTE FUNCTION guard_course_subscription();
  `);
}
