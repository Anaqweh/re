import { blockedEmails, assertMailAllowed, suppressEmail, suppressionError } from './message-suppression.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { normaliseMessageBody } from './message-format.js';
import { readContactFile, contactsFromRows, parseDelimited } from './message-contacts.js';
import { mailSettings, renderMail, checkMessage } from './message-mail.js';

const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const uuid = v => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(String(v));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const validEmail = v => /^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(v) && v.length <= 180 && v.split('@')[0].length <= 64 && !v.includes('..');
const tags = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[,،]/)).map(v => clean(v,40)).filter(Boolean))].slice(0,20);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function contactRecord(raw = {}) {
  const email = clean(raw.email,181).toLowerCase();
  return { name: clean(raw.name ?? raw.full_name,160), email, language: ['ar','en'].includes(raw.language) ? raw.language : '', tags: tags(raw.tags), source: clean(raw.source,180), invalid: !!email && !validEmail(email) };
}
export function draftPayload(raw = {}) {
  const payload = { subject: clean(raw.subject,160), message: normaliseMessageBody(raw.message), ...mailSettings(raw),
    ctaLabel: clean(raw.ctaLabel,80), ctaUrl: clean(raw.ctaUrl,600), audience: clean(raw.audience || 'custom',20),
    listId: uuid(raw.listId) ? raw.listId : '', courseId: uuid(raw.courseId) ? raw.courseId : '',
    campaignId: uuid(raw.campaignId) ? raw.campaignId : '', excludeCampaignId: uuid(raw.excludeCampaignId) ? raw.excludeCampaignId : '',
    ids: (Array.isArray(raw.ids) ? raw.ids : []).filter(uuid).slice(0,3000),
    extraRecipients: clean(raw.extraRecipients,180000), attachmentPath: clean(raw.attachmentPath,300),
    scheduledAt: clean(raw.scheduledAt,80), templateId: uuid(raw.templateId) ? raw.templateId : null,
  };
  return payload;
}
const csvCell = value => '"' + String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g,'""') + '"';
const csv = rows => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');

export function installMessageStudio({ app, pool, auth, importUpload, resolveRecipients, getPreference, sendEmail, worker, emailFrom, mailEnabled, webhookEnabled, uploadDir }) {
  const prefix = '/api/admin/message-studio';
  const selections = new Map();
  const route = (method, path, handler, middleware = []) => app[method](prefix + path, auth, ...middleware, async (req,res) => {
    try { await handler(req,res); }
    catch (error) {
      const reference = crypto.randomUUID().slice(0,8);
      console.error(`[message-studio:${reference}]`, error);
      const status = ['23505','23514'].includes(error.code) ? 409 : error.code === '22P02' ? 400 : error.status || 500;
      res.status(status).json({ error: error.code === '23505' ? 'هذا البريد أو السجل موجود بالفعل. حدّث السجل الموجود.' : status < 500 ? error.message : 'تعذرت العملية على الخادم. أعد المحاولة؛ إذا استمرت المشكلة شارك مرجع الخطأ مع الإدارة.', reference });
    }
  });
  const tx = async fn => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  };
  const getSettings = async () => mailSettings((await pool.query('SELECT value FROM message_studio_settings WHERE id=1')).rows[0]?.value);
  const requireId = id => { if (!uuid(id)) throw fail('معرّف السجل غير صالح.'); return id; };
  const contactWhere = (query = {}, alias = 'c') => {
    const params = [], clauses = ['true'];
    const add = (clause, v) => { params.push(v); clauses.push(clause.replaceAll('?', '$'+params.length)); };
    if (query.search) add(`(${alias}.full_name ILIKE ? OR ${alias}.email ILIKE ?)`, '%'+clean(query.search,160).replace(/[\\%_]/g,'\\$&')+'%');
    if (query.language) add(`${alias}.language=?`, clean(query.language,10));
    if (query.tag) add(`? = ANY(${alias}.tags)`, clean(query.tag,40));
    if (query.listId) add(`EXISTS(SELECT 1 FROM message_recipient_list_members m WHERE m.contact_id=${alias}.id AND m.list_id=?::uuid)`,requireId(query.listId));
    if (query.status === 'missing') clauses.push(`${alias}.email=''`);
    if (query.status === 'suppressed') clauses.push(`(${alias}.suppressed OR EXISTS(SELECT 1 FROM message_suppressions p WHERE p.email=${alias}.email))`);
    if (query.status === 'eligible') clauses.push(`${alias}.email<>'' AND NOT ${alias}.suppressed AND NOT EXISTS(SELECT 1 FROM message_suppressions p WHERE p.email=${alias}.email)`);
    return { sql: clauses.join(' AND '), params };
  };
  async function reviewContacts(rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length > 10000) throw fail('الحد الأقصى للمراجعة 10000 صف، وللحفظ 3000 جهة فريدة. قسّم الملف.');
    const rows = rawRows.map(contactRecord).filter(v => v.email || v.name);
    const existing = new Set((await pool.query('SELECT normalized_email FROM message_contacts WHERE normalized_email=ANY($1::text[])',[rows.map(v=>v.email).filter(Boolean)])).rows.map(v=>v.normalized_email));
    const blocked=await blockedEmails(pool,rows.map(r=>r.email));
    const seen = new Set(), counts = { new:0, existing:0, duplicate:0, invalid:0, missing:0, suppressed:0, total:rows.length };
    rows.forEach(row => {
      row.state = row.invalid ? 'invalid' : !row.email ? 'missing' : blocked.has(row.email) ? 'suppressed' : seen.has(row.email) ? 'duplicate' : existing.has(row.email) ? 'existing' : 'new';
      counts[row.state]++; if (row.email) seen.add(row.email);
    });
    return { rows, counts, mailboxVerified:false };
  }
  async function resolve(payload) {
    let input = { ...payload };
    if (payload.audience === 'previous') {
      requireId(payload.campaignId);
      const previous = await pool.query('SELECT email,recipient_name AS name FROM email_deliveries WHERE campaign_id=$1 LIMIT 3001',[payload.campaignId]);
      input = { ...input, audience:'custom', recipientRows:previous.rows };
    }
    const result = await resolveRecipients(input);
    let suppressed = new Set((await pool.query('SELECT email FROM message_contacts WHERE suppressed AND email=ANY($1::text[])',[result.recipients.map(r=>r.email)])).rows.map(r=>r.email));
    if (payload.excludeCampaignId) {
      const excluded = await pool.query('SELECT email FROM email_deliveries WHERE campaign_id=$1',[requireId(payload.excludeCampaignId)]);
      excluded.rows.forEach(r=>suppressed.add(r.email));
    }
    const before = result.recipients.length;
    result.recipients = result.recipients.filter(r=>!suppressed.has(r.email));
    result.excluded = before - result.recipients.length;
    return result;
  }
  async function validateSend(payload) {
    let recipients, audienceError='';
    try { recipients=await resolve(payload); }
    catch(error) { if(error.code)throw error;audienceError=error.message;recipients={recipients:[],courseName:'',totalCandidates:0,skippedUnsubscribed:0,excluded:0}; }
    const issues = checkMessage(payload,{course:recipients.courseName});
    if(audienceError) issues.push(audienceError);
    if (!recipients.recipients.length) issues.push('لا توجد عناوين مؤهلة للإرسال ضمن الجمهور المحدد.');
    let scheduledAt = null;
    if (payload.scheduledAt) {
      const date = new Date(payload.scheduledAt);
      if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 30000) issues.push('اختر موعدًا مستقبليًا بعد نصف دقيقة على الأقل بتوقيت دبي.');
      else scheduledAt = date.toISOString();
    }
    if (payload.attachmentPath) {
      if (!/^\/uploads\/mail-[a-z\d-]+-[a-z\d._-]+$/i.test(payload.attachmentPath)) issues.push('المرفق غير صالح؛ أعد رفعه.');
      else if (!(await fs.stat(uploadDir + '/' + payload.attachmentPath.split('/').pop()).catch(()=>null))?.isFile()) issues.push('المرفق غير موجود؛ أعد رفعه.');
    }
    return { ...recipients, issues, scheduledAt };
  }
  route('get','/settings', async (_req,res)=>res.json({settings:await getSettings(),from:emailFrom,mailEnabled,webhookEnabled,timezone:'Asia/Dubai',aiAvailable:false,version:5,subscriptions:2,suppressionShared:!!process.env.MESSAGE_SUPPRESSION_REMOTE_URL,ocr:'local-tesseract'}));
  route('put','/settings', async (req,res)=>{
    const settings = mailSettings(req.body);
    await pool.query("INSERT INTO message_studio_settings(id,value) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",[settings]);
    res.json(settings);
  });
  route('get','/overview', async (_req,res)=>{
    const result = await pool.query(`SELECT
+     (SELECT count(*)::int FROM message_drafts WHERE campaign_id IS NULL) AS drafts,
+     (SELECT count(*)::int FROM email_campaigns WHERE status='scheduled') AS scheduled,
+     (SELECT count(*)::int FROM email_deliveries WHERE resend_email_id<>'') AS accepted,
+     (SELECT count(*)::int FROM email_deliveries WHERE delivered_at IS NOT NULL) AS delivered,
+     (SELECT count(*)::int FROM email_deliveries WHERE status IN ('failed','bounced','complained')) AS failed,
+     (SELECT count(*)::int FROM message_contacts) AS contacts`.replaceAll('\n+','\n'));
    const totals=(await pool.query(`SELECT count(*)::int AS suppressed,count(*) FILTER(WHERE reason IN ('unsubscribe','legacy') OR email IN (SELECT email FROM message_unsubscribe_events))::int AS unsubscribed,count(*) FILTER(WHERE reason='legacy')::int AS historical FROM message_suppressions`)).rows[0];
    const latest=(await pool.query(`SELECT c.id,c.subject,c.unsubscribe_tracking,(SELECT count(*)::int FROM message_unsubscribe_events e WHERE e.campaign_id=c.id) AS unsubscribed FROM email_campaigns c WHERE EXISTS(SELECT 1 FROM email_deliveries d WHERE d.campaign_id=c.id AND (d.attempted_at IS NOT NULL OR d.resend_email_id<>'')) ORDER BY COALESCE(c.sending_at,c.sent_at,c.created_at) DESC,c.id DESC LIMIT 1`)).rows[0] || null;
    res.json({...result.rows[0],...totals,latestCampaign:latest,webhookEnabled});
  });
  route('get','/suppressions',async(req,res)=>{
    const q='%'+clean(req.query.search,180).replace(/[\\%_]/g,'\\$&')+'%',page=Math.max(0,Number(req.query.page)||0);
    const total=(await pool.query('SELECT count(*)::int AS total FROM message_suppressions WHERE email ILIKE $1',[q])).rows[0].total;
    const rows=(await pool.query(`SELECT s.*,e.created_at AS unsubscribed_at,c.subject AS campaign_subject FROM message_suppressions s LEFT JOIN message_unsubscribe_events e ON e.email=s.email LEFT JOIN email_campaigns c ON c.id=e.campaign_id WHERE s.email ILIKE $1 ORDER BY s.created_at DESC,s.email LIMIT 50 OFFSET $2`,[q,page*50])).rows;
    res.json({rows,total,page});
  });
  route('get','/suppressions-export',async(_req,res)=>{
    const rows=(await pool.query('SELECT email,reason,source,created_at FROM message_suppressions ORDER BY email')).rows;
    res.set({'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="inexc-permanent-suppressions.json"'}).send(JSON.stringify({format:'inexc-suppressions-v1',exportedAt:new Date().toISOString(),suppressions:rows},null,2));
  });
  route('post','/suppressions-import',async(req,res)=>{
    if(req.body.format!=='inexc-suppressions-v1'||!Array.isArray(req.body.suppressions)||req.body.suppressions.length>3000)throw fail('اختر ملف سجل الحظر بصيغته الأصلية، بحد أقصى 3000 بريد لكل دفعة.');
    const rows=req.body.suppressions.map(r=>({email:clean(r.email,181).toLowerCase(),reason:['unsubscribe','bounce','complaint','blocked','legacy'].includes(r.reason)?r.reason:'legacy'}));
    if(rows.some(r=>!validEmail(r.email)))throw fail('يتضمن سجل الحظر بريدًا غير صالح؛ لم تُحفظ الدفعة.');
    const result=await tx(async client=>{
      const before=(await client.query('SELECT count(*)::int AS n FROM message_suppressions')).rows[0].n;
      for(const r of rows)await suppressEmail(client,r.email,{reason:r.reason,source:'imported-registry'});
      const after=(await client.query('SELECT count(*)::int AS n FROM message_suppressions')).rows[0].n;
      return {added:after-before,total:after};
    });res.json(result);
  });
  route('get','/drafts', async (_req,res)=>res.json((await pool.query('SELECT id,payload,version,created_at,updated_at FROM message_drafts WHERE campaign_id IS NULL ORDER BY updated_at DESC LIMIT 200')).rows));
  route('put','/drafts/:id', async (req,res)=>{
    const id = requireId(req.params.id), payload = draftPayload(req.body.payload);
    res.json(await tx(async client=>{
      // Serialize first creation too, without permitting duplicate drafts on a retried save.
      await client.query('INSERT INTO message_drafts(id,payload,version) VALUES($1,$2,0) ON CONFLICT(id) DO NOTHING',[id,{}]);
      const current = (await client.query('SELECT * FROM message_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (current.campaign_id) throw fail('أُرسلت هذه المسودة. انسخها لإنشاء رسالة جديدة.',409);
      if (hash(current.payload) === hash(payload) && current.version > 0) return current;
      if (Number(req.body.version) !== current.version) throw fail('حُفظت نسخة أحدث في نافذة أخرى. افتح النسخة المحفوظة أو احفظ محتواك كنسخة مستقلة.',409);
      // PostgreSQL JSONB key order is not significant.
      const result = await client.query('UPDATE message_drafts SET payload=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *',[payload,id]);
      const saved = result.rows[0];
      await client.query('INSERT INTO message_draft_versions(draft_id,version,payload) VALUES($1,$2,$3)',[id,saved.version,payload]);
      await client.query('DELETE FROM message_draft_versions WHERE draft_id=$1 AND version <= $2',[id,saved.version-30]);
      return saved;
    }));
  });
  route('get','/drafts/:id', async (req,res)=>{
    const row = (await pool.query('SELECT * FROM message_drafts WHERE id=$1',[requireId(req.params.id)])).rows[0];
    if (!row) throw fail('المسودة غير موجودة.',404); res.json(row);
  });
  route('get','/drafts/:id/versions', async (req,res)=>res.json((await pool.query('SELECT version,payload,created_at FROM message_draft_versions WHERE draft_id=$1 ORDER BY version DESC',[requireId(req.params.id)])).rows));
  route('delete','/drafts/:id', async (req,res)=>{
    const result = await pool.query('DELETE FROM message_drafts WHERE id=$1 AND campaign_id IS NULL RETURNING id',[requireId(req.params.id)]);
    if (!result.rowCount) throw fail('تعذر حذف المسودة؛ ربما أصبحت رسالة مرسلة.',409); res.json({ok:true});
  });
  route('post','/preview', async (req,res)=>{
    const payload = draftPayload(req.body.payload); let person = {name:clean(req.body.name,160),email:clean(req.body.email,180)};
    if (req.body.contactId) person = (await pool.query('SELECT full_name AS name,email FROM message_contacts WHERE id=$1',[requireId(req.body.contactId)])).rows[0] || person;
    const course = payload.courseId ? (await pool.query('SELECT name FROM courses WHERE id=$1',[payload.courseId])).rows[0]?.name || '' : '';
    res.json(renderMail({subject:payload.subject,body:payload.message,ctaLabel:payload.ctaLabel,ctaUrl:payload.ctaUrl,person,courseName:course,settings:payload,unsubscribeUrl:'https://api.inexctraining.com/api/email-preferences/unsubscribe?token=PREVIEW_ONLY'}));
  });
  route('post','/review', async (req,res)=>{
    const payload = draftPayload(req.body.payload), result = await validateSend(payload);
    res.json({issues:result.issues,total:result.totalCandidates,ready:result.recipients.length,excluded:result.excluded,unsubscribed:result.skippedUnsubscribed,from:emailFrom,scheduledAt:result.scheduledAt,timezone:'Asia/Dubai',sample:result.recipients.slice(0,5),mailEnabled});
  });
  route('post','/drafts/:id/submit', async (req,res)=>{
    if (!mailEnabled) throw fail('خدمة البريد غير مهيأة. تظل المسودة محفوظة؛ راجع إعدادات الخادم.',503);
    const result = await tx(async client=>{
      const draft = (await client.query('SELECT * FROM message_drafts WHERE id=$1 FOR UPDATE',[requireId(req.params.id)])).rows[0];
      if (!draft) throw fail('احفظ المسودة أولًا.',404);
      if (draft.campaign_id) return (await client.query('SELECT id,status,total_recipients,scheduled_at FROM email_campaigns WHERE id=$1',[draft.campaign_id])).rows[0];
      if (Number(req.body.version) !== draft.version) throw fail('تغيّرت الرسالة بعد المراجعة. أعد فتح شاشة المراجعة.',409);
      const p = draft.payload, checked = await validateSend(p);
      if (checked.issues.length) throw fail(checked.issues.join('\n'));
      const campaign = (await client.query(`INSERT INTO email_campaigns(subject,body,audience,cta_label,cta_url,attachment_path,status,scheduled_at,total_recipients,skipped_unsubscribed,course_name,settings,audience_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,status,total_recipients,scheduled_at`,[p.subject,p.message,p.audience,p.ctaLabel,p.ctaUrl,p.attachmentPath,checked.scheduledAt?'scheduled':'queued',checked.scheduledAt,checked.recipients.length,checked.skippedUnsubscribed,checked.courseName,mailSettings(p),p])).rows[0];
      for (const person of checked.recipients) await client.query("INSERT INTO email_deliveries(campaign_id,email,recipient_name,status) VALUES($1,$2,$3,'queued')",[campaign.id,person.email,person.name]);
      await client.query('UPDATE message_drafts SET campaign_id=$1 WHERE id=$2',[campaign.id,draft.id]);
      return campaign;
    });
    res.status(202).json(result); if (result.status === 'queued') void worker();
  });
  route('post','/test', async (req,res)=>{
    if (!mailEnabled) throw fail('خدمة البريد غير مهيأة حاليًا.',503);
    const id = requireId(req.body.requestId), email = clean(req.body.email,180).toLowerCase(), payload = draftPayload(req.body.payload);
    if (!validEmail(email)) throw fail('اكتب عنوان بريد تجريبي صحيحًا.');
    const courseName = payload.courseId ? (await pool.query('SELECT name FROM courses WHERE id=$1',[payload.courseId])).rows[0]?.name || '' : '';
    const issues = checkMessage(payload,{course:courseName}); if (issues.length) throw fail(issues.join('\n'));
    await assertMailAllowed(pool,email);
    const preference = await getPreference(email);
    if(preference.marketing_opt_out) throw suppressionError();
    const requestHash = hash({email,payload,name:clean(req.body.name,160)});
    if (payload.attachmentPath && (!/^\/uploads\/mail-[a-z\d-]+-[a-z\d._-]+$/i.test(payload.attachmentPath) || !(await fs.stat(uploadDir+'/'+payload.attachmentPath.split('/').pop()).catch(()=>null))?.isFile())) throw fail('المرفق غير صالح أو غير موجود؛ أعد رفعه قبل التجربة.');
    const mail = renderMail({subject:'[TEST] '+payload.subject,body:payload.message,ctaLabel:payload.ctaLabel,ctaUrl:payload.ctaUrl,courseName,settings:payload,person:{email,name:clean(req.body.name,160)},unsubscribeUrl:'https://api.inexctraining.com/api/email-preferences/unsubscribe?token='+preference.unsubscribe_token});
    mail.attachmentPath=payload.attachmentPath;
    await pool.query('INSERT INTO message_test_requests(id,request_hash,payload) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,requestHash,mail]);
    const saved = (await pool.query('SELECT * FROM message_test_requests WHERE id=$1',[id])).rows[0];
    if (saved.request_hash !== requestHash) throw fail('تغيّر محتوى التجربة. أعد فتح نافذة التجربة.',409);
    if (saved.provider_id) return res.json({accepted:true,id:saved.provider_id});
    if (Date.now() - new Date(saved.created_at).getTime() > 23*3600000) throw fail('انتهت فترة إعادة المحاولة الآمنة. راجع المزود قبل إرسال تجربة جديدة.');
    await assertMailAllowed(pool,email);
    const sent = await sendEmail({to:email,marketing:true,...saved.payload,idempotencyKey:'studio-test/'+id});
    if (!sent?.id) throw fail('لم يؤكد المزود قبول رسالة التجربة.',502);
    await pool.query('UPDATE message_test_requests SET provider_id=$1 WHERE id=$2',[sent.id,id]);
    res.json({accepted:true,id:sent.id});
  });
  route('get','/campaigns', async (_req,res)=>{
    res.json((await pool.query(`SELECT c.*,(SELECT count(*)::int FROM message_unsubscribe_events e WHERE e.campaign_id=c.id) AS unsubscribed,count(d.id)::int AS total,
      count(d.id) FILTER(WHERE d.resend_email_id<>'')::int AS accepted,
      count(d.id) FILTER(WHERE d.delivered_at IS NOT NULL)::int AS delivered,
      count(d.id) FILTER(WHERE d.status IN ('failed','bounced','complained'))::int AS failed,
      count(d.id) FILTER(WHERE d.status='queued')::int AS queued,
      count(d.id) FILTER(WHERE d.status='skipped')::int AS skipped,
      count(d.id) FILTER(WHERE d.opened_at IS NOT NULL)::int AS opened,
      count(d.id) FILTER(WHERE d.clicked_at IS NOT NULL)::int AS clicked
      FROM email_campaigns c LEFT JOIN email_deliveries d ON d.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`)).rows);
  });
  route('get','/campaigns/:id', async (req,res)=>{
    const campaign = (await pool.query('SELECT c.*,(SELECT count(*)::int FROM message_unsubscribe_events e WHERE e.campaign_id=c.id) AS unsubscribed FROM email_campaigns c WHERE c.id=$1',[requireId(req.params.id)])).rows[0];
    if (!campaign) throw fail('الرسالة غير موجودة.',404);
    const deliveries = (await pool.query('SELECT d.id,d.email,d.recipient_name,d.status,d.resend_email_id,d.delivered_at,d.opened_at,d.clicked_at,d.error,d.retryable,d.attempted_at,d.attempts,(SELECT e.created_at FROM message_unsubscribe_events e WHERE e.delivery_id=d.id) AS unsubscribed_at FROM email_deliveries d WHERE d.campaign_id=$1 ORDER BY d.created_at,d.id',[campaign.id])).rows;
    res.json({campaign,deliveries});
  });
  route('put','/campaigns/:id', async (req,res)=>{
    const p = draftPayload(req.body.payload), checked = await validateSend(p);
    if (checked.issues.length) throw fail(checked.issues.join('\n'));
    if (!checked.scheduledAt) throw fail('اختر موعدًا مستقبليًا لتعديل الجدولة.');
    res.json(await tx(async client=>{
      const campaign = (await client.query('SELECT * FROM email_campaigns WHERE id=$1 FOR UPDATE',[requireId(req.params.id)])).rows[0];
      if (!campaign || campaign.status !== 'scheduled') throw fail('بدأ الإرسال أو أُلغيت الجدولة؛ لا يمكن تعديل هذه الرسالة.',409);
      const changed = await client.query(`UPDATE email_campaigns SET subject=$1,body=$2,cta_label=$3,cta_url=$4,settings=$5,scheduled_at=$6,attachment_path=$7,course_name=$8,audience_snapshot=$9,audience=$10,total_recipients=$11,skipped_unsubscribed=$12 WHERE id=$13 RETURNING *`,[p.subject,p.message,p.ctaLabel,p.ctaUrl,mailSettings(p),checked.scheduledAt,p.attachmentPath,checked.courseName,p,p.audience,checked.recipients.length,checked.skippedUnsubscribed,campaign.id]);
      await client.query('DELETE FROM email_deliveries WHERE campaign_id=$1',[campaign.id]);
      for (const person of checked.recipients) await client.query("INSERT INTO email_deliveries(campaign_id,email,recipient_name,status) VALUES($1,$2,$3,'queued')",[campaign.id,person.email,person.name]);
      return changed.rows[0];
    }));
  });
  route('post','/campaigns/:id/cancel', async (req,res)=>{
    await tx(async client=>{
      const changed = await client.query("UPDATE email_campaigns SET status='cancelled',sending_at=NULL WHERE id=$1 AND status IN ('scheduled','queued') RETURNING id",[requireId(req.params.id)]);
      if (!changed.rowCount) throw fail('بدأ الإرسال بالفعل أو أُلغيت الرسالة.',409);
      await client.query("UPDATE email_deliveries SET status='cancelled',error='ألغت الإدارة الإرسال قبل بدئه.' WHERE campaign_id=$1 AND status='queued'",[req.params.id]);
    }); res.json({ok:true});
  });
  route('post','/campaigns/:id/retry', async (req,res)=>{
    if (!mailEnabled) throw fail('خدمة البريد غير مهيأة.',503);
    const result = await tx(async client=>{
      const campaign = (await client.query('SELECT * FROM email_campaigns WHERE id=$1 FOR UPDATE',[requireId(req.params.id)])).rows[0];
      if (!campaign || !['partial','failed','sent'].includes(campaign.status)) throw fail('هذه الرسالة قيد المعالجة أو غير قابلة لإعادة المحاولة.',409);
      const changed = await client.query("UPDATE email_deliveries SET status='queued',error='' WHERE campaign_id=$1 AND status='failed' AND retryable AND resend_email_id='' AND attempted_at>now()-interval '23 hours' RETURNING id",[campaign.id]);
      if (!changed.rowCount) throw fail('لا توجد محاولات آمنة للإعادة. المحاولات غير المؤكدة بعد 23 ساعة تحتاج مراجعة سجل المزود أولًا.');
      await client.query("UPDATE email_campaigns SET status='queued' WHERE id=$1",[campaign.id]); return changed.rowCount;
    }); res.json({queued:result}); void worker();
  });

  route('get','/contacts', async (req,res)=>{
    const where = contactWhere(req.query), page = Math.max(0,Math.min(10000,Number(req.query.page)||0));
    const total = (await pool.query('SELECT count(*)::int AS total FROM message_contacts c WHERE '+where.sql,where.params)).rows[0].total;
    const rows = (await pool.query(`SELECT c.*,(p.email IS NOT NULL) AS opted_out FROM message_contacts c LEFT JOIN message_suppressions p ON p.email=c.email WHERE ${where.sql} ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET $${where.params.length+1}`,[...where.params,page*50])).rows;
    res.json({rows,total,page,pageSize:50,mailboxVerified:false});
  });
  route('post','/contacts', async (req,res)=>{
    const r = contactRecord(req.body); if (r.invalid || (!r.name && !r.email)) throw fail('أدخل اسمًا أو بريدًا بصيغة صحيحة.');
    if(r.email) await assertMailAllowed(pool,r.email);
    const result = await pool.query('INSERT INTO message_contacts(full_name,email,normalized_email,language,tags,source) VALUES($1,$2,$2,$3,$4,$5) RETURNING *',[r.name,r.email,r.language,r.tags,r.source||'إضافة يدوية']);
    if(!result.rowCount)throw suppressionError();
    res.status(201).json(result.rows[0]);
  });
  route('put','/contacts/:id', async (req,res)=>{
    const r = contactRecord(req.body); if (r.invalid || (!r.name && !r.email)) throw fail('أدخل اسمًا أو بريدًا بصيغة صحيحة.');
    if(r.email) await assertMailAllowed(pool,r.email);
    const changed = await pool.query('UPDATE message_contacts SET full_name=$1,email=$2,normalized_email=$2,language=$3,tags=$4,source=$5,updated_at=now() WHERE id=$6 RETURNING *',[r.name,r.email,r.language,r.tags,r.source,requireId(req.params.id)]);
    if (!changed.rowCount) throw fail('جهة الاتصال غير موجودة.',404); res.json(changed.rows[0]);
  });
  route('get','/contacts/:id/history', async (req,res)=>{
    res.json((await pool.query('SELECT d.status,d.error,d.created_at,c.subject,c.id AS campaign_id FROM email_deliveries d JOIN message_contacts m ON m.email=d.email JOIN email_campaigns c ON c.id=d.campaign_id WHERE m.id=$1 ORDER BY d.created_at DESC LIMIT 100',[requireId(req.params.id)])).rows);
  });
  route('post','/contacts/selection', async (req,res)=>{
    const where = contactWhere(req.body.filters);
    const rows = req.body.all === true ? (await pool.query('SELECT c.id FROM message_contacts c WHERE '+where.sql,where.params)).rows : (await pool.query('SELECT id FROM message_contacts WHERE id=ANY($1::uuid[])',[(req.body.ids || []).filter(uuid).slice(0,50000)])).rows;
    if (!rows.length) throw fail('حدد جهة اتصال واحدة على الأقل.');
    for (const [key,value] of selections) if(value.until < Date.now()) selections.delete(key);
    if (selections.size > 100) throw fail('طلبات التحديد كثيرة. أعد المحاولة بعد قليل.',429);
    const token = crypto.randomUUID(); selections.set(token,{ids:rows.map(r=>r.id),until:Date.now()+600000});
    res.json({token,count:rows.length,scope:req.body.all ? 'جميع نتائج البحث الحالية' : 'جهات الاتصال المحددة'});
  });
  route('post','/contacts/bulk', async (req,res)=>{
    const selection = selections.get(req.body.token);
    if (!selection || selection.until < Date.now()) throw fail('انتهت صلاحية التحديد. أعد التحديد والمراجعة.');
    if (Number(req.body.count) !== selection.ids.length) throw fail('عدد الجهات تغيّر. راجع التحديد.');
    const result = await tx(async client=>{
      if (req.body.action === 'delete') return (await client.query('DELETE FROM message_contacts WHERE id=ANY($1::uuid[]) RETURNING id',[selection.ids])).rowCount;
      if (req.body.action === 'tag') return (await client.query('UPDATE message_contacts SET tags=ARRAY(SELECT DISTINCT unnest(tags || $2::text[])),updated_at=now() WHERE id=ANY($1::uuid[]) RETURNING id',[selection.ids,tags(req.body.tags)])).rowCount;
      if (req.body.action === 'language' && ['ar','en',''].includes(req.body.language)) return (await client.query('UPDATE message_contacts SET language=$2,updated_at=now() WHERE id=ANY($1::uuid[]) RETURNING id',[selection.ids,req.body.language])).rowCount;
      if (req.body.action === 'group') {
        requireId(req.body.listId); let count=0;
        for(const id of selection.ids) count += (await client.query('INSERT INTO message_recipient_list_members(list_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.body.listId,id])).rowCount;
        return count;
      }
      throw fail('اختر إجراءً جماعيًا صالحًا.');
    }); selections.delete(req.body.token); res.json({affected:result});
  });
  route('get','/contacts-export', async (req,res)=>{
    const w = contactWhere(req.query); let rows = (await pool.query('SELECT full_name,email,language,tags,source FROM message_contacts c WHERE '+w.sql+" AND c.email<>'' AND NOT c.suppressed AND NOT EXISTS(SELECT 1 FROM message_suppressions s WHERE s.email=c.email) AND NOT EXISTS(SELECT 1 FROM email_preferences p WHERE p.email=c.email AND p.marketing_opt_out) ORDER BY created_at,id",w.params)).rows;
    const blocked=await blockedEmails(pool,rows.map(r=>r.email)); rows=rows.filter(r=>!blocked.has(r.email));
    res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="inexc-contacts.csv"'}).send(csv([['الاسم','البريد الإلكتروني','اللغة','التصنيفات','المصدر'],...rows.map(r=>[r.full_name,r.email,r.language,r.tags.join('، '),r.source])]));
  });
  route('post','/import/inspect', async (req,res)=>{
    try {
      let data;
      if (req.file) data = await readContactFile(req.file,{review:true});
      else if (req.body.table) data = {rows:contactsFromRows(req.body.table,req.body.mapping,true),tables:[req.body.table]};
      else if (req.body.rows) data = {rows:req.body.rows};
      else {
        const text = clean(req.body.text,250000), first = text.split(/\r?\n/)[0];
        const delimiter = first.includes('\t')?'\t':first.includes(';')?';':',';
        let table; try {table=parseDelimited(text,delimiter)} catch {table=text.split(/\r?\n/).map(v=>[v])}
        data = {rows:contactsFromRows(table,null,true),tables:[table]};
      }
      res.json({...await reviewContacts(data.rows),tables:data.tables || [],ocrUsed:!!data.ocrUsed,source:req.file ? clean(req.file.originalname,180) : clean(req.body.source,180)||'نص ملصق'});
    } finally { if(req.file) await fs.unlink(req.file.path).catch(()=>{}); }
  },[importUpload.single('file')]);
  route('post','/import/commit', async (req,res)=>{
    const reviewed = await reviewContacts(req.body.rows);
    if (reviewed.counts.invalid) throw fail('صحح عناوين البريد غير الصالحة أو أزلها قبل الحفظ.');
    const rows = reviewed.rows.filter(r=>r.state!=='duplicate');
    if (!rows.length || rows.length>3000) throw fail('اختر بين جهة واحدة و3000 جهة فريدة للحفظ.');
    const result = await tx(async client=>{
      let listId = req.body.listId ? requireId(req.body.listId) : null;
      if (!listId && clean(req.body.listName,120)) listId = (await client.query('INSERT INTO message_recipient_lists(name) VALUES($1) RETURNING id',[clean(req.body.listName,120)])).rows[0].id;
      let added=0, existing=0, suppressed=0;
      const blocked=await blockedEmails(client,rows.map(r=>r.email));
      for (const r of rows) {
        if(blocked.has(r.email)){suppressed++;continue;}
        const source = r.source || clean(req.body.source,180), labelTags=tags([...r.tags,...tags(req.body.tags)]);
        let found = r.email ? (await client.query('SELECT id FROM message_contacts WHERE normalized_email=$1',[r.email])).rows[0] : null;
        if (found) existing++;
        else {
          const inserted = await client.query(`INSERT INTO message_contacts(full_name,email,normalized_email,language,tags,source) VALUES($1,$2,$2,$3,$4,$5) ON CONFLICT(normalized_email) WHERE normalized_email<>'' DO NOTHING RETURNING id`,[r.name,r.email,r.language,labelTags,source]);
          if(inserted.rowCount){ found=inserted.rows[0]; added++; }
          else { found=(await client.query('SELECT id FROM message_contacts WHERE normalized_email=$1',[r.email])).rows[0]; if(!found){suppressed++;continue;} existing++; }
        }
        if(listId) await client.query('INSERT INTO message_recipient_list_members(list_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[listId,found.id]);
      }
      return {added,existing,suppressed,listId};
    }); res.status(201).json(result);
  });
  route('post','/groups', async (req,res)=>{
    const name=clean(req.body.name,120); if(!name)throw fail('اكتب اسم المجموعة.');
    res.status(201).json((await pool.query('INSERT INTO message_recipient_lists(name) VALUES($1) RETURNING *',[name])).rows[0]);
  });
  route('put','/groups/:id', async(req,res)=>{
    const name=clean(req.body.name,120);if(!name)throw fail('اكتب اسم المجموعة.');
    const row=(await pool.query('UPDATE message_recipient_lists SET name=$1,updated_at=now() WHERE id=$2 RETURNING *',[name,requireId(req.params.id)])).rows[0];if(!row)throw fail('المجموعة غير موجودة.',404);res.json(row);
  });
  route('get','/templates', async(_req,res)=>res.json((await pool.query('SELECT * FROM message_templates ORDER BY updated_at DESC')).rows));
  route('put','/templates/:id', async(req,res)=>{
    const name=clean(req.body.name,120),p=draftPayload(req.body.payload);if(!name)throw fail('اكتب اسم القالب.');
    res.json((await pool.query(`INSERT INTO message_templates(id,name,subject,body,cta_label,cta_url,settings) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,subject=EXCLUDED.subject,body=EXCLUDED.body,cta_label=EXCLUDED.cta_label,cta_url=EXCLUDED.cta_url,settings=EXCLUDED.settings,updated_at=now() RETURNING *`,[requireId(req.params.id),name,p.subject,p.message,p.ctaLabel,p.ctaUrl,mailSettings(p)])).rows[0]);
  });
  route('get','/blocks', async(_req,res)=>res.json((await pool.query('SELECT * FROM message_blocks ORDER BY updated_at DESC')).rows));
  route('put','/blocks/:id', async(req,res)=>{
    const name=clean(req.body.name,120),body=normaliseMessageBody(req.body.body);if(!name||!body)throw fail('أدخل اسم الكتلة ومحتواها.');
    res.json((await pool.query('INSERT INTO message_blocks(id,name,body) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,body=EXCLUDED.body,updated_at=now() RETURNING *',[requireId(req.params.id),name,body])).rows[0]);
  });
  route('delete','/blocks/:id', async(req,res)=>{await pool.query('DELETE FROM message_blocks WHERE id=$1',[requireId(req.params.id)]);res.json({ok:true})});
}
