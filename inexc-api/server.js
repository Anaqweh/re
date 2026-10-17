import {membershipCardName,courseCardInput,attachCourseCardNames} from './course-card-access.js';
import {installSeoSitemap} from './seo-sitemap.js';
function trainingPackageText(value){return String(value??'').replaceAll('بطاق','باق');}
import {setupServiceCatalog, installServiceCatalog} from './service-catalog.js';
import {setupMembershipPayments, createMembershipPayments} from './membership-payments.js';
import {setupStripePayments, createStripePayments} from './stripe-payments.js';
import {setupLearnerService, installLearnerService, createCardRegistration, cardQuote} from './learner-service.js';
import {validateCoursePayment, setupCoursePaymentControls, coursePaymentInput, createCoursePaymentControls} from './course-payment.js';
import {setupMessageSubscriptions, installMessageSubscriptions} from './message-subscriptions.js';
import {subscriptionUrl} from './message-subscription-links.js';
import { normalizeEmail, assertMailAllowed, blockedEmails, suppressEmail, installSuppressionRoutes, deliveryUnsubscribeUrl } from './message-suppression.js';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { setupMessageStudio } from './message-studio-schema.js';
import { installMessageStudio } from './message-studio.js';
import { renderMail } from './message-mail.js';
import { readContactFile } from './message-contacts.js';
import { normaliseMessageBody, renderMessageBody, messageText, messageDirection } from './message-format.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const uploadDir = '/app/uploads';
const allowedOrigins = (process.env.PUBLIC_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
const sessions = new Map();
const adminRecoveryAttempts = new Map();
const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const emailFrom = String(process.env.EMAIL_FROM || 'INEXC Training <registrations@inexctraining.com>').trim();
const adminNotificationEmail = String(process.env.ADMIN_NOTIFICATION_EMAIL || '').trim();
const execFileAsync = promisify(execFile);

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.startsWith('CHANGE_')) {
  throw new Error('Set a real ADMIN_PASSWORD in .env before starting INEXC API.');
}
fs.mkdirSync(uploadDir, { recursive: true });

const pool = new Pool({
  host: process.env.PGHOST || 'db',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin not allowed'));
}}));
const membershipPayments=createMembershipPayments({pool,notify:sendMembershipActivationEmail});
const stripePayments=createStripePayments({pool,notify:sendRegistrationEmails,handleOtherCheckout:membershipPayments.handleWebhook});
stripePayments.installWebhook(app);
app.post('/api/webhooks/resend', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    const secret = String(process.env.RESEND_WEBHOOK_SECRET || '').trim();
    const raw = req.body.toString('utf8');
    if (!secret) return res.status(503).json({ error: 'Webhook غير مهيأ.' });
    const id = String(req.headers['svix-id'] || '');
    const timestamp = String(req.headers['svix-timestamp'] || '');
    const signatures = String(req.headers['svix-signature'] || '').split(' ').map(value => value.replace(/^v1,/, ''));
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');
    if (!id || !timestamp || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now()/1000-Number(timestamp))>300 || !signatures.some(signature => signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))) return res.status(401).json({ error: 'توقيع Webhook غير صالح.' });
    const event = JSON.parse(raw);
    const emailId = clean(event?.data?.email_id, 180);
    const type = clean(event?.type, 80);
    if (emailId && ['email.sent','email.delivered','email.opened','email.clicked','email.bounced','email.complained','email.failed','email.suppressed'].includes(type)) {
      await pool.query('INSERT INTO message_webhook_events(id,email_id,type) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,emailId,type]);
      await applyMessageEvent(emailId,type);
    }
    res.json({ ok: true });
  } catch (error) { console.error('Resend webhook error:', error); res.status(400).json({ error: 'Webhook غير صالح.' }); }
});
async function applyMessageEvent(emailId, type) {
  const statusMap = {'email.sent':'sent','email.delivered':'delivered','email.opened':'opened','email.clicked':'clicked','email.bounced':'bounced','email.complained':'complained','email.failed':'failed','email.suppressed':'skipped'};
  const status = statusMap[type]; if (!status) return;
  const updated = await pool.query(`UPDATE email_deliveries SET
    status=CASE WHEN status IN ('bounced','complained','failed','skipped') THEN status
      WHEN $1 IN ('bounced','complained','failed','skipped') THEN $1
      WHEN status='clicked' THEN status WHEN $1='clicked' THEN $1
      WHEN status='opened' THEN status WHEN $1='opened' THEN $1
      WHEN status='delivered' THEN status ELSE $1 END,
    delivered_at=CASE WHEN $1='delivered' THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
    opened_at=CASE WHEN $1='opened' THEN COALESCE(opened_at,now()) ELSE opened_at END,
    clicked_at=CASE WHEN $1='clicked' THEN COALESCE(clicked_at,now()) ELSE clicked_at END,
    retryable=false WHERE resend_email_id=$2 RETURNING email`,[status,emailId]);
  if (['bounced','complained','skipped'].includes(status)) for (const row of updated.rows) {
    await suppressEmail(pool,row.email,{reason:type==='email.complained'?'complaint':type==='email.bounced'?'bounce':'blocked',source:'provider'});
    await pool.query('UPDATE message_contacts SET suppressed=true,updated_at=now() WHERE normalized_email=$1',[row.email]);
    await pool.query('INSERT INTO email_preferences(email,unsubscribe_token,marketing_opt_out) VALUES($1,$2,true) ON CONFLICT(email) DO UPDATE SET marketing_opt_out=true,updated_at=now()',[row.email,crypto.randomBytes(24).toString('hex')]);
  }
}
app.use(express.json({ limit: '1mb' }));
stripePayments.installRoutes(app);
membershipPayments.install(app,auth);
app.use('/uploads/trainee-private', (_req,res)=>res.sendStatus(404));
app.use('/uploads', express.static(uploadDir, { maxAge: '1h', index: false, dotfiles: 'deny' }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitted = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    cb(permitted.includes(file.mimetype) ? null : new Error('Only PDF, JPG, PNG or WEBP receipts are accepted.'), permitted.includes(file.mimetype));
  }
});
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `brand-logo-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitted = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    cb(permitted.includes(file.mimetype) ? null : new Error('ارفع شعارًا بصيغة PNG أو JPG أو WEBP أو SVG.'), permitted.includes(file.mimetype));
  }
});
const courseMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `course-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitted = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    cb(permitted.includes(file.mimetype) ? null : new Error('ارفع صورة PNG أو JPG أو WEBP، أو نموذج شهادة PDF أو DOCX.'), permitted.includes(file.mimetype));
  }
});
const testimonialImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `testimonial-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitted = ['image/png', 'image/jpeg', 'image/webp'];
    cb(permitted.includes(file.mimetype) ? null : new Error('ارفع صورة PNG أو JPG أو WEBP.'), permitted.includes(file.mimetype));
  }
});
const messageAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `mail-${crypto.randomUUID()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitted = ['.pdf','.doc','.docx','.xls','.xlsx','.csv','.txt','.ppt','.pptx','.jpg','.jpeg','.png','.webp','.gif'];
    const allowed = permitted.includes(path.extname(file.originalname).toLowerCase());
    cb(allowed ? null : new Error('ارفع مستندًا أو صورة بصيغة مدعومة. لا تُقبل الملفات التنفيذية وصفحات HTML.'), allowed);
  }
});
const courseImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `course-import-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const permitted = ['.pdf', '.docx', '.txt', '.md'];
    cb(permitted.includes(ext) ? null : new Error('ارفع ملف PDF أو Word بصيغة DOCX أو ملف TXT أو MD.'), permitted.includes(ext));
  }
});

const courseAlertImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `course-alerts-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const permitted = ['.csv', '.txt', '.xlsx'];
    cb(permitted.includes(ext) ? null : new Error('ارفع ملف CSV أو TXT أو Excel بصيغة XLSX.'), permitted.includes(ext));
  }
});
const privateImportDir = '/app/private-imports';
fs.mkdirSync(privateImportDir, { recursive: true });
const messageRecipientImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, privateImportDir),
    filename: (_req, _file, cb) => cb(null, `message-list-${crypto.randomUUID()}`)
  }),
  // Detect the contents in readContactFile; extensions do not determine validity.
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

function clean(value, max = 400) { return String(value ?? '').trim().slice(0, max); }
function asNumber(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : 0; }
function reference() { return `IX-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
function courseSlug(id) { return `course-${String(id).replaceAll('-', '').slice(0, 12)}`; }
function publicUrl(req, value) {
  if (/^https?:\/\//i.test(String(value || ''))) return value;
  const host = req.get('host') || '';
  const protocol = /(^|\.)inexctraining\.com(?::\d+)?$/i.test(host) ? 'https' : req.protocol;
  return `${protocol}://${host}${value}`;
}
function courseAxes(value) { return String(value || '').split(/\r?\n/).map(item => item.replace(/^[\s•\-–—*\d.)]+/, '').trim()).filter(Boolean); }
function courseOutcomes(value) { return String(value || '').split(/\r?\n/).map(item => item.replace(/^[\s•\-–—*\d.)]+/, '').trim()).filter(Boolean).slice(0, 8); }
function hasReadableCourseText(value) {
  const lettersAndNumbers = String(value || '')
    .replace(/(?:^|\n)\s*[-–—]*\s*(?:page\s*)?\d+\s*(?:of|من)\s*\d+\s*[-–—]*\s*(?=\n|$)/gi, ' ')
    .match(/[\p{L}\p{N}]/gu) || [];
  return lettersAndNumbers.length >= 40;
}
async function extractPdfWithOcr(filePath) {
  const tempDir = await fs.promises.mkdtemp('/tmp/inexc-course-ocr-');
  try {
    const outputPrefix = path.join(tempDir, 'page');
    await execFileAsync('pdftoppm', ['-png', '-r', '200', filePath, outputPrefix], { maxBuffer: 2 * 1024 * 1024 });
    const pages = (await fs.promises.readdir(tempDir))
      .filter(file => /^page-\d+\.png$/i.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 12);
    const text = [];
    for (const page of pages) {
      const result = await execFileAsync('tesseract', [path.join(tempDir, page), 'stdout', '-l', 'ara+eng', '--psm', '6'], { maxBuffer: 5 * 1024 * 1024 });
      if (result.stdout) text.push(result.stdout);
    }
    return text.join('\n');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
function parseCourseDocument(raw) {
  const text = String(raw || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/(?:^|\n)\s*[-–—]*\s*(?:page\s*)?\d+\s*(?:of|من)\s*\d+\s*[-–—]*\s*(?=\n|$)/gi, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const isNoise = line => /^(?:[-–—\s]*\d+\s*(?:of|من)\s*\d+[-–—\s]*|page\s*\d+(?:\s*(?:of|من)\s*\d+)?)$/i.test(line) || /^[\-–—\s\d]+$/.test(line);
  const lines = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line && !isNoise(line));
  const labelValue = labels => {
    const pattern = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const index = lines.findIndex(line => new RegExp(`^(?:${pattern})\\s*[:：-]?`, 'i').test(line));
    if (index < 0) return '';
    const inline = lines[index].replace(new RegExp(`^(?:${pattern})\\s*[:：-]?\\s*`, 'i'), '').trim();
    return clean(inline || lines[index + 1] || '', 1000);
  };
  const axesHeading = /^(?:محاور(?: الدورة| البرنامج)?|الأهداف(?: التعليمية)?|المحتوى(?: التدريبي)?|موضوعات الدورة|المحور(?: الأول| الثاني| الثالث| الرابع| الخامس| السادس)?)\s*[:：-]?$/i;
  const outcomesHeading = /^(?:ماذا ستخرج به بعد الدورة|مخرجات الدورة|نواتج التعلم|النتائج المتوقعة|المهارات المكتسبة)\s*[:：-]?$/i;
  const axesIndex = lines.findIndex(line => axesHeading.test(line));
  const outcomesIndex = lines.findIndex(line => outcomesHeading.test(line));
  const firstEnd = [axesIndex, outcomesIndex].filter(index => index >= 0).sort((a,b) => a-b)[0] ?? lines.length;
  const firstPart = lines.slice(0, firstEnd);
  const inlineAxes = lines.filter(line => /^(?:المحور\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|\d+)|محور\s*\d+)\s*[:：-]\s*.+/i.test(line)).map(line => line.replace(/^(?:المحور\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|\d+)|محور\s*\d+)\s*[:：-]\s*/i, ''));
  const axisPart = axesIndex >= 0 ? lines.slice(axesIndex + 1, outcomesIndex > axesIndex ? outcomesIndex : lines.length) : (inlineAxes.length ? inlineAxes : lines.filter(line => /^[•\-–—*\d]+[.)]?\s+/.test(line)));
  const outcomesPart = outcomesIndex >= 0 ? lines.slice(outcomesIndex + 1) : [];
  const nameLabels = ['اسم الدورة', 'عنوان الدورة', 'اسم البرنامج', 'عنوان البرنامج'];
  const name = labelValue(nameLabels) || firstPart.find(line => line.length > 4 && !/^(الوصف|نبذة|مقدمة|تفاصيل الدورة|التاريخ|المكان|السعر|التصنيف|البرنامج التدريبي)/i.test(line) && !isNoise(line)) || '';
  const metadata = {
    category: labelValue(['التصنيف', 'الفئة', 'مجال الدورة']),
    date: labelValue(['التاريخ', 'الموعد', 'المدة', 'تاريخ الدورة']),
    location: labelValue(['المكان', 'الموقع', 'طريقة الحضور', 'نمط التنفيذ']),
    price: labelValue(['السعر', 'الرسوم', 'تكلفة الدورة', 'الرسوم الدراسية'])
  };
  const descriptionLabels = ['الوصف المختصر', 'وصف الدورة', 'الوصف', 'نبذة عن الدورة', 'النبذة', 'مقدمة الدورة', 'عن الدورة'];
  const descriptionIndex = lines.findIndex(line => new RegExp(`^(?:${descriptionLabels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[:：-]?`, 'i').test(line));
  let description = labelValue(descriptionLabels);
  if (descriptionIndex >= 0) {
    const afterHeading = lines.slice(descriptionIndex + 1, firstEnd).filter(line => !/^(?:التصنيف|الفئة|التاريخ|الموعد|المدة|المكان|الموقع|السعر|الرسوم)\s*[:：-]?/i.test(line) && !/^[•\-–—*\d]+[.)]?\s+/.test(line));
    if (afterHeading.length) description = clean([description, ...afterHeading].filter(Boolean).join(' '), 1000);
  }
  if (!description) {
    const ignored = new RegExp(`^(?:${[...nameLabels, 'الوصف', 'نبذة', 'مقدمة', 'التصنيف', 'الفئة', 'التاريخ', 'الموعد', 'المدة', 'المكان', 'الموقع', 'السعر', 'الرسوم'].map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[:：-]?`, 'i');
    description = firstPart.filter(line => line !== name && !ignored.test(line) && !/^[•\-–—*\d]+[.)]?\s+/.test(line)).join(' ');
  }
  const axes = courseAxes(axisPart.filter(line => !isNoise(line)).join('\n')).join('\n');
  if (!description && axes) description = `تتناول الدورة ${courseAxes(axes).slice(0, 4).join('، ')}.`;
  return { name: clean(name, 180), description: clean(description, 1000), axes, outcomes: courseOutcomes(outcomesPart.join('\n')).join('\n'), ...metadata };
}
function emailShell({ title, preview, content, direction = 'rtl' }) {
  const dir = direction === 'ltr' ? 'ltr' : 'rtl', align = dir === 'rtl' ? 'right' : 'left';
  const english = dir === 'ltr';
  return `<!doctype html><html lang="${english ? 'en' : 'ar'}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body dir="${dir}" style="direction:${dir};text-align:${align};margin:0;background:#eef5fc;color:#17324d;font-family:Tahoma,Arial,sans-serif;line-height:1.8"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${preview}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef5fc;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 32px rgba(15,70,120,.12)"><tr><td align="center" style="background:linear-gradient(135deg,#0866c6,#063f86);padding:30px 34px;color:#ffffff;text-align:center"><div style="font-size:12px;letter-spacing:1.6px;font-weight:700;opacity:.82">INEXC TRAINING</div><div style="font-size:25px;font-weight:800;margin-top:7px">${english ? 'Innovative Excellence' : 'شركة التميز الابتكاري'}</div><div style="font-size:13px;margin-top:5px;opacity:.9">${english ? 'Training that makes a real difference' : 'برامج تدريبية تصنع أثرًا حقيقيًا'}</div></td></tr><tr><td dir="${dir}" align="${align}" style="padding:32px 34px;direction:${dir};text-align:${align}">${content}</td></tr><tr><td style="padding:20px 34px;background:#f7fbff;border-top:1px solid #dceafb;text-align:center;color:#6b8095;font-size:11px">${english ? 'This is an automated message from INEXC Training. Please do not reply directly.' : 'هذه رسالة آلية من INEXC Training. يرجى عدم الرد عليها مباشرة.'}<br><a href="https://wa.me/971543475500" style="display:inline-block;margin:10px 0 7px;background:#18a957;color:#ffffff;text-decoration:none;padding:7px 14px;border-radius:999px;font-weight:700">${english ? 'Contact us on WhatsApp' : 'تواصل معنا عبر واتساب'} ‎+971 54 347 5500</a><br><span style="color:#0866c6;font-weight:700">inexctraining.com</span></td></tr></table></td></tr></table></body></html>`;
}
async function sendEmail({ to, subject, html, marketing = false, text = '', headers = {}, attachmentPath = '', idempotencyKey = '' }) {
  if (!resendApiKey || !to) return;
  if (marketing) await assertMailAllowed(pool,to);
  const payload = { from: emailFrom, to: [to], subject, html, ...(text ? {text} : {}), ...(Object.keys(headers).length ? {headers} : {}) };
  if (attachmentPath) {
    const fileName = path.basename(attachmentPath);
    const filePath = path.join(uploadDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error('تعذر العثور على المرفق. أعد رفعه قبل الإرسال.');
    payload.attachments = [{ filename: fileName.replace(/^mail-[a-f0-9-]+-/, ''), content: fs.readFileSync(filePath).toString('base64') }];
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = new Error(`Resend: ${await response.text()}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('retry-after')) || 2;
    throw error;
  }
  return response.json();
}
async function sendEmailWithRetry(message, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await sendEmail(message); }
    catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }
  throw lastError;
}
function sendRegistrationEmails(registration) {
  if (!resendApiKey) return;
  const name = escapeHtml(registration.name);
  const course = escapeHtml(registration.courseName);
  const referenceNumber = escapeHtml(registration.reference);
  const status = escapeHtml(registration.status);
  const amount = Number(registration.total).toLocaleString('ar-AE');
  const stripePaid = registration.paymentMethod === 'stripe';
  const confirmationTitle = stripePaid ? 'تم تأكيد دفعك وتسجيلك' : 'تم استلام طلب تسجيلك';
  const confirmationCopy = stripePaid ? 'شكرًا لثقتك بـ INEXC Training. تم استلام الدفع عبر Stripe وتأكيد تسجيلك في الدورة.' : 'شكرًا لثقتك بـ INEXC Training. تم تسجيل طلبك بنجاح، وستتم مراجعته والتواصل معك عند تأكيد التسجيل أو الدفع.';
  const details = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dceafb;border-radius:12px;overflow:hidden;margin:22px 0;font-size:13px"><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;width:38%">رقم الطلب</td><td style="padding:11px 14px;font-weight:800;color:#0866c6;direction:ltr;text-align:right">${referenceNumber}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">الدورة</td><td style="padding:11px 14px;font-weight:700;border-top:1px solid #dceafb">${course}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">الحالة</td><td style="padding:11px 14px;border-top:1px solid #dceafb"><span style="display:inline-block;background:#fff4d9;color:#9b6500;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700">${status}</span></td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">المبلغ</td><td style="padding:11px 14px;font-weight:800;border-top:1px solid #dceafb">${amount} د.إ</td></tr></table>`;
  const userHtml = emailShell({ title: confirmationTitle, preview: `${confirmationTitle} في دورة ${course}`, content: `<div style="font-size:23px;font-weight:800;color:#103b70">${confirmationTitle} ✓</div><p style="margin:13px 0 0;font-size:15px">مرحبًا <strong>${name}</strong>،</p><p style="margin:7px 0;color:#526c84;font-size:14px">${confirmationCopy}</p>${details}<div style="background:#eaf6ff;border-right:4px solid #0866c6;border-radius:8px;padding:12px 14px;color:#315a79;font-size:12px">احتفظ برقم الطلب للرجوع إليه عند التواصل مع فريقنا.</div><p style="margin:25px 0 0;font-size:14px">مع خالص التحية،<br><strong style="color:#103b70">فريق INEXC Training</strong></p>` });
  const adminHtml = emailShell({ title: 'طلب تسجيل جديد', preview: `طلب جديد من ${name} في دورة ${course}`, content: `<div style="font-size:23px;font-weight:800;color:#103b70">طلب تسجيل جديد</div><p style="margin:10px 0 0;color:#526c84;font-size:14px">تم استلام طلب جديد عبر الموقع. هذه تفاصيله:</p>${details}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px"><tr><td style="padding:8px 0;color:#6a8096;width:30%">الاسم</td><td style="padding:8px 0;font-weight:700">${name}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">البريد</td><td style="padding:8px 0;border-top:1px solid #e5eef6;direction:ltr;text-align:right">${escapeHtml(registration.email)}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">الموبايل</td><td style="padding:8px 0;border-top:1px solid #e5eef6;direction:ltr;text-align:right">${escapeHtml(registration.phone)}</td></tr></table><div style="margin-top:22px;text-align:center"><a href="https://www.inexctraining.com/admin-portal.html" style="display:inline-block;background:#0866c6;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:700">فتح لوحة الإدارة</a></div>` });
  void (async () => {
    try { await sendEmailWithRetry({ to: registration.email, subject: `${confirmationTitle} – ${registration.reference}`, html: userHtml }); }
    catch (error) { console.error('Registration confirmation email error:', error); }
    if (!adminNotificationEmail) return console.error('ADMIN_NOTIFICATION_EMAIL غير مضبوط؛ لم يتم إرسال إشعار الإدارة.');
    try {
      await sendEmailWithRetry({ to: adminNotificationEmail, subject: `طلب تسجيل جديد – ${registration.reference}`, html: adminHtml });
      console.log(`Admin registration notification sent: ${registration.reference}`);
    } catch (error) { console.error('Admin registration notification email error:', error); }
  })();
}
function sendInstitutionRequestEmails(request) {
  if (!resendApiKey) return;
  const name = escapeHtml(request.name);
  const organization = escapeHtml(request.organization);
  const details = escapeHtml(request.requestDetails).replace(/\n/g, '<br>');
  const info = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dceafb;border-radius:12px;overflow:hidden;margin:22px 0;font-size:13px"><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;width:38%">رقم الطلب</td><td style="padding:11px 14px;font-weight:800;color:#0866c6;direction:ltr;text-align:right">${escapeHtml(request.reference)}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">المؤسسة</td><td style="padding:11px 14px;font-weight:700;border-top:1px solid #dceafb">${organization}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">الشهادات</td><td style="padding:11px 14px;border-top:1px solid #dceafb">${escapeHtml(request.certificateInterest || 'غير محدد')}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">الاحتياج</td><td style="padding:11px 14px;border-top:1px solid #dceafb">${details}</td></tr></table>`;
  const userHtml = emailShell({ title: 'تم استلام طلب مؤسستكم', preview: 'تم استلام طلب البرنامج التدريبي', content: `<div style="font-size:23px;font-weight:800;color:#103b70">تم استلام طلب مؤسستكم ✓</div><p style="margin:13px 0 0;font-size:15px">مرحبًا <strong>${name}</strong>،</p><p style="margin:7px 0;color:#526c84;font-size:14px">شكرًا لثقتكم بـ INEXC Training. استلمنا تفاصيل احتياج مؤسستكم، وسيتواصل فريقنا معكم قريبًا لمناقشة البرنامج الأنسب.</p>${info}<p style="margin:25px 0 0;font-size:14px">مع خالص التحية،<br><strong style="color:#103b70">فريق INEXC Training</strong></p>` });
  const adminHtml = emailShell({ title: 'طلب مؤسسة جديد', preview: `طلب جديد من ${organization}`, content: `<div style="font-size:23px;font-weight:800;color:#103b70">طلب برنامج مؤسسي جديد</div><p style="margin:10px 0 0;color:#526c84;font-size:14px">ورد طلب جديد عبر الموقع:</p>${info}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px"><tr><td style="padding:8px 0;color:#6a8096;width:30%">الاسم</td><td style="padding:8px 0;font-weight:700">${name}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">البريد</td><td style="padding:8px 0;border-top:1px solid #e5eef6;direction:ltr;text-align:right">${escapeHtml(request.email)}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">الموبايل</td><td style="padding:8px 0;border-top:1px solid #e5eef6;direction:ltr;text-align:right">${escapeHtml(request.phone)}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">عدد المشاركين</td><td style="padding:8px 0;border-top:1px solid #e5eef6">${escapeHtml(request.audienceSize || 'غير محدد')}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">الموعد المفضل</td><td style="padding:8px 0;border-top:1px solid #e5eef6">${escapeHtml(request.preferredTiming || 'غير محدد')}</td></tr></table><div style="margin-top:22px;text-align:center"><a href="https://www.inexctraining.com/admin-portal.html" style="display:inline-block;background:#0866c6;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:700">فتح لوحة الإدارة</a></div>` });
  void Promise.allSettled([sendEmail({ to: request.email, subject: `تم استلام طلب مؤسستكم – ${request.reference}`, html: userHtml }), adminNotificationEmail ? sendEmail({ to: adminNotificationEmail, subject: `طلب مؤسسة جديد – ${request.reference}`, html: adminHtml }) : Promise.resolve()]).then(results => results.forEach(result => { if (result.status === 'rejected') console.error('Institution email error:', result.reason); }));
}
function auth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return res.status(401).json({ error: 'انتهت جلسة الإدارة. سجّل الدخول مجددًا.' });
  next();
}
function pruneSessions() { const now = Date.now(); for (const [key, value] of sessions) if (value.expiresAt < now) sessions.delete(key); }

async function setupDatabase() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', axes TEXT NOT NULL DEFAULT '', outcomes TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '',
    course_date TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'دورة تدريبية',
    price NUMERIC(10,2) NOT NULL DEFAULT 0, training_hours NUMERIC(8,2) NOT NULL DEFAULT 0, certificate_mode TEXT NOT NULL DEFAULT 'included',
    certificate_name TEXT NOT NULL DEFAULT 'شهادة إتمام', certificate_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_methods TEXT[] NOT NULL DEFAULT ARRAY['bank'], payment_link TEXT NOT NULL DEFAULT '',
    bank_name TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '', bank_iban TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reference TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT NOT NULL, course_id UUID REFERENCES courses(id) ON DELETE SET NULL, course_name TEXT NOT NULL,
    certificate TEXT NOT NULL DEFAULT 'لا', total NUMERIC(10,2) NOT NULL DEFAULT 0, payment_method TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'مسجل', receipt_path TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, price_usd NUMERIC(10,2) NOT NULL,
    max_cards INTEGER NOT NULL CHECK (max_cards > 0), valid_months INTEGER NOT NULL CHECK (valid_months > 0),
    booking_units INTEGER NOT NULL CHECK (booking_units > 0), course_unit_cost INTEGER NOT NULL DEFAULT 1,
    diploma_unit_cost INTEGER NOT NULL DEFAULT 1, certificate_discount NUMERIC(5,2) NOT NULL DEFAULT 0,
    early_access_hours INTEGER NOT NULL DEFAULT 0, perks TEXT NOT NULL DEFAULT '', payment_link TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // Existing installations already have this table; additive columns preserve their plans and orders.
  for (const column of [
    "feature_lines TEXT NOT NULL DEFAULT ''", "badge_text TEXT",
    "featured BOOLEAN NOT NULL DEFAULT FALSE", "stock_mode TEXT NOT NULL DEFAULT 'count'",
    "stock_label TEXT NOT NULL DEFAULT 'فرصتك ما زالت متاحة'",
    "low_stock_threshold INTEGER NOT NULL DEFAULT 15", "low_stock_label TEXT NOT NULL DEFAULT 'اقترب اكتمال الإصدار'", "sort_order INTEGER NOT NULL DEFAULT 0",
    "payment_methods TEXT[] NOT NULL DEFAULT ARRAY['bank']::TEXT[]"
  ]) await pool.query(`ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS ${column}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS membership_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reference TEXT UNIQUE NOT NULL,
    plan_id UUID NOT NULL REFERENCES membership_plans(id), name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
    total NUMERIC(10,2) NOT NULL, payment_method TEXT NOT NULL CHECK (payment_method IN ('bank','link')),
    status TEXT NOT NULL DEFAULT 'بانتظار مراجعة الدفع', receipt_path TEXT NOT NULL DEFAULT '',
    card_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS verified_reference TEXT NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS verified_amount NUMERIC(10,2)');
  await pool.query('ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ');
  await pool.query("ALTER TABLE membership_orders ADD COLUMN IF NOT EXISTS verified_currency TEXT NOT NULL DEFAULT ''");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS membership_orders_verified_payment_unique ON membership_orders (lower(verified_reference), verified_currency) WHERE verified_reference <> ''");
  await pool.query(`CREATE TABLE IF NOT EXISTS membership_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), card_number TEXT UNIQUE NOT NULL, access_token TEXT UNIQUE NOT NULL,
    plan_id UUID NOT NULL REFERENCES membership_plans(id), order_id UUID UNIQUE REFERENCES membership_orders(id) ON DELETE SET NULL,
    holder_name TEXT NOT NULL, holder_email TEXT NOT NULL, holder_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired')),
    units_total INTEGER NOT NULL, units_remaining INTEGER NOT NULL, activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('ALTER TABLE membership_cards ADD COLUMN IF NOT EXISTS share_token TEXT');
  await pool.query('ALTER TABLE membership_cards ADD COLUMN IF NOT EXISTS share_image BYTEA');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS membership_cards_share_token_unique ON membership_cards(share_token) WHERE share_token IS NOT NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS membership_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), card_id UUID NOT NULL REFERENCES membership_cards(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT, registration_id UUID,
    units_used INTEGER NOT NULL, course_kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'used',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('ALTER TABLE registrations ADD COLUMN IF NOT EXISTS membership_card_id UUID');
  await pool.query('ALTER TABLE registrations ADD COLUMN IF NOT EXISTS membership_redemption_id UUID');
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS membership_enabled BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS membership_plan_ids UUID[] DEFAULT NULL');
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS membership_kind TEXT NOT NULL DEFAULT \'course\'');
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS member_booking_opens_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS public_booking_opens_at TIMESTAMPTZ');
  await pool.query(`INSERT INTO membership_plans (slug,name,price_usd,max_cards,valid_months,booking_units,course_unit_cost,diploma_unit_cost,certificate_discount,early_access_hours,perks)
    VALUES
    ('launch','باقة الانطلاقة',39,100,4,2,1,1,0,0,'حجز دورتين أو دبلومين مباشرين أونلاين خلال مدة الباقة.'),
    ('mastery','باقة التمكّن',79,100,6,3,1,1,10,24,'3 حجوزات تدريبية مباشرة أونلاين + خصم 10% على رسوم الشهادات.'),
    ('leadership','باقة الريادة',179,100,12,30,5,6,10,72,'6 دورات أو حتى 5 دبلومات + أولوية الحجز + جلسة إرشادية جماعية أو ورشة حصرية.')
    ON CONFLICT (slug) DO NOTHING`);
  await pool.query(`UPDATE membership_plans SET badge_text=CASE WHEN slug='mastery' THEN 'الأكثر توازنًا' ELSE '' END,
    featured=(slug='mastery'), sort_order=CASE slug WHEN 'launch' THEN 1 WHEN 'mastery' THEN 2 WHEN 'leadership' THEN 3 ELSE sort_order END
    WHERE badge_text IS NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS testimonials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, content TEXT NOT NULL,
    image_path TEXT NOT NULL DEFAULT '', rating SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
    verified BOOLEAN NOT NULL DEFAULT FALSE, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','visible','hidden','featured')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS course_alert_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE, suppressed BOOLEAN NOT NULL DEFAULT FALSE, unsubscribe_token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS course_alert_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID NOT NULL REFERENCES course_alert_subscribers(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    resend_email_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued',
    error TEXT NOT NULL DEFAULT '', send_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS course_alert_unique_delivery ON course_alert_deliveries (subscriber_id, course_id)');
  await pool.query('ALTER TABLE course_alert_deliveries ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ NOT NULL DEFAULT now()');
  await pool.query('ALTER TABLE course_alert_deliveries ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE course_alert_subscribers ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('UPDATE course_alert_subscribers SET suppressed=true WHERE active=false AND suppressed=false');
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS share_slug TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS image_path TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS certificate_sample_path TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS axes TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS outcomes TEXT NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS training_hours NUMERIC(8,2) NOT NULL DEFAULT 0');
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS request_kind TEXT NOT NULL DEFAULT 'individual'");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS request_details TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS audience_size TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS preferred_timing TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS certificate_interest TEXT NOT NULL DEFAULT ''");
  await pool.query("UPDATE courses SET share_slug = 'course-' || replace(left(id::text, 12), '-', '') WHERE share_slug = ''");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS courses_share_slug_unique ON courses(share_slug)');
  await pool.query(`CREATE TABLE IF NOT EXISTS email_preferences (
    email TEXT PRIMARY KEY, unsubscribe_token TEXT UNIQUE NOT NULL,
    marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    cta_label TEXT NOT NULL DEFAULT '', cta_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS message_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', normalized_email TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (full_name <> '' OR email <> '')
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS message_contacts_email_unique ON message_contacts(normalized_email) WHERE normalized_email <> \'\'');
  await pool.query(`CREATE TABLE IF NOT EXISTS message_recipient_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS message_recipient_list_members (
    list_id UUID NOT NULL REFERENCES message_recipient_lists(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES message_contacts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (list_id, contact_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subject TEXT NOT NULL, body TEXT NOT NULL,
    audience TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  for (const column of [
    'template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL', "cta_label TEXT NOT NULL DEFAULT ''", "cta_url TEXT NOT NULL DEFAULT ''",
    "attachment_path TEXT NOT NULL DEFAULT ''", "status TEXT NOT NULL DEFAULT 'sent'", 'scheduled_at TIMESTAMPTZ', 'sending_at TIMESTAMPTZ', 'sent_at TIMESTAMPTZ',
    'total_recipients INTEGER NOT NULL DEFAULT 0', 'skipped_unsubscribed INTEGER NOT NULL DEFAULT 0', "course_name TEXT NOT NULL DEFAULT ''"
  ]) await pool.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ${column}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
    email TEXT NOT NULL, recipient_name TEXT NOT NULL DEFAULT '', resend_email_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'sent', delivered_at TIMESTAMPTZ, opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ,
    error TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'");
  await pool.query('ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_resend_id_unique ON email_deliveries(resend_email_id) WHERE resend_email_id <> \'\'');
  await setupMessageStudio(pool);
  await setupMessageSubscriptions(pool);
  const count = await pool.query('SELECT count(*)::int AS count FROM courses');
  if (count.rows[0].count === 0) {
    await pool.query(`INSERT INTO courses (name, description, trainer, course_date, location, category, price, certificate_mode, certificate_name, certificate_price, payment_methods, active)
      VALUES
      ('الذكاء الاصطناعي في التعليم', 'تطبيقات عملية تجعل الذكاء الاصطناعي مساعدًا فعّالًا للمعلم والمتعلم.', '', '', 'عن بُعد / حضوري', 'الذكاء الاصطناعي', 800, 'included', 'شهادة إتمام معتمدة', 0, ARRAY['link','bank'], true),
      ('الابتكار القيادي وتصميم مبادرات المستقبل', 'برنامج للقادة الراغبين في تحويل الأفكار إلى مبادرات قابلة للتنفيذ والقياس.', '', '', 'حضوري', 'تطوير قيادي', 0, 'optional', 'شهادة إتمام البرنامج', 250, ARRAY['bank'], true),
      ('تمكين المعلمين في عصر التحول الرقمي', 'أدوات واستراتيجيات عملية لبناء صف أكثر تفاعلًا وقرارات تعليمية مبنية على البيانات.', '', '', 'عن بُعد', 'التحول الرقمي', 600, 'none', '', 0, ARRAY['link'], true)`);
  }
}

function publicCourse(row) {
  const savedBankName = row.bank_name || '';
  const bankParts = savedBankName.match(/^اسم البنك:\s*(.*?)\s*\|\s*صاحب الحساب:\s*(.*)$/);
  return {
    id: row.id, name: row.name, description: row.description, axes: courseAxes(row.axes), outcomes: courseOutcomes(row.outcomes), trainer: row.trainer, date: row.course_date,
    location: row.location, category: row.category, price: Number(row.price), hours: Number(row.training_hours || 0),
    certificate: { mode: row.certificate_mode, name: row.certificate_name, price: Number(row.certificate_price) },
    payments: row.payment_methods, paymentsManaged:true, paymentLink: row.payment_link,
    bank: { title: bankParts?.[1] || '', name: bankParts?.[2] === '—' ? '' : (bankParts?.[2] || savedBankName), account: row.bank_account, iban: row.bank_iban },
    imageUrl: row.image_path || '', certificateSampleUrl: row.certificate_sample_path || '',
    shareSlug: row.share_slug || courseSlug(row.id), shareUrl: `https://courses.inexctraining.com/${row.share_slug || courseSlug(row.id)}`,
    featured: row.featured === true, membershipPlanIds: row.membership_plan_ids ?? null, membershipCardNames: row.membership_card_names || [],
    membershipEnabled: row.membership_enabled !== false, membershipKind: row.membership_kind || 'course',
    memberBookingOpensAt: row.member_booking_opens_at || null, publicBookingOpensAt: row.public_booking_opens_at || null,
    active: row.active
  };
}

async function extractAlertEmails(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  let raw = '';
  if (ext === '.xlsx') {
    const result = await execFileAsync('unzip', ['-p', file.path], { maxBuffer: 12 * 1024 * 1024 });
    raw = result.stdout || '';
  } else {
    raw = await fs.promises.readFile(file.path, 'utf8');
  }
  const found = String(raw).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(found.map(value => value.trim().toLowerCase()).filter(value => alertEmailPattern.test(value)))];
}

async function getEmailPreference(email) {
  const normalized = clean(String(email || '').toLowerCase(), 190);
  const created = await pool.query('INSERT INTO email_preferences (email,unsubscribe_token) VALUES ($1,$2) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING email,unsubscribe_token,marketing_opt_out', [normalized, crypto.randomBytes(24).toString('hex')]);
  const preference=created.rows[0];
  if ((await blockedEmails(pool,[normalized])).size) preference.marketing_opt_out=true;
  return preference;
}
const emailPreferenceUnsubscribeUrl = token => 'https://api.inexctraining.com/api/email-preferences/unsubscribe?token=' + encodeURIComponent(token);

const alertEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const messagePlaceholderPattern = /\{\{(name|email|course)\}\}/g;

function safeMessageUrl(value) {
  const raw = clean(value, 600);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch (_error) { return ''; }
}

function normaliseMessageContact(value = {}) {
  const email = clean(String(value.email || '').trim().toLowerCase(), 180);
  const name = clean(String(value.name || value.full_name || '').trim(), 160);
  return { name, email: alertEmailPattern.test(email) ? email : '' };
}

function parseMessageRecipientText(value) {
  const rows = [];
  for (const line of String(value || '').split(/\r?\n|;/)) {
    const emails = (line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(email => email.toLowerCase());
    const name = clean(line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/[<>,|]/g, ' ').trim(), 160);
    if (emails.length) emails.forEach((email, index) => rows.push(normaliseMessageContact({ name: index === 0 ? name : '', email })));
    else if (name) rows.push(normaliseMessageContact({ name, email: '' }));
  }
  return rows;
}

function normaliseMessageContacts(rows, limit = 1000) {
  const output = [], seenEmails = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const contact = normaliseMessageContact(row || {});
    if (contact.email && seenEmails.has(contact.email)) continue;
    if (contact.email) seenEmails.add(contact.email);
    if (contact.email || contact.name) output.push(contact);
    if (output.length > limit) throw new Error(`الحد الأقصى ${limit} جهة. قسّم البيانات إلى قوائم أصغر.`);
  }
  return output;
}

function mergeMessageVariables(value, person = {}, courseName = '') {
  const variables = { name: person.name || '', email: person.email || '', course: courseName || '' };
  return String(value || '').replace(messagePlaceholderPattern, (_match, key) => variables[key] || '');
}

function messageEmailMarkup({ subject, body, ctaLabel = '', ctaUrl = '', person = {}, preference, courseName = '' }) {
  const renderedSubject = mergeMessageVariables(subject, person, courseName);
  const rendered = renderMessageBody(body, { name: person.name || '', email: person.email || '', course: courseName });
  const dir = rendered.direction, align = dir === 'rtl' ? 'right' : 'left', english = dir === 'ltr';
  const renderedCtaLabel = mergeMessageVariables(ctaLabel, person, courseName);
  const renderedCtaUrl = safeMessageUrl(mergeMessageVariables(ctaUrl, person, courseName));
  const greeting = english
    ? (person.name ? `Hello <strong>${escapeHtml(person.name)}</strong>,` : 'Hello,')
    : (person.name ? `مرحبًا <strong>${escapeHtml(person.name)}</strong>،` : 'مرحبًا،');
  const action = renderedCtaLabel && renderedCtaUrl
    ? `<div style="text-align:${align};margin:26px 0 0"><a href="${escapeHtml(renderedCtaUrl)}" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:800">${escapeHtml(renderedCtaLabel)}</a></div>`
    : '';
  const unsubscribe = preference?.unsubscribe_token
    ? `<p dir="${dir}" style="margin:22px 0 0;text-align:${align};font-size:11px;color:#7890a8">${english ? 'Prefer not to receive INEXC emails?' : 'لا ترغب في تلقي رسائل INEXC؟'} <a href="${emailPreferenceUnsubscribeUrl(preference.unsubscribe_token)}" style="color:#0866c6">${english ? 'Unsubscribe' : 'إلغاء الاشتراك'}</a></p>`
    : '';
  const subjectDir = messageDirection(renderedSubject, dir);
  return {
    subject: renderedSubject,
    html: emailShell({
      title: escapeHtml(renderedSubject), direction: dir,
      preview: escapeHtml(rendered.text.slice(0, 120)),
      content: `<div dir="${dir}" style="direction:${dir};text-align:${align}"><div dir="${subjectDir}" style="text-align:${subjectDir === 'rtl' ? 'right' : 'left'};font-size:23px;font-weight:800;color:#103b70">${escapeHtml(renderedSubject)}</div><p dir="${dir}" style="margin:18px 0 12px;text-align:${align};font-size:15px;color:#304d67">${greeting}</p><div dir="${dir}" style="margin:12px 0 0;direction:${dir};text-align:${align};font-size:16px;color:#304d67;line-height:1.9">${rendered.html}</div>${action}<p dir="${dir}" style="margin:26px 0 0;text-align:${align};font-size:14px">${english ? 'Kind regards,' : 'مع خالص التحية،'}<br><strong style="color:#103b70">${english ? 'The INEXC Training Team' : 'فريق INEXC Training'}</strong></p>${unsubscribe}</div>`
    })
  };
}

async function resolveMessageRecipients(input = {}) {
  const audience = clean(input.audience, 20);
  const ids = Array.isArray(input.ids) ? input.ids.map(value => clean(value, 80)).filter(Boolean).slice(0, 3001) : [];
  const courseId = clean(input.courseId, 80);
  const listId = clean(input.listId, 80);
  const supplied = [
    ...normaliseMessageContacts(input.recipientRows, 3000),
    ...parseMessageRecipientText(input.extraRecipients || input.extraEmails || '')
  ].slice(0, 3001);
  if (!['all', 'selected', 'course', 'unpaid', 'custom', 'list'].includes(audience)) throw new Error('اختر شريحة المستلمين.');
  if (audience === 'selected' && !ids.length && !supplied.length) throw new Error('حدد شخصًا واحدًا على الأقل أو أضف عناوين خارجية.');
  if (audience === 'course' && !courseId) throw new Error('اختر الدورة المطلوبة.');
  if (audience === 'list' && !listId) throw new Error('اختر قائمة المستلمين.');
  if (audience === 'custom' && !supplied.length) throw new Error('أضف اسمًا أو بريدًا واحدًا على الأقل.');
  let registeredRecipients = [];
  let courseName = '';
  if (courseId) {
    const course = await pool.query('SELECT name FROM courses WHERE id=$1', [courseId]);
    courseName = course.rows[0]?.name || '';
  }
  if (audience === 'all') registeredRecipients = (await pool.query("SELECT DISTINCT email,name FROM registrations WHERE email <> '' ORDER BY email LIMIT 3001")).rows;
  else if (audience === 'selected') registeredRecipients = (await pool.query("SELECT DISTINCT email,name FROM registrations WHERE id = ANY($1::uuid[]) AND email <> '' ORDER BY email", [ids])).rows;
  else if (audience === 'course') registeredRecipients = (await pool.query("SELECT DISTINCT email,name FROM registrations WHERE course_id=$1 AND email <> '' ORDER BY email LIMIT 3001", [courseId])).rows;
  else if (audience === 'unpaid') registeredRecipients = (await pool.query("SELECT DISTINCT email,name FROM registrations WHERE total > 0 AND status NOT IN ('مدفوع','مؤكد') AND email <> '' ORDER BY email LIMIT 3001")).rows;
  else if (audience === 'list') registeredRecipients = (await pool.query(`SELECT c.email,c.full_name AS name FROM message_recipient_list_members m
    JOIN message_contacts c ON c.id=m.contact_id WHERE m.list_id=$1 AND c.email<>'' ORDER BY c.created_at ASC LIMIT 3001`, [listId])).rows;
  const seen = new Set();
  const candidates = [...registeredRecipients, ...supplied].map(normaliseMessageContact).filter(person => {
    if (!person.email || seen.has(person.email)) return false;
    seen.add(person.email); return true;
  }).slice(0, 3001);
  if (candidates.length > 3000) throw new Error('الحد الأقصى للإرسال 3000 مستلم. اختر قائمة أصغر.');
  if (!candidates.length) throw new Error('لا يوجد عنوان بريد صالح للإرسال. تُحفظ الأسماء بلا بريد في القوائم للمراجعة فقط.');
  const preferences = await pool.query('SELECT email,true AS marketing_opt_out FROM message_suppressions WHERE email = ANY($1::text[])', [candidates.map(person => person.email)]);
  const optedOut = await blockedEmails(pool,candidates.map(person=>person.email));
  preferences.rows.forEach(row=>optedOut.add(row.email));
  return { audience, courseName, recipients: candidates.filter(person => !optedOut.has(person.email)), skippedUnsubscribed: candidates.filter(person => optedOut.has(person.email)).length, totalCandidates: candidates.length };
}

async function saveMessageRecipientList(name, rawRows) {
  const listName = clean(name, 120);
  const rows = normaliseMessageContacts(rawRows, 3000);
  if (!listName) throw new Error('اكتب اسمًا واضحًا للقائمة.');
  if (!rows.length) throw new Error('لم نجد أسماء أو عناوين صالحة في الملف.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query('INSERT INTO message_recipient_lists(name) VALUES($1) RETURNING id,name,created_at', [listName]);
    let withEmail = 0, skippedUnsubscribed=0;
    const blocked=await blockedEmails(client,rows.map(r=>r.email));
    for (const row of rows) {
      if(blocked.has(row.email)){skippedUnsubscribed++;continue;}
      let contact;
      if (row.email) {
        withEmail += 1;
        contact = await client.query(`INSERT INTO message_contacts(full_name,email,normalized_email) VALUES($1,$2,$2)
          ON CONFLICT (normalized_email) WHERE normalized_email <> '' DO UPDATE SET full_name=CASE WHEN EXCLUDED.full_name<>'' THEN EXCLUDED.full_name ELSE message_contacts.full_name END, updated_at=now()
          RETURNING id`, [row.name, row.email]);
      } else {
        contact = await client.query('INSERT INTO message_contacts(full_name,email,normalized_email) VALUES($1,\'\',\'\') RETURNING id', [row.name]);
      }
      if(!contact.rowCount){skippedUnsubscribed++;withEmail--;continue;}
      await client.query('INSERT INTO message_recipient_list_members(list_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [created.rows[0].id, contact.rows[0].id]);
    }
    await client.query('COMMIT');
    return { ...created.rows[0], imported: rows.length-skippedUnsubscribed, withEmail, needsEmail: rows.length-skippedUnsubscribed-withEmail, skippedUnsubscribed };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function extractMessageContacts(file) {
  return normaliseMessageContacts(await readContactFile(file), 3000);
}

async function deliverMessageCampaign(campaignId) {
  const campaign = (await pool.query('SELECT * FROM email_campaigns WHERE id=$1', [campaignId])).rows[0];
  if (!campaign || campaign.status !== 'sending') return;
  const pending = await pool.query("SELECT id,email,recipient_name,attempted_at,payload_snapshot,unsubscribe_token FROM email_deliveries WHERE campaign_id=$1 AND status='queued' ORDER BY created_at ASC", [campaignId]);
  for (const delivery of pending.rows) {
    try {
      // Resend retains idempotency keys for 24h. Never replay an uncertain older attempt.
      if (delivery.attempted_at && Date.now() - new Date(delivery.attempted_at).getTime() > 23 * 60 * 60 * 1000) {
        throw new Error('توقّف الإرسال بعد محاولة قديمة غير مؤكدة. راجع سجل المزود قبل إعادة الإرسال.');
      }
      const preference = await getEmailPreference(delivery.email);
      const suppressed = (await pool.query('SELECT suppressed FROM message_contacts WHERE normalized_email=$1',[delivery.email])).rows[0]?.suppressed;
      if (preference.marketing_opt_out || suppressed) {
        await pool.query("UPDATE email_deliveries SET status='skipped',error='ألغى المستلم اشتراكه قبل الإرسال.' WHERE id=$1", [delivery.id]);
        continue;
      }
      const message = delivery.payload_snapshot || {...renderMail({ subject: campaign.subject, body: campaign.body, ctaLabel: campaign.cta_label, ctaUrl: campaign.cta_url,
        person: {name:delivery.recipient_name,email:delivery.email}, settings:campaign.settings || {}, courseName:campaign.course_name,
        shareUrl:subscriptionUrl(campaign.subscription_code,true),
        unsubscribeUrl:deliveryUnsubscribeUrl(delivery.unsubscribe_token) }),headers:{'List-Unsubscribe':'<'+deliveryUnsubscribeUrl(delivery.unsubscribe_token)+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
      // Persist exact content once: retrying an idempotency key requires an unchanged payload.
      await pool.query('UPDATE email_deliveries SET attempted_at=COALESCE(attempted_at,now()),payload_snapshot=COALESCE(payload_snapshot,$2) WHERE id=$1', [delivery.id,message]);
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await pool.query('UPDATE email_deliveries SET attempts=attempts+1 WHERE id=$1',[delivery.id]);
          result = await sendEmail({ to: delivery.email, marketing:true, subject: message.subject, html: message.html, text:message.text || '', headers:message.headers || {'List-Unsubscribe':'<'+emailPreferenceUnsubscribeUrl(preference.unsubscribe_token)+'>'}, attachmentPath: campaign.attachment_path, idempotencyKey: `message/${delivery.id}` });
          if (!result?.id) throw new Error('لم يؤكّد مزود البريد قبول الرسالة.');
          break;
        } catch (error) {
          const retryable = !error.status || error.status === 429 || error.status >= 500;
          if (!retryable || attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.min(60000, Math.max(2, error.retryAfter || 2 ** (attempt + 1)) * 1000)));
        }
      }
      await pool.query("UPDATE email_deliveries SET status='sent',resend_email_id=$1,error='',retryable=false WHERE id=$2", [clean(result.id, 180), delivery.id]);
      const events = await pool.query('SELECT type FROM message_webhook_events WHERE email_id=$1 ORDER BY received_at',[result.id]);
      for (const event of events.rows) await applyMessageEvent(result.id,event.type);
    } catch (error) {
      if(error.code==='EMAIL_SUPPRESSED'){await pool.query("UPDATE email_deliveries SET status='skipped',retryable=false,error=$1 WHERE id=$2",[error.message,delivery.id]);continue;}
      const retryable = (!error.status || error.status === 429 || error.status >= 500) && (!delivery.attempted_at || Date.now()-new Date(delivery.attempted_at).getTime()<23*3600000);
      await pool.query("UPDATE email_deliveries SET status='failed',error=$1,retryable=$3 WHERE id=$2", [clean(error.message, 500), delivery.id,retryable]);
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(650,Number(process.env.MESSAGE_SEND_INTERVAL_MS)||1000)));
  }
  const counts = (await pool.query(`SELECT count(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked'))::int AS sent,
    count(*) FILTER (WHERE status IN ('failed','bounced','complained'))::int AS failed FROM email_deliveries WHERE campaign_id=$1`, [campaignId])).rows[0];
  const status = counts.failed ? (counts.sent ? 'partial' : 'failed') : (counts.sent ? 'sent' : 'completed');
  await pool.query("UPDATE email_campaigns SET status=$1,sent_at=now(),sending_at=NULL WHERE id=$2", [status, campaignId]);
}

let messageWorkerRunning = false;
async function processScheduledMessageCampaigns() {
  if (messageWorkerRunning || !resendApiKey) return;
  messageWorkerRunning = true;
  let client, locked = false;
  try {
    client = await pool.connect();
    // A connection-scoped database lock also prevents overlap across server replicas.
    locked = (await client.query('SELECT pg_try_advisory_lock(84621931) AS locked')).rows[0].locked;
    if (!locked) return;
    const claimed = await client.query(`WITH due AS (
      SELECT id FROM email_campaigns WHERE status IN ('queued','sending') OR (status='scheduled' AND scheduled_at<=now())
      ORDER BY created_at ASC LIMIT 3 FOR UPDATE SKIP LOCKED
    ) UPDATE email_campaigns c SET status='sending',sending_at=now() FROM due WHERE c.id=due.id RETURNING c.id`);
    for (const row of claimed.rows) await deliverMessageCampaign(row.id);
  } catch (error) { console.error('Scheduled message campaign error:', error); }
  finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(84621931)'); }
    catch (error) { client.release(error); client = null; console.error('Message worker unlock error:', error.message); }
    finally { client?.release(); messageWorkerRunning = false; }
  }
}

const unsubscribeUrl = token => `https://api.inexctraining.com/api/course-alerts/unsubscribe?token=${encodeURIComponent(token)}`;
const coursePublicUrl = course => `https://www.inexctraining.com/course/?id=${encodeURIComponent(course.id)}`;

const defaultCourseAlertSubject = 'دورة جديدة: {course_name} | INEXC Training';
const defaultCourseAlertMessage = 'أهلًا بك، تم نشر دورة جديدة بعنوان {course_name}.\n\n{course_description}\n\nالتاريخ أو المدة: {course_date}\nطريقة التنفيذ: {course_location}\nعدد الساعات: {course_hours}';
function mergeCourseAlertTemplate(template, course) {
  const values = {
    course_name: course.name || '',
    course_description: course.description || '',
    course_date: course.date || 'يُعلن لاحقًا',
    course_location: course.location || 'يُعلن لاحقًا',
    course_hours: course.hours ? String(course.hours) + ' ساعة تدريبية' : 'يُعلن لاحقًا'
  };
  return String(template || '').replace(/\{(course_name|course_description|course_date|course_location|course_hours)\}/g, (_match, key) => values[key] || '');
}
async function getCourseAlertSettings() {
  const result = await pool.query("SELECT key,value FROM app_settings WHERE key IN ('course_alerts_enabled','course_alert_delay_minutes','course_alert_subject','course_alert_message','course_alert_delivery_mode','course_alert_batch_size')");
  const values = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
  const delay = Number(values.course_alert_delay_minutes || 60);
  return {
    enabled: values.course_alerts_enabled !== 'false',
    delayMinutes: Math.max(0, Math.min(10080, Number.isFinite(delay) ? delay : 60)),
    deliveryMode: values.course_alert_delivery_mode === 'manual' ? 'manual' : 'auto',
    batchSize: [100,200,300,400,500].includes(Number(values.course_alert_batch_size)) ? Number(values.course_alert_batch_size) : 100,
    subject: clean(values.course_alert_subject || defaultCourseAlertSubject, 220),
    message: clean(values.course_alert_message || defaultCourseAlertMessage, 4000)
  };
}

async function queueCourseAlertEmails(course) {
  if (!course?.active) return;
  try {
    const settings = await getCourseAlertSettings();
    if (!settings.enabled) return;
    const subscribers = await pool.query("SELECT s.id FROM course_alert_subscribers s LEFT JOIN email_preferences p ON p.email=s.email WHERE s.active=true AND COALESCE(p.marketing_opt_out,false)=false ORDER BY s.created_at ASC");
    const sendAfter = new Date(Date.now() + settings.delayMinutes * 60 * 1000);
    for (const subscriber of subscribers.rows) {
      await pool.query(`INSERT INTO course_alert_deliveries (subscriber_id,course_id,status,send_after)
        VALUES ($1,$2,'queued',$3)
        ON CONFLICT (subscriber_id,course_id) DO NOTHING`, [subscriber.id, course.id, sendAfter]);
    }
  } catch (error) { console.error('Course alert queue failed:', error.message); }
}

async function processCourseAlertQueue(options = {}) {
  if (!resendApiKey) return;
  try {
    const settings = await getCourseAlertSettings();
    const force = options.force === true;
    const courseId = clean(options.courseId, 80);
    const requestedLimit = Number(options.limit);
    const limit = [100,200,300,400,500].includes(requestedLimit) ? requestedLimit : settings.batchSize;
    if (!settings.enabled && !force) return;
    const manualReleaseFilter = !force && settings.deliveryMode === 'manual' ? ' AND d.released_at IS NOT NULL' : '';
    const courseFilter = courseId ? ' AND d.course_id=$2' : '';
    const values = courseId ? [limit, courseId] : [limit];
    const pending = await pool.query(`SELECT d.id AS delivery_id,s.email,s.unsubscribe_token,c.*
      FROM course_alert_deliveries d
      JOIN course_alert_subscribers s ON s.id=d.subscriber_id AND s.active=true
      LEFT JOIN email_preferences p ON p.email=s.email
      JOIN courses c ON c.id=d.course_id AND c.active=true
      WHERE d.status='queued' AND d.send_after <= now() AND COALESCE(p.marketing_opt_out,false)=false${manualReleaseFilter}${courseFilter}
      ORDER BY d.send_after ASC LIMIT $1`, values);
    for (const row of pending.rows) {
      const claimed = await pool.query(`UPDATE course_alert_deliveries SET status='sending'
        WHERE id=$1 AND status='queued' RETURNING id`, [row.delivery_id]);
      if (!claimed.rowCount) continue;
      const course = publicCourse(row);
      try {
        const details = [
          course.date ? `<span style="margin:0 5px">📅 ${escapeHtml(course.date)}</span>` : '',
          course.location ? `<span style="margin:0 5px">📍 ${escapeHtml(course.location)}</span>` : '',
          course.hours ? `<span style="margin:0 5px">⏱ ${course.hours} ساعة تدريبية</span>` : ''
        ].filter(Boolean).join(' · ');
        const result = await sendEmail({
          to: row.email, marketing:true,
          subject: mergeCourseAlertTemplate(settings.subject, course),
          html: emailShell({
            title: course.name,
            preview: mergeCourseAlertTemplate(settings.subject, course),
            content: '<h1 style="margin:0 0 12px;font-size:24px;color:#0b4b91">' + escapeHtml(course.name) + '</h1><div style="border:1px solid #d9e8f7;border-radius:14px;padding:20px;background:#fbfdff"><div style="color:#58708a;line-height:2">' + escapeHtml(mergeCourseAlertTemplate(settings.message, course)).replace(/\n/g, '<br>') + '</div></div><div style="text-align:center;margin:26px 0 20px"><a href="' + coursePublicUrl(course) + '" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;padding:12px 25px;border-radius:10px;font-weight:800">استعرض الدورة وسجّل</a></div><p style="margin:0;text-align:center;font-size:11px;color:#7890a8">لا ترغب في تلقي التنبيهات؟ <a href="' + unsubscribeUrl(row.unsubscribe_token) + '" style="color:#0866c6">إلغاء الاشتراك</a></p>'
          })
        });
        await pool.query("UPDATE course_alert_deliveries SET status='sent',resend_email_id=$1 WHERE id=$2", [result?.id || '', row.delivery_id]);
      } catch (error) {
        await pool.query("UPDATE course_alert_deliveries SET status='failed',error=$1 WHERE id=$2", [clean(error.message, 800), row.delivery_id]);
        console.error('Course alert email failed:', error.message);
      }
    }
  } catch (error) { console.error('Course alert worker failed:', error.message); }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'INEXC Training API', trainingPackageLabelsVersion: 1, courseCardAccessVersion: 1, messageStudioVersion: 5, subscriptionsVersion: 2, learnerVersion: 1 }));
app.get('/api/settings', async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT key,value FROM app_settings WHERE key IN ('brand_logo','hero_preview_visible','testimonials_visible')");
    const settings = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
    res.json({ logoUrl: settings.brand_logo || '', heroPreviewVisible: settings.hero_preview_visible !== 'false', testimonialsVisible: settings.testimonials_visible !== 'false' });
  } catch (error) { next(error); }
});

function membershipPlanPublic(row, sold = 0) {
  return { id:row.id,slug:row.slug,name:trainingPackageText(row.name),priceUsd:Number(row.price_usd),maxCards:Number(row.max_cards),sold:Number(sold),remaining:Math.max(0,Number(row.max_cards)-Number(sold)),paidCount:Number(row.paid_count||0),pendingCount:Number(row.pending_count||0),expectedRevenueUsd:Number(row.expected_revenue_usd||0),issuedValueUsd:Number(row.issued_value_usd||0),verifiedRevenueUsd:Number(row.verified_revenue_usd||0),verifiedRevenueAed:Number(row.verified_revenue_aed||0),validMonths:Number(row.valid_months),bookingUnits:Number(row.booking_units),courseUnitCost:Number(row.course_unit_cost),diplomaUnitCost:Number(row.diploma_unit_cost),certificateDiscount:Number(row.certificate_discount),earlyAccessHours:Number(row.early_access_hours),perks:trainingPackageText(row.perks)||'',paymentLink:row.payment_link||'',paymentMethods:row.payment_methods||['bank'],active:row.active===true,featureLines:trainingPackageText(row.feature_lines)||'',badgeText:trainingPackageText(row.badge_text)||'',featured:row.featured===true,stockMode:row.stock_mode||'count',stockLabel:trainingPackageText(row.stock_label)||'',lowStockLabel:trainingPackageText(row.low_stock_label)||'',lowStockThreshold:Number(row.low_stock_threshold??15),sortOrder:Number(row.sort_order||0) };
}
async function membershipPlans(includeInactive=false) {
  const result = await pool.query(`SELECT p.*,COUNT(o.id) FILTER (WHERE o.status IN ('مفعلة','بانتظار مراجعة الدفع','بانتظار الدفع')) AS sold,
    COUNT(o.id) FILTER (WHERE o.card_id IS NOT NULL) AS paid_count,
    COUNT(o.id) FILTER (WHERE o.card_id IS NULL AND o.status IN ('بانتظار مراجعة الدفع','بانتظار الدفع')) AS pending_count,
    COALESCE(SUM(o.total) FILTER (WHERE o.status IN ('مفعلة','بانتظار مراجعة الدفع','بانتظار الدفع')),0) AS expected_revenue_usd,
    COALESCE(SUM(o.total) FILTER (WHERE o.card_id IS NOT NULL),0) AS issued_value_usd,
    COALESCE(SUM(o.verified_amount) FILTER (WHERE o.card_id IS NOT NULL AND o.verified_currency='USD'),0) AS verified_revenue_usd,
    COALESCE(SUM(o.verified_amount) FILTER (WHERE o.card_id IS NOT NULL AND o.verified_currency='AED'),0) AS verified_revenue_aed
    FROM membership_plans p LEFT JOIN membership_orders o ON o.plan_id=p.id
    ${includeInactive?'':'WHERE p.active=true'} GROUP BY p.id ORDER BY p.sort_order ASC, p.price_usd ASC`);
  return result.rows.map(row=>membershipPlanPublic(row,row.sold));
}
function cardSnapshot(row, redemptions = []) {
  const plan = membershipPlanPublic({...row,id:row.plan_id||row.id}, row.sold||0);
  return { cardNumber:row.card_number, holderName:row.holder_name, holderEmail:row.holder_email,
    status:row.status, activatedAt:row.activated_at, expiresAt:row.expires_at, unitsTotal:Number(row.units_total),unitsRemaining:Number(row.units_remaining),
    cardName:membershipCardName(row.name), plan, redemptions };
}
async function sendMembershipActivationEmail(card){
 const plan=(await pool.query('SELECT name FROM membership_plans WHERE id=$1',[card.plan_id])).rows[0];
 const name=membershipCardName(plan?.name);
 const cardUrl='https://www.inexctraining.com/my-card/?token='+encodeURIComponent(card.access_token);
 const accountUrl='https://www.inexctraining.com/account.html';
 const content=`<p>مرحبًا ${escapeHtml(card.holder_name)}،</p>
 <p>تم تأكيد الدفع وإصدار <strong>${escapeHtml(name)}</strong>. يمكنك استخدامها لحجز الدورات المتاحة لها.</p>
 <div style="background:#f1f7ff;border:1px solid #d4e6f8;border-radius:12px;padding:16px;margin:18px 0">
 <span style="display:block;color:#526d88;font-size:13px;margin-bottom:7px">رقم بطاقتك</span>
 <strong dir="ltr" style="display:block;direction:ltr;text-align:center;color:#103b70;font-size:19px">${escapeHtml(card.card_number)}</strong></div>
 <p style="text-align:center;margin:22px 0"><a href="${cardUrl}" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;border-radius:10px;padding:12px 22px;font-weight:bold">عرض ${escapeHtml(name)}</a></p>
 <div style="border-top:1px solid #e2edf8;margin-top:22px;padding-top:18px"><h2 style="color:#103b70;font-size:18px;margin:0 0 8px">صفحتك التدريبية الخاصة</h2>
 <p>يمكنك الدخول إليها في أي وقت للاطلاع على دوراتك وشهاداتك ورصيد بطاقتك وحجوزاتك. استخدم <strong>البريد الإلكتروني الذي وصلتك عليه هذه الرسالة</strong> و<strong>رقم البطاقة المذكور أعلاه</strong> عند الدخول.</p>
 <p style="text-align:center;margin:18px 0"><a href="${accountUrl}" style="display:inline-block;background:#eaf4ff;color:#075aaf;text-decoration:none;border:1px solid #cce2f8;border-radius:10px;padding:12px 22px;font-weight:bold">الدخول إلى صفحتي التدريبية</a></p>
 <p style="color:#58728a;font-size:12px">رابط الصفحة المباشر: <a href="${accountUrl}" style="color:#075aaf">${accountUrl}</a></p></div>
 <p style="color:#657b90;font-size:12px">احتفظ برقم بطاقتك ورابط عرضها لنفسك.</p>`;
 const plain=`مرحبًا ${card.holder_name}،\nتم تأكيد الدفع وإصدار ${name}.\nرقم البطاقة: ${card.card_number}\nعرض البطاقة: ${cardUrl}\n\nصفحتك التدريبية الخاصة: ${accountUrl}\nللدخول، استخدم البريد الإلكتروني الذي وصلتك عليه هذه الرسالة ورقم البطاقة أعلاه. يمكنك متابعة دوراتك وشهاداتك ورصيدك وحجوزاتك من صفحتك.\n\nاحتفظ برقم بطاقتك ورابط عرضها لنفسك.`;
 await sendEmail({to:card.holder_email,subject:'تم تفعيل '+name+' | INEXC',html:emailShell({title:name+' جاهزة',preview:'بطاقتك جاهزة وصفحتك التدريبية متاحة للدخول.',content}),text:plain});
}
async function getMembershipCard(code,email,accessToken='') {
  const byToken=clean(accessToken,100);
  const result=byToken
    ? await pool.query(`SELECT p.*,c.*,p.id AS plan_id,0 AS sold FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id WHERE c.access_token=$1`,[byToken])
    : await pool.query(`SELECT p.*,c.*,p.id AS plan_id,0 AS sold FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id
      WHERE upper(c.card_number)=upper($1) AND lower(c.holder_email)=lower($2)`,[code,email]);
  if(!result.rowCount) return null;
  const row=result.rows[0]; const red=await pool.query(`SELECT r.*,co.name AS course_name FROM membership_redemptions r JOIN courses co ON co.id=r.course_id WHERE r.card_id=$1 ORDER BY r.created_at DESC`,[row.id]);
  return { row, snapshot:cardSnapshot(row,red.rows.map(x=>({courseName:x.course_name,unitsUsed:Number(x.units_used),kind:x.course_kind,status:x.status,createdAt:x.created_at}))) };
}
app.get('/api/memberships/plans', async (_req,res,next)=>{try{res.json(await membershipPlans(false));}catch(error){next(error);}});
function membershipPaymentError(res,error){
 if(error.constraint==='membership_orders_verified_payment_unique')return res.status(409).json({error:'رقم عملية الدفع هذا مستخدم في طلب آخر. راجع العملية قبل إصدار الباقة.'});
 const safe=[400,404,409,410,429,503].includes(error.status);
 return res.status(safe?error.status:500).json({error:safe?error.message:'تعذّر إتمام طلب الباقة. أعد المحاولة.'});
}
app.post('/api/memberships/orders', upload.single('receipt'), async (req,res)=>{
  try {res.status(201).json(await membershipPayments.offlineOrder(req.body||{},req.file?`/uploads/${req.file.filename}`:''));}catch(error){membershipPaymentError(res,error);}
});
app.get('/api/memberships/card',async(req,res,next)=>{try{
  const found=await getMembershipCard(clean(req.query.code,80),clean(String(req.query.email||'').toLowerCase(),190),clean(req.query.token,100));
  if(!found)return res.status(404).json({error:'لم نجد بطاقة مطابقة لهذه البيانات.'});
  res.json(found.snapshot);
}catch(error){next(error);}});
// A public link contains its own random identifier and exposes only the visual card fields.
app.post('/api/memberships/card/share',async(req,res,next)=>{try{
  const found=await getMembershipCard(clean(req.body?.code,80),clean(String(req.body?.email||'').toLowerCase(),190),clean(req.body?.token,100));
  if(!found)return res.status(404).json({error:'لم نجد بطاقة مطابقة لهذه البيانات.'});
  const row=(await pool.query('UPDATE membership_cards SET share_token=COALESCE(share_token,$2) WHERE id=$1 RETURNING share_token',[found.row.id,crypto.randomBytes(32).toString('hex')])).rows[0];
  res.set('Cache-Control','no-store').json({url:'https://api.inexctraining.com/api/memberships/card/public/'+row.share_token});
}catch(error){next(error);}});
app.post('/api/memberships/card/share/image',express.raw({type:'image/png',limit:'3mb'}),async(req,res,next)=>{try{
  const shareToken=clean(req.get('X-Card-Share'),100),accessToken=clean(req.get('X-Card-Token'),100);
  const code=clean(req.get('X-Card-Code'),80),email=clean(String(req.get('X-Card-Email')||'').toLowerCase(),190);
  if(!/^[a-f0-9]{64}$/.test(shareToken)||!Buffer.isBuffer(req.body)||req.body.length<100||req.body.length>3*1024*1024||!req.body.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||req.body.readUInt32BE(16)!==2160||req.body.readUInt32BE(20)!==1360)return res.status(400).json({error:'صورة البطاقة غير صالحة.'});
  const found=await getMembershipCard(code,email,accessToken);
  if(!found||found.row.share_token!==shareToken)return res.status(404).json({error:'تعذر حفظ معاينة البطاقة.'});
  await pool.query('UPDATE membership_cards SET share_image=$2 WHERE id=$1',[found.row.id,req.body]);
  res.set('Cache-Control','no-store').json({ok:true});
}catch(error){next(error);}});
app.get('/api/memberships/card/public/:share/image',async(req,res,next)=>{try{
  const shareToken=clean(req.params.share,100);
  if(!/^[a-f0-9]{64}$/.test(shareToken))return res.status(404).end();
  const result=await pool.query('SELECT share_image FROM membership_cards WHERE share_token=$1',[shareToken]);
  if(!result.rowCount||!result.rows[0].share_image)return res.status(404).end();
  res.type('png').set('Cache-Control','public, max-age=300').send(result.rows[0].share_image);
}catch(error){next(error);}});
app.get('/api/memberships/card/public/:share',async(req,res,next)=>{try{
  const shareToken=clean(req.params.share,100);
  if(!/^[a-f0-9]{64}$/.test(shareToken))return res.status(404).send('رابط البطاقة غير متاح.');
  const result=await pool.query('SELECT c.holder_name,c.share_image,p.name FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id WHERE c.share_token=$1',[shareToken]);
  if(!result.rowCount||!result.rows[0].share_image)return res.status(404).send('رابط البطاقة غير متاح.');
  const row=result.rows[0],title=membershipCardName(row.name)+' | '+row.holder_name;
  const base='https://api.inexctraining.com/api/memberships/card/public/'+shareToken;
  const view='https://www.inexctraining.com/my-card/?share='+shareToken;
  res.set('Cache-Control','public, max-age=300').type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><meta property="og:type" content="website"><meta property="og:site_name" content="INEXC Training"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="اطّلع على البطاقة التدريبية لدى INEXC."><meta property="og:url" content="${base}"><meta property="og:image" content="${base}/image"><meta property="og:image:secure_url" content="${base}/image"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="2160"><meta property="og:image:height" content="1360"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:image" content="${base}/image"><style>*{box-sizing:border-box}body{margin:0;background:#eef6ff;color:#153e65;font:16px/1.8 Arial,sans-serif}.wrap{max-width:770px;margin:auto;padding:24px 16px 48px}header{font-weight:700;padding:10px 0 24px}.panel{background:white;border:1px solid #d7e7f5;border-radius:20px;padding:clamp(14px,3vw,28px);box-shadow:0 12px 32px #174a7018}h1{font-size:clamp(21px,4vw,30px);line-height:1.5;margin:0 0 14px}.card-image{display:block;width:100%;height:auto;border-radius:16px}p{margin:16px 0;color:#49657d}a.button{display:inline-block;background:#0866c6;color:white;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:bold}</style></head><body><div class="wrap"><header>INEXC · التميز الابتكاري</header><main class="panel"><h1>${escapeHtml(title)}</h1><img class="card-image" src="${base}/image" width="1080" height="680" alt="${escapeHtml(title)}"><p>بطاقة تدريبية للعرض؛ لا يظهر رقم البطاقة أو بيانات الدخول.</p><a class="button" href="${view}">عرض البطاقة على الموقع</a></main></div></body></html>`);
}catch(error){next(error);}});
app.get('/api/memberships/card/shared',async(req,res,next)=>{try{
  const token=clean(req.query.share,100);
  if(!/^[a-f0-9]{64}$/.test(token))return res.status(404).json({error:'رابط البطاقة غير متاح.'});
  const result=await pool.query('SELECT c.holder_name,c.status,c.expires_at,c.units_remaining,p.name FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id WHERE c.share_token=$1',[token]);
  if(!result.rowCount)return res.status(404).json({error:'رابط البطاقة غير متاح.'});
  const row=result.rows[0];
  res.set('Cache-Control','no-store').json({holderName:row.holder_name,status:row.status,publicStatus:Number(row.units_remaining)===0?'الرصيد مستنفد':'',expiresAt:row.expires_at,cardName:membershipCardName(row.name),plan:{name:trainingPackageText(row.name)}});
}catch(error){next(error);}});
app.post('/api/memberships/verify',async(req,res,next)=>{try{
  const code=clean(req.body?.code,80),email=clean(String(req.body?.email||'').toLowerCase(),190),courseId=clean(req.body?.course_id,80);
  const found=await getMembershipCard(code,email); if(!found)return res.status(404).json({error:'رقم البطاقة أو البريد الإلكتروني غير صحيح.'});
  const course=await pool.query('SELECT * FROM courses WHERE id=$1 AND active=true',[courseId]);if(!course.rowCount)return res.status(400).json({error:'الدورة غير متاحة.'});
  const quote=cardQuote(found.row,course.rows[0],req.body?.certificate===true||req.body?.certificate==='yes');
  res.json({ok:true,card:found.snapshot,...quote});
}catch(error){next(error);}});
app.get('/api/admin/memberships/plans',auth,async(_req,res,next)=>{try{res.json(await membershipPlans(true));}catch(error){next(error);}});
function membershipPlanInput(body) {
  const integer=(value,min,max)=>Number.isInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):null;
  const price=Number(body.priceUsd),discount=Number(body.certificateDiscount);
  const numbers={maxCards:integer(body.maxCards,1,100000),validMonths:integer(body.validMonths,1,120),bookingUnits:integer(body.bookingUnits,1,10000),courseUnitCost:integer(body.courseUnitCost,1,10000),diplomaUnitCost:integer(body.diplomaUnitCost,1,10000),earlyAccessHours:integer(body.earlyAccessHours,0,8760),lowStockThreshold:integer(body.lowStockThreshold,0,100000),sortOrder:integer(body.sortOrder,0,100000)};
  if(!clean(body.name,100)||Object.values(numbers).some(v=>v===null)||!Number.isFinite(price)||price<0||price>100000||!Number.isFinite(discount)||discount<0||discount>100) throw Object.assign(new Error('تحقق من الاسم والسعر والأعداد ونسبة الخصم.'),{status:400});
  const link=clean(body.paymentLink,500);
  if(link && (!/^https:\/\//i.test(link)||!URL.canParse(link))) throw Object.assign(new Error('رابط الدفع يجب أن يبدأ بـ https://'),{status:400});
  const paymentMethods=['stripe','bank','link'].filter(method=>Array.isArray(body.paymentMethods)&&body.paymentMethods.includes(method));
  if(!Array.isArray(body.paymentMethods)||body.paymentMethods.some(method=>!['stripe','bank','link'].includes(method)))throw Object.assign(new Error('طرق الدفع غير صالحة.'),{status:400});
  if(paymentMethods.includes('link')&&!link) throw Object.assign(new Error('أدخل رابط الدفع قبل تفعيله.'),{status:400});
  const mode=['count','limited','hidden'].includes(body.stockMode)?body.stockMode:'count';
  return [clean(body.name,100),price,numbers.maxCards,numbers.validMonths,numbers.bookingUnits,numbers.courseUnitCost,numbers.diplomaUnitCost,discount,numbers.earlyAccessHours,clean(body.perks,1000),link,body.active!==false,clean(body.featureLines,2000),clean(body.badgeText,80),body.featured===true,mode,clean(body.stockLabel,100),numbers.lowStockThreshold,numbers.sortOrder,clean(body.lowStockLabel,100),paymentMethods];
}
app.post('/api/admin/memberships/plans',auth,async(req,res,next)=>{try{
  const values=membershipPlanInput(req.body||{}),slug='custom-'+crypto.randomBytes(8).toString('hex');
  const result=await pool.query(`INSERT INTO membership_plans (name,price_usd,max_cards,valid_months,booking_units,course_unit_cost,diploma_unit_cost,certificate_discount,early_access_hours,perks,payment_link,active,feature_lines,badge_text,featured,stock_mode,stock_label,low_stock_threshold,sort_order,low_stock_label,payment_methods,slug)
    VALUES (${Array.from({length:22},(_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,[...values,slug]);
  res.status(201).json(membershipPlanPublic(result.rows[0]));
}catch(error){next(error);}});
app.put('/api/admin/memberships/plans/:id',auth,async(req,res,next)=>{try{
  const values=membershipPlanInput(req.body||{});const result=await pool.query(`UPDATE membership_plans SET name=$1,price_usd=$2,max_cards=$3,valid_months=$4,booking_units=$5,course_unit_cost=$6,diploma_unit_cost=$7,certificate_discount=$8,early_access_hours=$9,perks=$10,payment_link=$11,active=$12,feature_lines=$13,badge_text=$14,featured=$15,stock_mode=$16,stock_label=$17,low_stock_threshold=$18,sort_order=$19,low_stock_label=$20,payment_methods=$21,updated_at=now() WHERE id=$22 RETURNING *`,[...values,req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:'الباقة غير موجودة.'});res.json(membershipPlanPublic(result.rows[0]));
}catch(error){next(error);}});
app.delete('/api/admin/memberships/plans/:id',auth,async(req,res,next)=>{try{
  const used=await pool.query('SELECT 1 FROM membership_orders WHERE plan_id=$1 LIMIT 1',[req.params.id]);
  if(used.rowCount)return res.status(409).json({error:'توجد طلبات لهذه الباقة. أوقف عرضها بدل حذفها للحفاظ على سجلات المشترين.'});
  const courses=await pool.query('SELECT 1 FROM courses WHERE $1::uuid=ANY(membership_plan_ids) LIMIT 1',[req.params.id]);
  if(courses.rowCount)return res.status(409).json({error:'هذه البطاقة مختارة ضمن دورات. عدّل البطاقات المقبولة في تلك الدورات، أو أوقف عرض الباقة بدل حذفها.'});
  const result=await pool.query('DELETE FROM membership_plans WHERE id=$1 RETURNING id',[req.params.id]);
  if(!result.rowCount)return res.status(404).json({error:'الباقة غير موجودة.'});res.json({ok:true});
}catch(error){next(error);}});
app.get('/api/admin/memberships/orders',auth,async(_req,res,next)=>{try{const result=await pool.query(`SELECT o.*,p.name AS plan_name,p.slug AS plan_slug,c.card_number FROM membership_orders o JOIN membership_plans p ON p.id=o.plan_id LEFT JOIN membership_cards c ON c.id=o.card_id ORDER BY o.created_at DESC`);res.json(result.rows.map(r=>({...r,plan_name:trainingPackageText(r.plan_name),total:Number(r.total)})));}catch(error){next(error);}});
app.post('/api/admin/memberships/orders/:id/approve',auth,async(req,res)=>{try{res.json(await membershipPayments.approveOffline(req.params.id,req.body||{}));}catch(error){membershipPaymentError(res,error);}});
app.post('/api/admin/memberships/orders/:id/reject',auth,async(req,res,next)=>{try{const result=await pool.query(`UPDATE membership_orders SET status='مرفوض',updated_at=now() WHERE id=$1 AND card_id IS NULL RETURNING id`,[req.params.id]);if(!result.rowCount)return res.status(400).json({error:'لا يمكن رفض طلب تم تفعيل باقته.'});res.json({ok:true});}catch(error){next(error);}});
app.get('/api/admin/memberships/cards',auth,async(_req,res,next)=>{try{const result=await pool.query(`SELECT c.*,p.name AS plan_name,p.slug AS plan_slug FROM membership_cards c JOIN membership_plans p ON p.id=c.plan_id ORDER BY c.created_at DESC`);res.json(result.rows.map(r=>({...r,plan_name:membershipCardName(r.plan_name),units_total:Number(r.units_total),units_remaining:Number(r.units_remaining)})));}catch(error){next(error);}});
app.put('/api/admin/memberships/courses/:id',auth,async(req,res,next)=>{try{const b=req.body||{};const result=await pool.query(`UPDATE courses SET membership_enabled=$1,membership_kind=$2,member_booking_opens_at=$3,public_booking_opens_at=$4,updated_at=now() WHERE id=$5 RETURNING id`,[b.enabled!==false,b.kind==='diploma'?'diploma':'course',b.memberBookingOpensAt||null,b.publicBookingOpensAt||null,req.params.id]);if(!result.rowCount)return res.status(404).json({error:'الدورة غير موجودة.'});res.json({ok:true});}catch(error){next(error);}});
app.get('/api/courses', async (_req, res, next) => {
  try { const result = await pool.query('SELECT * FROM courses WHERE active = true ORDER BY created_at DESC'); res.json((await attachCourseCardNames(pool,result.rows)).map(publicCourse)); } catch (error) { next(error); }
});
app.post('/api/course-alerts', async (req, res, next) => {
  try {
    const email = clean(String(req.body?.email || '').toLowerCase(), 190);
    if (!alertEmailPattern.test(email)) return res.status(400).json({ error: 'أدخل بريدًا إلكترونيًا صحيحًا.' });
    const preference = await getEmailPreference(email);
    if (preference.marketing_opt_out) return res.json({ ok: true, alreadyUnsubscribed: true });
    const existing = await pool.query('SELECT id,active,suppressed FROM course_alert_subscribers WHERE email=$1', [email]);
    if (existing.rowCount && existing.rows[0].suppressed) return res.json({ ok: true, alreadyUnsubscribed: true });
    if (existing.rowCount && existing.rows[0].active) return res.json({ ok: true, alreadySubscribed: true });
    const token = crypto.randomBytes(24).toString('hex');
    if (existing.rowCount) {
      await pool.query('UPDATE course_alert_subscribers SET active=true,unsubscribe_token=$1,updated_at=now() WHERE id=$2', [token, existing.rows[0].id]);
    } else {
      await pool.query('INSERT INTO course_alert_subscribers (email,unsubscribe_token) VALUES ($1,$2)', [email, token]);
    }
    // الاشتراك صامت؛ أول رسالة تصل بعد ساعة من نشر دورة جديدة.
    res.status(201).json({ ok: true, alreadySubscribed: false });
  } catch (error) { next(error); }
});
installSuppressionRoutes({app,pool});
for (const [route,table] of [['/api/course-alerts/unsubscribe','course_alert_subscribers'],['/api/email-preferences/unsubscribe','email_preferences']]) {
  app.get(route,async(req,res,next)=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const row=(await client.query('SELECT email FROM '+table+' WHERE unsubscribe_token=$1',[clean(req.query.token,100)])).rows[0];
      if(row)await suppressEmail(client,row.email,{source:table+'-link'});
      await client.query('COMMIT');
      res.status(row?200:400).type('html').send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إلغاء الاشتراك | INEXC</title><body style="font-family:Tahoma,Arial;background:#eef5fc;padding:32px;text-align:center"><h1>'+ (row?'تم إلغاء الاشتراك':'رابط غير صالح')+'</h1><p>'+(row?'لن تصلك رسائل INEXC الجماعية أو تنبيهات الدورات لاحقًا. يبقى الحظر محفوظًا حتى عند إعادة استيراد الملفات.':'تعذر التعرف إلى هذا الرابط.')+'</p></body></html>');
    }catch(error){await client.query('ROLLBACK');next(error)}finally{client.release()}
  });
}
app.get('/api/testimonials', async (_req, res, next) => {
  try {
    const setting = await pool.query("SELECT value FROM app_settings WHERE key='testimonials_visible'");
    if (setting.rows[0]?.value === 'false') return res.json({ visible: false, testimonials: [] });
    const result = await pool.query("SELECT id,name,content,image_path,rating,verified,status FROM testimonials WHERE status IN ('visible','featured') ORDER BY (status='featured') DESC, created_at DESC");
    res.json({ visible: true, testimonials: result.rows.map(row => ({ id: row.id, name: row.name, content: row.content, imageUrl: row.image_path || '', rating: Number(row.rating || 5), verified: row.verified === true })) });
  } catch (error) { next(error); }
});
function publicRichText(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const text = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return line.startsWith('## ') ? `<h3 class="rich-heading">${text.slice(3)}</h3>` : `<p>${text}</p>`;
  }).join('') || '<p>ستظهر تفاصيل الدورة قريبًا.</p>';
}
function publicInlineText(value) { return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function courseAxisGroups(axes) {
  const groups = []; let current;
  for (const raw of axes || []) {
    const line = String(raw || '').trim(); if (!line) continue;
    const manualHeading = line.match(/^##\s*(.+)$/);
    const naturalHeading = line.match(/^(المحور\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)\s*[:：-].+)$/);
    const title = manualHeading?.[1] || naturalHeading?.[1];
    if (title) { current = { title, points: [] }; groups.push(current); continue; }
    if (!current) { current = { title: 'محاور البرنامج', points: [] }; groups.push(current); }
    current.points.push(line);
  }
  return groups;
}
app.get('/:shareSlug', async (req, res, next) => {
  try {
    if (!/^course-[a-z0-9]+$/.test(req.params.shareSlug)) return res.status(404).send('الصفحة غير موجودة.');
    const result = await pool.query('SELECT * FROM courses WHERE share_slug=$1 AND active=true', [req.params.shareSlug]);
    if (!result.rowCount) return res.status(404).send('الدورة غير موجودة.');
    const course = publicCourse(result.rows[0]);
    const fallback = 'https://www.inexctraining.com/assets/inexc-logo-official-source.png';
    const image = course.imageUrl ? publicUrl(req, course.imageUrl) : fallback;
    const url = publicUrl(req, req.originalUrl);
    const register = `https://www.inexctraining.com/register/?course=${encodeURIComponent(course.name)}`;
    const axisGroups = courseAxisGroups(course.axes);
    const certificateNote = course.certificate.mode === 'included' ? `شهادة ${course.certificate.name || 'إتمام'} مشمولة في سعر الدورة.` : course.certificate.mode === 'optional' ? `شهادة ${course.certificate.name || 'إتمام'} اختيارية بسعر ${Number(course.certificate.price || 0).toLocaleString('ar-AE')} د.إ.` : 'لا توجد شهادة ضمن هذه الدورة.';
    const panels = [
      { label: 'عن الدورة', html: `<section class="panel intro"><span class="tag">${escapeHtml(course.category || 'دورة تدريبية')}</span><h1>${escapeHtml(course.name)}</h1><div class="rich">${publicRichText(course.description)}</div><div class="facts"><span>📅 ${escapeHtml(course.date || 'سيُعلن قريبًا')}</span><span>📍 ${escapeHtml(course.location || 'عن بُعد / حضوري')}</span>${course.hours > 0 ? `<span>⏱️ ${course.hours.toLocaleString('ar-AE')} ساعة تدريبية</span>` : ''}<span>💳 ${course.price === 0 ? 'مجاني' : `${course.price.toLocaleString('ar-AE')} د.إ`}</span></div></section>` },
      ...(axisGroups.length ? [{ label: 'محاور الدورة', html: `<section class="panel"><h2>محاور الدورة</h2><p class="lead">اضغط على أي محور رئيسي لعرض النقاط التي يتضمنها.</p>${axisGroups.map((axis, index) => `<details class="axis" style="padding:0;overflow:hidden"><summary style="list-style:none;display:flex;align-items:center;gap:10px;padding:16px;cursor:pointer"><i>${['١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'][index] || index + 1}</i><span>${publicInlineText(axis.title)}</span><b style="margin-right:auto;display:block">⌄</b></summary>${axis.points.length ? `<ul style="margin:0;padding:0 45px 17px 18px;color:#46627c;line-height:2;font-size:13px">${axis.points.map(point => `<li>${publicInlineText(point)}</li>`).join('')}</ul>` : '<p style="margin:0;padding:0 50px 17px;color:#60788f;font-size:13px">تفاصيل هذا المحور ستُناقش ضمن جلسات الدورة.</p>'}</details>`).join('')}</section>` }] : []),
      ...(course.outcomes.length ? [{ label: 'مخرجات الدورة', html: `<section class="panel"><h2>ماذا ستخرج به بعد الدورة؟</h2><p class="lead">مخرجات تساعدك على تحويل ما تتعلمه إلى أثر عملي.</p>${course.outcomes.map(outcome => `<article class="outcome">${publicInlineText(outcome)}</article>`).join('')}</section>` }] : []),
      { label: 'السعر', html: `<section class="panel"><h2>السعر وخيارات الشهادة</h2><div class="price" style="border:1px solid #d9eafb;background:#f7fbff;border-radius:18px;padding:22px"><span style="display:inline-grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#eaf4ff;font-size:21px">💳</span><b style="display:block;font-size:30px;color:#0866c6;margin:16px 0 7px">${course.price === 0 ? 'مجاني' : `${course.price.toLocaleString('ar-AE')} د.إ`}</b><p style="margin:0;color:#5c748c;font-size:13px;line-height:2">${escapeHtml(certificateNote)}</p></div></section>` },
      { label: 'التسجيل', html: `<section class="panel"><div class="register"><h2>جاهز للبدء؟</h2><p>أرسل طلبك الآن، وسيتواصل معك فريق INEXC لاستكمال التسجيل.</p><a href="${register}">سجّل في هذه الدورة ←</a></div></section>` }
    ];
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="canonical" href="https://www.inexctraining.com/course.html?id=${encodeURIComponent(course.id)}"><title>${escapeHtml(course.name)} | INEXC Training</title><meta name="description" content="${escapeHtml(course.description.slice(0, 155))}"><meta property="og:type" content="website"><meta property="og:site_name" content="INEXC Training"><meta property="og:title" content="${escapeHtml(course.name)}"><meta property="og:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(course.name)}"><meta name="twitter:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta name="twitter:image" content="${escapeHtml(image)}"><style>:root{--b:#0866c6;--d:#103b70;--p:#f3f8ff;--m:#62788f}*{box-sizing:border-box}body{margin:0;background:var(--p);font-family:Arial,sans-serif;color:#19314b}.wrap{width:min(900px,calc(100% - 32px));margin:34px auto}.back{display:inline-block;color:var(--b);font-weight:bold;text-decoration:none;font-size:13px;margin:0 0 14px}.card{overflow:hidden;background:#fff;border:1px solid #dcecff;border-radius:24px;box-shadow:0 20px 50px #07539814}.cover{display:block;width:100%;height:330px;object-fit:cover;background:#0b4d90}.content{padding:30px 36px 36px}.tag{display:inline-block;background:#eaf4ff;color:var(--b);padding:6px 11px;border-radius:20px;font-size:12px;font-weight:bold}.intro h1{color:var(--d);font-size:30px;line-height:1.55;margin:15px 0 8px}.rich p{line-height:2;color:var(--m);font-size:15px;margin:0 0 11px}.rich strong,.axis strong,.outcome strong{color:#0d477e;font-weight:800}.rich-heading{color:#0b5cac;font-size:17px;margin:17px 0 7px}.facts{display:flex;gap:9px;flex-wrap:wrap;margin:21px 0}.facts span{padding:8px 10px;background:#f8fbff;border:1px solid #e0edf9;border-radius:10px;font-size:12px;color:#4d6d8a}.journey{border-top:1px solid #e6f0fa;padding-top:20px}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:23px}.step{border:1px solid #dceafb;background:#fff;color:#6b8195;border-radius:10px;padding:10px 8px;font:700 11px Arial;cursor:pointer}.step.active{background:var(--b);border-color:var(--b);color:#fff}.step.done{color:var(--b);border-color:#abd7ff}.panel{display:none}.panel.active{display:block}.panel h2{color:var(--d);font-size:22px;margin:0 0 12px}.lead{font-size:14px;line-height:2;color:var(--m);margin:0 0 18px}.axis{padding:15px 16px;margin:9px 0;background:#f7fbff;border:1px solid #dceafb;border-radius:14px;line-height:1.9;color:#46627c;font-size:14px}.axis b{display:flex;gap:9px;align-items:flex-start;color:#0d477e}.axis i{font-style:normal;color:#fff;background:var(--b);width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;flex:0 0 auto}.outcome{padding:14px 15px;margin:9px 0;border-right:4px solid #18a878;background:#f4fcf8;border-radius:10px;color:#42657d;line-height:1.9;font-size:14px}.register{padding:24px;border-radius:18px;background:linear-gradient(135deg,#063f86,#0866c6);color:#fff}.register h2{color:#fff;margin:0 0 8px}.register p{color:#e7f3ff;line-height:2;margin:0 0 18px;font-size:14px}.register a{display:inline-block;text-decoration:none;background:#fff;color:#0866c6;padding:13px 19px;border-radius:10px;font-weight:bold;font-size:14px}.controls{display:flex;justify-content:space-between;gap:10px;margin-top:25px}.controls button{border:0;border-radius:10px;padding:11px 16px;font-weight:bold;cursor:pointer}.previous{background:#eef6ff;color:var(--b)}.next{background:var(--b);color:#fff}@media(max-width:600px){.wrap{width:calc(100% - 20px);margin:18px auto}.card{border-radius:18px}.cover{height:210px}.content{padding:22px 17px 24px}.intro h1{font-size:24px}.steps{grid-template-columns:1fr 1fr}.step{font-size:10px}.axis,.outcome,.rich p{font-size:13px}.controls{position:sticky;bottom:8px;background:#ffffffed;padding-top:10px}.controls button{flex:1}}</style></head><body><main class="wrap"><a class="back" href="https://www.inexctraining.com/">← العودة إلى الدورات</a><article class="card"><img class="cover" src="${escapeHtml(image)}" alt="${escapeHtml(course.name)}"><div class="content"><div class="journey"><div class="steps">${panels.map((panel,index) => `<button class="step" type="button">${index + 1}. ${panel.label}</button>`).join('')}</div>${panels.map(panel => panel.html).join('')}<div class="controls"><button class="previous" type="button">السابق</button><button class="next" type="button">التالي ←</button></div></div></div></article></main><script>const panels=[...document.querySelectorAll('.panel')],steps=[...document.querySelectorAll('.step')],previous=document.querySelector('.previous'),next=document.querySelector('.next');let current=0;function paint(index){current=Math.max(0,Math.min(index,panels.length-1));panels.forEach((panel,i)=>panel.classList.toggle('active',i===current));steps.forEach((step,i)=>{step.classList.toggle('active',i===current);step.classList.toggle('done',i<current)});previous.hidden=current===0;next.hidden=current===panels.length-1;document.querySelector('.journey').scrollIntoView({behavior:'smooth',block:'start'})}steps.forEach((step,index)=>step.onclick=()=>paint(index));previous.onclick=()=>paint(current-1);next.onclick=()=>paint(current+1);paint(0);</script></body></html>`);
  } catch (error) { next(error); }
});
app.get('/:shareSlug', async (req, res, next) => {
  try {
    if (!/^course-[a-z0-9]+$/.test(req.params.shareSlug)) return res.status(404).send('الصفحة غير موجودة.');
    const result = await pool.query('SELECT * FROM courses WHERE share_slug=$1 AND active=true', [req.params.shareSlug]);
    if (!result.rowCount) return res.status(404).send('الدورة غير موجودة.');
    const course = publicCourse(result.rows[0]);
    const fallback = 'https://www.inexctraining.com/assets/inexc-share.png';
    const image = course.imageUrl ? publicUrl(req, course.imageUrl) : fallback;
    const url = publicUrl(req, req.originalUrl);
    const registrationUrl = `https://www.inexctraining.com/register/?course=${encodeURIComponent(course.name)}`;
    const sample = course.certificateSampleUrl ? `<a class="secondary" target="_blank" href="${escapeHtml(publicUrl(req, course.certificateSampleUrl))}">عرض نموذج الشهادة</a>` : '';
    const axes = course.axes.length ? `<section class="axes"><h2>محاور الدورة</h2><ul>${course.axes.map(axis => `<li>${escapeHtml(axis)}</li>`).join('')}</ul></section>` : '';
    const outcomes = course.outcomes.length ? `<section class="outcomes"><h2>ماذا ستخرج به بعد الدورة؟</h2><div>${course.outcomes.map((outcome, index) => `<p><b>${['١','٢','٣','٤','٥'][index] || '•'}</b>${escapeHtml(outcome)}</p>`).join('')}</div></section>` : '';
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="canonical" href="https://www.inexctraining.com/course.html?id=${encodeURIComponent(course.id)}"><title>${escapeHtml(course.name)} | INEXC Training</title><meta name="description" content="${escapeHtml(course.description.slice(0, 155))}"><meta property="og:type" content="website"><meta property="og:site_name" content="INEXC Training"><meta property="og:title" content="${escapeHtml(course.name)}"><meta property="og:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(course.name)}"><meta name="twitter:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta name="twitter:image" content="${escapeHtml(image)}"><style>:root{--blue:#0866c6;--dark:#103b70;--pale:#f1f7fd;--muted:#60788f}*{box-sizing:border-box}body{margin:0;background:var(--pale);color:#17324d;font-family:Arial,sans-serif;line-height:1.9}.wrap{width:min(880px,calc(100% - 32px));margin:42px auto}.card{overflow:hidden;background:#fff;border:1px solid #dceafb;border-radius:24px;box-shadow:0 24px 60px #07539818}.cover{display:block;width:100%;height:365px;object-fit:cover;background:#0a4d92}.content{padding:34px 38px 38px}.tag{display:inline-block;padding:6px 12px;color:#0866c6;background:#eaf4ff;border-radius:20px;font-size:12px;font-weight:bold}h1{font-size:31px;color:var(--dark);line-height:1.55;margin:18px 0 8px}.description{margin:0;color:#516d86;font-size:15px}.facts{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.fact{padding:8px 11px;background:#f7fbff;border:1px solid #e0eefb;border-radius:10px;color:#4b6e8c;font-size:12px}.axes,.outcomes{margin:24px 0 0;padding:19px 20px;border-radius:16px}.axes{background:#f5faff;border:1px solid #dbeafb}.outcomes{background:#f7fbff;border:1px solid #d7eafd}.axes h2,.outcomes h2{margin:0 0 8px;color:#103b70;font-size:19px}.axes ul{margin:0;padding-right:21px}.axes li{margin:5px 0;font-size:14px;color:#456783}.outcomes p{margin:9px 0;color:#385f81;font-size:14px}.outcomes b{display:inline-grid;place-items:center;width:23px;height:23px;margin-left:8px;border-radius:50%;background:#0866c6;color:#fff;font-size:11px}.actions{display:flex;align-items:center;gap:10px;margin-top:25px}.button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:var(--blue);color:#fff;padding:13px 21px;border-radius:11px;font-size:14px;font-weight:bold;box-shadow:0 10px 20px #0866c62b}.secondary{display:inline-flex;align-items:center;text-decoration:none;color:#0866c6;padding:13px 12px;font-size:13px;font-weight:bold}@media(max-width:560px){.wrap{width:calc(100% - 20px);margin:18px auto}.card{border-radius:18px}.cover{height:205px}.content{padding:22px 18px 25px}h1{font-size:24px;margin-top:14px}.description{font-size:13px}.facts{gap:7px;margin:16px 0}.fact{font-size:11px;padding:7px 9px}.axes,.outcomes{margin-top:18px;padding:15px}.axes h2,.outcomes h2{font-size:17px}.axes li,.outcomes p{font-size:13px}.actions{align-items:stretch;flex-direction:column}.button,.secondary{width:100%;justify-content:center}}</style></head><body><main class="wrap"><article class="card">${course.imageUrl ? `<img class="cover" src="${escapeHtml(publicUrl(req, course.imageUrl))}" alt="${escapeHtml(course.name)}">` : `<img class="cover" src="${fallback}" alt="INEXC Training">`}<div class="content"><span class="tag">${escapeHtml(course.category)}</span><h1>${escapeHtml(course.name)}</h1><p class="description">${escapeHtml(course.description)}</p><div class="facts"><span class="fact">📅 ${escapeHtml(course.date || 'سيُعلن قريبًا')}</span><span class="fact">📍 ${escapeHtml(course.location || 'عن بُعد / حضوري')}</span>${course.hours > 0 ? `<span class="fact">⏱️ ${course.hours.toLocaleString('ar-AE')} ساعة تدريبية</span>` : ''}<span class="fact">💳 ${course.price === 0 ? 'مجاني' : `${course.price.toLocaleString('ar-AE')} د.إ`}</span></div>${axes}${outcomes}<div class="actions"><a class="button" href="${registrationUrl}">سجّل في الدورة</a>${sample}</div></div></article></main></body></html>`);
  } catch (error) { next(error); }
});
installSeoSitemap(app, {pool});
app.post('/api/registrations', upload.single('receipt'), async (req, res, next) => {
  try {
    const courseId = clean(req.body.course_id, 80);
    if (clean(req.body.membership_code,80) || req.body.payment_method==='membership') {
      const result=await createCardRegistration(pool,{courseId,code:req.body.membership_code,email:req.body.email,name:req.body.name,phone:req.body.phone,certificateRequested:req.body.certificate==='yes',expectedUnits:req.body.expected_units,expectedCertificateFee:req.body.expected_certificate_fee,receiptPath:req.file?`/uploads/${req.file.filename}`:''}).catch(error=>{if(req.file?.path)fs.unlink(req.file.path,()=>{});throw error});
      if(result.alreadyRegistered&&req.file?.path)fs.unlink(req.file.path,()=>{});
      if(!result.alreadyRegistered)sendRegistrationEmails({reference:result.reference,name:clean(req.body.name,150),email:clean(req.body.email,180),phone:clean(req.body.phone,50),courseName:result.courseName,total:result.certificateFee,status:result.status});
      return res.status(result.alreadyRegistered?200:201).json(result);
    }
    const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1 AND active = true', [courseId]);
    if (!courseResult.rowCount) return res.status(400).json({ error: 'الدورة غير متاحة للتسجيل.' });
    const course = courseResult.rows[0];
    const name = clean(req.body.name, 150), email = clean(req.body.email, 180), phone = clean(req.body.phone, 50);
    if (!name || !email || !phone) return res.status(400).json({ error: 'يرجى إدخال الاسم والبريد الإلكتروني ورقم الموبايل.' });
    const certificateRequested = clean(req.body.certificate) === 'yes';
    const certificate = course.certificate_mode === 'none' ? 'لا' : (course.certificate_mode === 'included' || certificateRequested ? course.certificate_name : 'لا');
    const standardTotal = Number(course.price) + (course.certificate_mode === 'optional' && certificateRequested ? Number(course.certificate_price) : 0);
    const requestedPaymentMethod = clean(req.body.payment_method, 20);
    const paymentMethod = standardTotal === 0 ? 'free' : requestedPaymentMethod;
    if (paymentMethod !== 'membership' && course.public_booking_opens_at && new Date(course.public_booking_opens_at) > new Date()) return res.status(400).json({ error: 'التسجيل العام لهذه الدورة لم يبدأ بعد.' });
    const checkout = validateCoursePayment(course,{method:paymentMethod,total:standardTotal,hasReceipt:!!req.file});
    const registrationReference = reference();
    const total = standardTotal;
    const status = checkout.status;
    const receiptPath = req.file ? `/uploads/${req.file.filename}` : '';
    const inserted = await pool.query(`INSERT INTO registrations (reference,name,email,phone,course_id,course_name,certificate,total,payment_method,status,receipt_path,membership_card_id,membership_redemption_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [registrationReference,name,email,phone,course.id,course.name,certificate,total,paymentMethod,status,receiptPath,null,null]);
    sendRegistrationEmails({ reference: registrationReference, name, email, phone, courseName: course.name, total, status });
    res.status(201).json({ ok: true, reference: registrationReference, paymentLink: checkout.paymentLink });
  } catch (error) { next(error); }
});
app.post('/api/institution-requests', async (req, res, next) => {
  try {
    const name = clean(req.body?.name, 150), email = clean(req.body?.email, 180), phone = clean(req.body?.phone, 50);
    const organization = clean(req.body?.organization, 220), requestDetails = clean(req.body?.requestDetails, 3000);
    const audienceSize = clean(req.body?.audienceSize, 100), preferredTiming = clean(req.body?.preferredTiming, 240), certificateInterest = clean(req.body?.certificateInterest, 120) || 'غير محدد';
    if (!name || !email || !phone || !organization || !requestDetails) return res.status(400).json({ error: 'يرجى إدخال بيانات التواصل واسم المؤسسة وتفاصيل الاحتياج.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح.' });
    const registrationReference = reference();
    const status = 'طلب مؤسسة جديد';
    await pool.query(`INSERT INTO registrations (reference,name,email,phone,course_name,certificate,total,payment_method,status,request_kind,organization,request_details,audience_size,preferred_timing,certificate_interest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [registrationReference,name,email,phone,'طلب برنامج مؤسسي','غير محدد',0,'institution_request',status,'institution',organization,requestDetails,audienceSize,preferredTiming,certificateInterest]);
    sendInstitutionRequestEmails({ reference: registrationReference, name, email, phone, organization, requestDetails, audienceSize, preferredTiming, certificateInterest });
    res.status(201).json({ ok: true, reference: registrationReference });
  } catch (error) { next(error); }
});

const adminRecoveryEmail = String(process.env.ADMIN_RECOVERY_EMAIL || 'ahmadanakwa@gmail.com').trim();
const adminUsername = String(process.env.ADMIN_USERNAME || 'ahmadanakwa@gmail.com').trim();
const passwordHashValue = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
function recoveryAllowed(req) {
  const key=String(req.ip || req.socket?.remoteAddress || 'unknown'); const now=Date.now(); const recent=(adminRecoveryAttempts.get(key)||[]).filter(time=>now-time<15*60*1000);
  if(recent.length>=2){adminRecoveryAttempts.set(key,recent);return false;} recent.push(now);adminRecoveryAttempts.set(key,recent);return true;
}
app.post('/api/admin/login', async (req, res, next) => {
  try {
    const username=clean(req.body?.username,160).toLowerCase();
    const password = String(req.body?.password || '').slice(0, 256);
    if(username!==adminUsername.toLowerCase()) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    const saved=await pool.query("SELECT value FROM app_settings WHERE key='admin_password_hash'");
    const stored=saved.rows[0]?.value||'';
    const expectedHash=stored.startsWith('sha256:') ? stored.slice(7) : passwordHashValue(process.env.ADMIN_PASSWORD);
    const valid=crypto.timingSafeEqual(Buffer.from(passwordHashValue(password),'hex'),Buffer.from(expectedHash,'hex'));
    if (!valid) return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
    pruneSessions(); const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
    res.json({ token, expiresIn: 28800 });
  } catch(error) { next(error); }
});
app.post('/api/admin/password-recovery', async (req,res,next) => {
  try {
    if(!recoveryAllowed(req)) return res.status(429).json({ error:'تم إرسال طلبين مؤخرًا. انتظر 15 دقيقة ثم أعد المحاولة.' });
    if(!resendApiKey) return res.status(503).json({ error:'خدمة استرجاع الدخول غير مهيّأة حاليًا.' });
    await pool.query("DELETE FROM admin_password_resets WHERE expires_at < now() OR used_at IS NOT NULL");
    const token=crypto.randomBytes(32).toString('hex'); const tokenHash=passwordHashValue(token);
    await pool.query("INSERT INTO admin_password_resets (token_hash,expires_at) VALUES ($1,now() + interval '30 minutes')",[tokenHash]);
    const link='https://www.inexctraining.com/admin/#reset='+encodeURIComponent(token);
    const content='<p>تم طلب استرجاع بيانات دخول لوحة إدارة INEXC.</p><p><b>اسم المستخدم:</b> '+escapeHtml(adminUsername)+'</p><p>لأمان الحساب لا نرسل كلمة المرور الحالية؛ استخدم الرابط التالي لإنشاء كلمة مرور جديدة. ينتهي الرابط خلال 30 دقيقة ويُستخدم مرة واحدة فقط.</p><p style="text-align:center"><a href="'+link+'" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;border-radius:9px;padding:11px 20px;font-weight:700">إنشاء كلمة مرور جديدة</a></p><p style="font-size:12px;color:#64778c;direction:ltr;text-align:center">'+link+'</p><p style="font-size:12px;color:#64778c">إذا لم تطلب ذلك، تجاهل الرسالة ولن يتغير شيء.</p>';
    await sendEmail({to:adminRecoveryEmail,subject:'استرجاع دخول لوحة إدارة INEXC',html:emailShell({title:'استرجاع بيانات الدخول',preview:'رابط آمن لإعادة تعيين كلمة مرور لوحة الإدارة.',content})});
    res.json({ok:true,message:'أرسلنا اسم المستخدم ورابطًا آمنًا لإنشاء كلمة مرور جديدة إلى البريد المعتمد.'});
  } catch(error) { next(error); }
});
app.post('/api/admin/password-reset', async (req,res,next) => {
  try {
    const token=clean(req.body?.token,200), password=String(req.body?.password||'').slice(0,256);
    if(!token || !password) return res.status(400).json({error:'أدخل كلمة المرور.'});
    const result=await pool.query("UPDATE admin_password_resets SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING id",[passwordHashValue(token)]);
    if(!result.rowCount) return res.status(400).json({error:'رابط الاسترجاع غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.'});
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('admin_password_hash',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",['sha256:'+passwordHashValue(password)]);
    sessions.clear();
    res.json({ok:true,message:'تم حفظ كلمة المرور الجديدة. يمكنك تسجيل الدخول الآن.'});
  } catch(error) { next(error); }
});
app.post('/api/admin/logout', auth, (req, res) => { sessions.delete(String(req.headers.authorization).replace(/^Bearer\s+/i, '')); res.json({ ok: true }); });
app.get('/api/admin/settings', auth, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT key,value FROM app_settings WHERE key IN ('brand_logo','hero_preview_visible','testimonials_visible')");
    const settings = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
    res.json({ logoUrl: settings.brand_logo || '', heroPreviewVisible: settings.hero_preview_visible !== 'false', testimonialsVisible: settings.testimonials_visible !== 'false' });
  } catch (error) { next(error); }
});
app.post('/api/admin/settings/hero-preview', auth, async (req, res, next) => {
  try {
    const visible = req.body?.visible !== false;
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('hero_preview_visible',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [visible ? 'true' : 'false']);
    res.json({ ok: true, heroPreviewVisible: visible });
  } catch (error) { next(error); }
});
app.post('/api/admin/settings/testimonials', auth, async (req, res, next) => {
  try {
    const visible = req.body?.visible !== false;
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('testimonials_visible',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [visible ? 'true' : 'false']);
    res.json({ ok: true, testimonialsVisible: visible });
  } catch (error) { next(error); }
});
app.post('/api/admin/settings/logo', auth, logoUpload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختر ملف الشعار أولًا.' });
    const logoUrl = `/uploads/${req.file.filename}`;
    const previous = await pool.query("SELECT value FROM app_settings WHERE key='brand_logo'");
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('brand_logo',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [logoUrl]);
    const old = previous.rows[0]?.value || '';
    if (old.startsWith('/uploads/')) fs.unlink(path.join(uploadDir, path.basename(old)), () => {});
    res.status(201).json({ ok: true, logoUrl });
  } catch (error) { next(error); }
});
app.get('/api/admin/course-alerts/settings', auth, async (_req, res, next) => {
  try { res.json(await getCourseAlertSettings()); } catch (error) { next(error); }
});
app.post('/api/admin/course-alerts/settings', auth, async (req, res, next) => {
  try {
    const enabled = req.body?.enabled !== false;
    const rawDelay = Number(req.body?.delayMinutes);
    const delayMinutes = Math.max(0, Math.min(10080, Number.isFinite(rawDelay) ? Math.round(rawDelay) : 60));
    const deliveryMode = req.body?.deliveryMode === 'manual' ? 'manual' : 'auto';
    const requestedBatchSize = Number(req.body?.batchSize);
    const batchSize = [100,200,300,400,500].includes(requestedBatchSize) ? requestedBatchSize : 100;
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('course_alerts_enabled',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [enabled ? 'true' : 'false']);
    const subject = clean(req.body?.subject || defaultCourseAlertSubject, 220);
    const message = clean(req.body?.message || defaultCourseAlertMessage, 4000);
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('course_alert_delay_minutes',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [String(delayMinutes)]);
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('course_alert_subject',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [subject]);
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('course_alert_message',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [message]);
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('course_alert_delivery_mode',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [deliveryMode]);
    await pool.query("INSERT INTO app_settings (key,value,updated_at) VALUES ('course_alert_batch_size',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [String(batchSize)]);
    res.json({ enabled, delayMinutes, deliveryMode, batchSize, subject, message });
  } catch (error) { next(error); }
});
app.post('/api/admin/course-alerts/release', auth, async (req, res, next) => {
  try {
    const settings = await getCourseAlertSettings();
    if (!settings.enabled) return res.status(400).json({ error: 'فعّل تنبيهات الدورات أولًا.' });
    if (settings.deliveryMode !== 'manual') return res.status(400).json({ error: 'اختر وضع الإرسال اليدوي على دفعات أولًا.' });
    const requestedCount = Number(req.body?.count);
    const count = [100,200,300,400,500].includes(requestedCount) ? requestedCount : settings.batchSize;
    const result = await pool.query(`WITH next_batch AS (
      SELECT d.id FROM course_alert_deliveries d
      JOIN course_alert_subscribers s ON s.id=d.subscriber_id AND s.active=true
      LEFT JOIN email_preferences p ON p.email=s.email
      WHERE d.status='queued' AND d.send_after <= now() AND d.released_at IS NULL
        AND COALESCE(p.marketing_opt_out,false)=false
      ORDER BY d.send_after ASC LIMIT $1
    ) UPDATE course_alert_deliveries d SET released_at=now() FROM next_batch n WHERE d.id=n.id RETURNING d.id`, [count]);
    void processCourseAlertQueue();
    res.json({ ok: true, released: result.rowCount, requested: count });
  } catch (error) { next(error); }
});
app.post('/api/admin/course-alerts/send-now', auth, async (req, res, next) => {
  try {
    const courseId = clean(req.body?.courseId, 80);
    const requestedCount = Number(req.body?.count);
    const count = [100,200,300,400,500].includes(requestedCount) ? requestedCount : 100;
    const courseResult = await pool.query('SELECT * FROM courses WHERE id=$1 AND active=true', [courseId]);
    if (!courseResult.rowCount) return res.status(400).json({ error: 'اختر دورة منشورة أولًا.' });
    const course = publicCourse(courseResult.rows[0]);
    const result = await pool.query(`WITH recipients AS (
      SELECT s.id FROM course_alert_subscribers s
      LEFT JOIN email_preferences p ON p.email=s.email
      WHERE s.active=true AND s.suppressed=false AND COALESCE(p.marketing_opt_out,false)=false
        AND NOT EXISTS (SELECT 1 FROM course_alert_deliveries d WHERE d.subscriber_id=s.id AND d.course_id=$1)
      ORDER BY s.created_at ASC
      LIMIT $2
    ) INSERT INTO course_alert_deliveries (subscriber_id,course_id,status,send_after,released_at)
      SELECT id,$1,'queued',now(),now() FROM recipients
      ON CONFLICT (subscriber_id,course_id) DO NOTHING
      RETURNING id`, [course.id, count]);
    void processCourseAlertQueue({ force: true, courseId: course.id, limit: count });
    res.json({ ok: true, courseName: course.name, queued: result.rowCount, requested: count });
  } catch (error) { next(error); }
});
app.post('/api/admin/course-alerts/:id/send', auth, async (req, res, next) => {
  try {
    const subscriberResult = await pool.query('SELECT * FROM course_alert_subscribers WHERE id=$1', [req.params.id]);
    if (!subscriberResult.rowCount) return res.status(404).json({ error: 'لم نجد هذا البريد في قائمة التنبيهات.' });
    const subscriber = subscriberResult.rows[0];
    if (!subscriber.active || subscriber.suppressed) return res.status(400).json({ error: 'هذا البريد موقوف نهائيًا ولا يمكن الإرسال إليه.' });
    const preference = await getEmailPreference(subscriber.email);
    if (preference.marketing_opt_out) return res.status(400).json({ error: 'ألغى هذا البريد اشتراكه من الرسائل، لذلك لا يمكن الإرسال إليه.' });
    const courseId = clean(req.body?.courseId, 80);
    const courseResult = await pool.query('SELECT * FROM courses WHERE id=$1 AND active=true', [courseId]);
    if (!courseResult.rowCount) return res.status(400).json({ error: 'اختر دورة منشورة أولًا.' });
    const course = publicCourse(courseResult.rows[0]);
    const settings = await getCourseAlertSettings();
    const sent = await sendEmail({
      to: subscriber.email, marketing:true,
      subject: mergeCourseAlertTemplate(settings.subject, course),
      html: emailShell({
        title: course.name,
        preview: mergeCourseAlertTemplate(settings.subject, course),
        content: '<h1 style="margin:0 0 12px;font-size:24px;color:#0b4b91">' + escapeHtml(course.name) + '</h1><div style="border:1px solid #d9e8f7;border-radius:14px;padding:20px;background:#fbfdff"><div style="color:#58708a;line-height:2">' + escapeHtml(mergeCourseAlertTemplate(settings.message, course)).replace(/\n/g, '<br>') + '</div></div><div style="text-align:center;margin:26px 0 20px"><a href="' + coursePublicUrl(course) + '" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;padding:12px 25px;border-radius:10px;font-weight:800">استعرض الدورة وسجّل</a></div><p style="margin:0;text-align:center;font-size:11px;color:#7890a8">لا ترغب في تلقي التنبيهات؟ <a href="' + unsubscribeUrl(subscriber.unsubscribe_token) + '" style="color:#0866c6">إلغاء الاشتراك</a></p>'
      })
    });
    await pool.query("INSERT INTO course_alert_deliveries (subscriber_id,course_id,resend_email_id,status,send_after,released_at) VALUES ($1,$2,$3,'sent',now(),now()) ON CONFLICT (subscriber_id,course_id) DO UPDATE SET resend_email_id=EXCLUDED.resend_email_id,status='sent',error='',released_at=now()", [subscriber.id, course.id, sent?.id || '']);
    res.json({ ok: true, email: subscriber.email, courseName: course.name });
  } catch (error) { next(error); }
});
app.post('/api/admin/course-alerts/test', auth, async (req, res, next) => {
  try {
    const email = clean(String(req.body?.email || '').toLowerCase(), 190);
    if (!alertEmailPattern.test(email)) return res.status(400).json({ error: 'أدخل بريدًا إلكترونيًا صحيحًا للإرسال التجريبي.' });
    const result = await pool.query('SELECT * FROM courses WHERE active=true ORDER BY created_at DESC LIMIT 1');
    if (!result.rowCount) return res.status(400).json({ error: 'لا توجد دورة منشورة لإرسال معاينة تجريبية.' });
    const course = publicCourse(result.rows[0]);
    const settings = await getCourseAlertSettings();
    const preference = await getEmailPreference(email);
    await sendEmail({
      to: email, marketing:true,
      subject: '[تجريبي] ' + mergeCourseAlertTemplate(settings.subject, course),
      html: emailShell({
        title: 'رسالة تجريبية لتنبيه دورة',
        preview: 'هذه معاينة تجريبية فقط لرسالة الدورات الجديدة.',
        content: '<h1 style="margin:0 0 12px;font-size:24px;color:#0b4b91">هذه رسالة تجريبية</h1><p style="margin:0 0 18px;color:#58708a">هكذا سيصل المحتوى الذي حفظته إلى المشتركين.</p><div style="border:1px solid #d9e8f7;border-radius:14px;padding:20px;background:#fbfdff"><div style="font-size:19px;font-weight:800;color:#173d6b">' + escapeHtml(course.name) + '</div><p style="margin:10px 0;color:#58708a;line-height:2">' + escapeHtml(mergeCourseAlertTemplate(settings.message, course)).replace(/\n/g, '<br>') + '</p></div><div style="text-align:center;margin:26px 0 0"><a href="' + coursePublicUrl(course) + '" style="display:inline-block;background:#0866c6;color:#fff;text-decoration:none;padding:12px 25px;border-radius:10px;font-weight:800">استعرض الدورة وسجّل</a></div><p style="margin:22px 0 0;text-align:center;font-size:11px;color:#7890a8">لا ترغب في تلقي رسائل INEXC؟ <a href="' + emailPreferenceUnsubscribeUrl(preference.unsubscribe_token) + '" style="color:#0866c6">إلغاء الاشتراك</a></p>'
      })
    });
    res.json({ ok: true, courseName: course.name });
  } catch (error) { next(error); }
});
app.post('/api/admin/course-alerts/import', auth, courseAlertImportUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختر ملف الإيميلات أولًا.' });
    const emails = (await extractAlertEmails(req.file)).slice(0, 3000);
    fs.unlink(req.file.path, () => {});
    if (!emails.length) return res.status(400).json({ error: 'لم نجد عناوين بريد إلكتروني صالحة داخل الملف.' });
    let added = 0, existing = 0, unsubscribed = 0;
    for (const email of emails) {
      const preference = await getEmailPreference(email);
      const suppressed = (await pool.query('SELECT suppressed FROM message_contacts WHERE normalized_email=$1',[email])).rows[0]?.suppressed;
      if (preference.marketing_opt_out || suppressed) { unsubscribed += 1; continue; }
      const current = await pool.query('SELECT active,suppressed FROM course_alert_subscribers WHERE email=$1', [email]);
      if (current.rowCount) {
        if (current.rows[0].active) existing += 1; else unsubscribed += 1;
        continue;
      }
      await pool.query('INSERT INTO course_alert_subscribers (email,unsubscribe_token) VALUES ($1,$2)', [email, crypto.randomBytes(24).toString('hex')]);
      added += 1;
    }
    res.status(201).json({ ok: true, found: emails.length, added, existing, unsubscribed, limitReached: emails.length >= 3000 });
  } catch (error) { if (req.file?.path) fs.unlink(req.file.path, () => {}); next(error); }
});
app.get('/api/admin/course-alerts', auth, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT s.id,s.email,s.active,s.suppressed,s.created_at,
      COUNT(d.id)::int AS deliveries,
      COUNT(d.id) FILTER (WHERE d.status='queued')::int AS queued,
      COUNT(d.id) FILTER (WHERE d.status='sent')::int AS sent,
      COUNT(d.id) FILTER (WHERE d.status='failed')::int AS failed,
      MAX(d.created_at) AS last_delivery
      FROM course_alert_subscribers s LEFT JOIN course_alert_deliveries d ON d.subscriber_id=s.id
      GROUP BY s.id ORDER BY s.created_at DESC`);
    res.json(result.rows.map(row => ({ id: row.id, email: row.email, active: row.active, suppressed: row.suppressed === true, createdAt: row.created_at, deliveries: row.deliveries, queued: row.queued, sent: row.sent, failed: row.failed, lastDelivery: row.last_delivery })));
  } catch (error) { next(error); }
});
app.delete('/api/admin/course-alerts/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('UPDATE course_alert_subscribers SET active=false,suppressed=true,updated_at=now() WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'المشترك غير موجود.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get('/api/admin/testimonials', auth, async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM testimonials ORDER BY (status=\'featured\') DESC, created_at DESC');
    res.json(result.rows.map(row => ({ id: row.id, name: row.name, content: row.content, imageUrl: row.image_path || '', rating: Number(row.rating || 5), verified: row.verified === true, status: row.status })));
  } catch (error) { next(error); }
});
app.post('/api/admin/testimonials', auth, async (req, res, next) => {
  try {
    const data = req.body || {}; const status = ['draft','visible','hidden','featured'].includes(data.status) ? data.status : 'draft';
    if (!clean(data.name, 120) || !clean(data.content, 2000)) return res.status(400).json({ error: 'الاسم ومحتوى الرأي مطلوبان.' });
    const rating = Math.max(1, Math.min(5, Math.round(Number(data.rating) || 5)));
    const result = await pool.query('INSERT INTO testimonials (name,content,rating,verified,status) VALUES ($1,$2,$3,$4,$5) RETURNING *', [clean(data.name,120), clean(data.content,2000), rating, data.verified === true, status]);
    const row = result.rows[0]; res.status(201).json({ id: row.id, name: row.name, content: row.content, imageUrl: row.image_path || '', rating: Number(row.rating), verified: row.verified, status: row.status });
  } catch (error) { next(error); }
});
app.put('/api/admin/testimonials/:id', auth, async (req, res, next) => {
  try {
    const data = req.body || {}; const status = ['draft','visible','hidden','featured'].includes(data.status) ? data.status : 'draft';
    if (!clean(data.name, 120) || !clean(data.content, 2000)) return res.status(400).json({ error: 'الاسم ومحتوى الرأي مطلوبان.' });
    const rating = Math.max(1, Math.min(5, Math.round(Number(data.rating) || 5)));
    const result = await pool.query('UPDATE testimonials SET name=$1,content=$2,rating=$3,verified=$4,status=$5,updated_at=now() WHERE id=$6 RETURNING *', [clean(data.name,120), clean(data.content,2000), rating, data.verified === true, status, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'الرأي غير موجود.' });
    const row = result.rows[0]; res.json({ id: row.id, name: row.name, content: row.content, imageUrl: row.image_path || '', rating: Number(row.rating), verified: row.verified, status: row.status });
  } catch (error) { next(error); }
});
app.post('/api/admin/testimonials/:id/image', auth, testimonialImageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختر صورة أولًا.' });
    const current = await pool.query('SELECT image_path FROM testimonials WHERE id=$1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'الرأي غير موجود.' });
    const imagePath = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE testimonials SET image_path=$1,updated_at=now() WHERE id=$2', [imagePath, req.params.id]);
    if (current.rows[0].image_path) fs.unlink(path.join(uploadDir, path.basename(current.rows[0].image_path)), () => {});
    res.status(201).json({ ok: true, imageUrl: imagePath });
  } catch (error) { next(error); }
});
app.delete('/api/admin/testimonials/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM testimonials WHERE id=$1 RETURNING image_path', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'الرأي غير موجود.' });
    if (result.rows[0].image_path) fs.unlink(path.join(uploadDir, path.basename(result.rows[0].image_path)), () => {});
    res.json({ ok: true });
  } catch (error) { next(error); }
});
createCoursePaymentControls({pool,stripe:stripePayments,publicCourse}).install(app,auth);
app.get('/api/admin/course-card-options', auth, async (_req,res,next)=>{try{const plans=await pool.query('SELECT id,name,active FROM membership_plans ORDER BY sort_order,created_at');res.json({version:1,plans:plans.rows.map(p=>({id:p.id,cardName:membershipCardName(p.name),active:p.active}))});}catch(error){next(error);}});
app.get('/api/admin/courses', auth, async (_req, res, next) => { try { const result = await pool.query('SELECT * FROM courses ORDER BY active DESC, created_at DESC'); res.json((await attachCourseCardNames(pool,result.rows)).map(publicCourse)); } catch (error) { next(error); } });
app.post('/api/admin/course-import', auth, courseImportUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختر ملف Word أو TXT أولًا.' });
    const extension = path.extname(req.file.originalname).toLowerCase();
    let extracted;
    if (extension === '.docx') extracted = (await mammoth.extractRawText({ path: req.file.path })).value;
    else if (extension === '.pdf') {
      const parser = new PDFParse({ data: fs.readFileSync(req.file.path) });
      try { extracted = (await parser.getText()).text; } catch (error) { console.warn('PDF text extraction failed; attempting OCR:', error.message); extracted = ''; } finally { await parser.destroy(); }
      if (!hasReadableCourseText(extracted)) extracted = await extractPdfWithOcr(req.file.path);
    } else extracted = fs.readFileSync(req.file.path, 'utf8');
    fs.unlink(req.file.path, () => {});
    const parsed = parseCourseDocument(extracted);
    if (!parsed.name && !parsed.description && !parsed.axes) return res.status(400).json({ error: 'تعذر استخراج محتوى واضح من الملف، حتى عبر القراءة الضوئية. تأكد من أن صفحات PDF واضحة وغير محمية.' });
    res.json({ ok: true, ...parsed, axes: courseAxes(parsed.axes), outcomes: courseOutcomes(parsed.outcomes) });
  } catch (error) { if (req.file?.path) fs.unlink(req.file.path, () => {}); next(error); }
});
app.post('/api/admin/courses/:id/image', auth, courseMediaUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'ارفع صورة للدورة بصيغة PNG أو JPG أو WEBP.' });
    const current = await pool.query('SELECT image_path FROM courses WHERE id=$1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    const imagePath = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE courses SET image_path=$1, updated_at=now() WHERE id=$2', [imagePath, req.params.id]);
    if (current.rows[0].image_path) fs.unlink(path.join(uploadDir, path.basename(current.rows[0].image_path)), () => {});
    res.status(201).json({ ok: true, imageUrl: imagePath });
  } catch (error) { next(error); }
});
app.post('/api/admin/courses/:id/certificate-sample', auth, courseMediaUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختر نموذج الشهادة أولًا.' });
    const current = await pool.query('SELECT certificate_sample_path FROM courses WHERE id=$1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    const samplePath = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE courses SET certificate_sample_path=$1, updated_at=now() WHERE id=$2', [samplePath, req.params.id]);
    if (current.rows[0].certificate_sample_path) fs.unlink(path.join(uploadDir, path.basename(current.rows[0].certificate_sample_path)), () => {});
    res.status(201).json({ ok: true, certificateSampleUrl: samplePath });
  } catch (error) { next(error); }
});
app.post('/api/admin/courses', auth, async (req, res, next) => {
  try {
    const c = req.body || {}; const {methods,membershipEnabled}=await coursePaymentInput(pool,c); const access=await courseCardInput(pool,c);
    if (!clean(c.name, 180)) return res.status(400).json({ error: 'اسم الدورة مطلوب.' });
    const values = [clean(c.name,180),clean(c.description,1000),courseAxes(c.axes).join('\n'),courseOutcomes(c.outcomes).join('\n'),clean(c.trainer,180),clean(c.date,80),clean(c.location,160),clean(c.category,100),asNumber(c.price),asNumber(c.hours),clean(c.certificate?.mode,20)||'included',clean(c.certificate?.name,180),asNumber(c.certificate?.price),methods,clean(c.paymentLink,500),clean(c.bank?.name,200),clean(c.bank?.account,200),clean(c.bank?.iban,200),c.active !== false,membershipEnabled,access.featured,access.membershipPlanIds];
    const result = await pool.query(`INSERT INTO courses (name,description,axes,outcomes,trainer,course_date,location,category,price,training_hours,certificate_mode,certificate_name,certificate_price,payment_methods,payment_link,bank_name,bank_account,bank_iban,active,membership_enabled,featured,membership_plan_ids)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`, values);
    let saved = result.rows[0];
    if (!saved.share_slug) saved = (await pool.query('UPDATE courses SET share_slug=$1 WHERE id=$2 RETURNING *', [courseSlug(saved.id), saved.id])).rows[0];
    const published = publicCourse((await attachCourseCardNames(pool,[saved]))[0]);
    res.status(201).json(published);
    if (published.active) void queueCourseAlertEmails(published);
  } catch (error) { next(error); }
});
app.put('/api/admin/courses/:id', auth, async (req, res, next) => {
  try {
    const before = await pool.query('SELECT * FROM courses WHERE id=$1', [req.params.id]);
    if (!before.rowCount) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    const c = req.body || {}; const {methods,membershipEnabled}=await coursePaymentInput(pool,c,before.rows[0]); const access=await courseCardInput(pool,c,before.rows[0]);
    const values = [clean(c.name,180),clean(c.description,1000),courseAxes(c.axes).join('\n'),courseOutcomes(c.outcomes).join('\n'),clean(c.trainer,180),clean(c.date,80),clean(c.location,160),clean(c.category,100),asNumber(c.price),asNumber(c.hours),clean(c.certificate?.mode,20)||'included',clean(c.certificate?.name,180),asNumber(c.certificate?.price),methods,clean(c.paymentLink,500),clean(c.bank?.name,200),clean(c.bank?.account,200),clean(c.bank?.iban,200),c.active !== false,membershipEnabled,access.featured,access.membershipPlanIds, req.params.id];
    const result = await pool.query(`UPDATE courses SET name=$1,description=$2,axes=$3,outcomes=$4,trainer=$5,course_date=$6,location=$7,category=$8,price=$9,training_hours=$10,certificate_mode=$11,certificate_name=$12,certificate_price=$13,payment_methods=$14,payment_link=$15,bank_name=$16,bank_account=$17,bank_iban=$18,active=$19,membership_enabled=$20,featured=$21,membership_plan_ids=$22,updated_at=now() WHERE id=$23 RETURNING *`, values);
    let saved = result.rows[0];
    if (!saved.share_slug) saved = (await pool.query('UPDATE courses SET share_slug=$1 WHERE id=$2 RETURNING *', [courseSlug(saved.id), saved.id])).rows[0];
    const published = publicCourse((await attachCourseCardNames(pool,[saved]))[0]);
    res.json(published);
    if (before.rows[0].active === false && published.active) void queueCourseAlertEmails(published);
  } catch (error) { next(error); }
});
app.delete('/api/admin/courses/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM courses WHERE id=$1 RETURNING name', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    res.json({ ok: true, name: result.rows[0].name });
  } catch (error) { next(error); }
});
app.get('/api/admin/registrations', auth, async (_req, res, next) => { try { const result = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC'); res.json(result.rows.map(r => ({...r,plan_name:trainingPackageText(r.plan_name),total:Number(r.total)}))); } catch (error) { next(error); } });
app.put('/api/admin/registrations/:id/status', auth, async (req, res, next) => { try { const status = clean(req.body?.status,80); const allowed=['بانتظار الدفع','بانتظار مراجعة الوصل','مدفوع','مؤكد','ملغى','مسجل','مسجل بالبطاقة','طلب مؤسسة جديد','قيد التواصل']; if(!allowed.includes(status)) return res.status(400).json({error:'حالة غير صالحة.'}); await pool.query('UPDATE registrations SET status=$1,updated_at=now() WHERE id=$2',[status,req.params.id]); res.json({ok:true}); } catch(error){next(error);} });
app.delete('/api/admin/registrations/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM registrations WHERE id=$1 RETURNING receipt_path', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'طلب التسجيل غير موجود.' });
    const receipt = result.rows[0].receipt_path;
    if (receipt) fs.unlink(path.join(uploadDir, path.basename(receipt)), () => {});
    res.json({ ok: true });
  } catch (error) { next(error); }
});
installMessageSubscriptions({app,pool,auth,sendEmail,mailEnabled:!!resendApiKey});
installMessageStudio({app,pool,auth,importUpload:messageRecipientImportUpload,resolveRecipients:resolveMessageRecipients,getPreference:getEmailPreference,sendEmail,worker:processScheduledMessageCampaigns,emailFrom,mailEnabled:!!resendApiKey,webhookEnabled:!!process.env.RESEND_WEBHOOK_SECRET,uploadDir});

app.post('/api/admin/message-attachments', auth, messageAttachmentUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'اختر ملفًا لإرفاقه.' });
  res.status(201).json({ ok: true, attachmentPath: `/uploads/${req.file.filename}`, fileName: req.file.originalname });
});
app.get('/api/admin/message-capabilities', auth, (_req, res) => res.json({ richText: 2, studio: 5, subscriptions: 2 }));
app.get('/api/admin/message-templates', auth, async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT id,name,subject,body,cta_label,cta_url,created_at,updated_at FROM message_templates ORDER BY updated_at DESC');
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.post('/api/admin/message-templates', auth, async (req, res, next) => {
  try {
    const name = clean(req.body?.name, 120), subject = clean(req.body?.subject, 160), body = normaliseMessageBody(req.body?.body);
    const ctaLabel = clean(req.body?.ctaLabel, 80), ctaUrl = safeMessageUrl(req.body?.ctaUrl);
    if (!name) return res.status(400).json({ error: 'اكتب اسمًا للقالب.' });
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) return res.status(400).json({ error: 'اكتب نص الزر ورابطه معًا، أو اتركهما فارغين.' });
    const result = await pool.query('INSERT INTO message_templates(name,subject,body,cta_label,cta_url) VALUES($1,$2,$3,$4,$5) RETURNING *', [name, subject, body, ctaLabel, ctaUrl]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});
app.put('/api/admin/message-templates/:id', auth, async (req, res, next) => {
  try {
    const name = clean(req.body?.name, 120), subject = clean(req.body?.subject, 160), body = normaliseMessageBody(req.body?.body);
    const ctaLabel = clean(req.body?.ctaLabel, 80), ctaUrl = safeMessageUrl(req.body?.ctaUrl);
    if (!name) return res.status(400).json({ error: 'اكتب اسمًا للقالب.' });
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) return res.status(400).json({ error: 'اكتب نص الزر ورابطه معًا، أو اتركهما فارغين.' });
    const result = await pool.query('UPDATE message_templates SET name=$1,subject=$2,body=$3,cta_label=$4,cta_url=$5,updated_at=now() WHERE id=$6 RETURNING *', [name, subject, body, ctaLabel, ctaUrl, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'لم نجد هذا القالب.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});
app.delete('/api/admin/message-templates/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM message_templates WHERE id=$1 RETURNING name', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'لم نجد هذا القالب.' });
    res.json({ ok: true, name: result.rows[0].name });
  } catch (error) { next(error); }
});
app.get('/api/admin/message-lists', auth, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT l.id,l.name,l.created_at,l.updated_at,count(m.contact_id)::int AS total,
      count(m.contact_id) FILTER (WHERE c.email<>'')::int AS with_email
      FROM message_recipient_lists l LEFT JOIN message_recipient_list_members m ON m.list_id=l.id
      LEFT JOIN message_contacts c ON c.id=m.contact_id GROUP BY l.id ORDER BY l.updated_at DESC`);
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.get('/api/admin/message-lists/:id/contacts', auth, async (req, res, next) => {
  try {
    const page = Math.max(0, Math.min(1000, parseInt(req.query.page,10) || 0));
    const result = await pool.query(`SELECT c.id,c.full_name,c.email,c.created_at FROM message_recipient_list_members m
      JOIN message_contacts c ON c.id=m.contact_id WHERE m.list_id=$1 ORDER BY c.created_at DESC,c.id LIMIT 100 OFFSET $2`, [req.params.id,page*100]);
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.put('/api/admin/message-contacts/:id', auth, async (req, res, next) => {
  try {
    const contact = normaliseMessageContact({ name: req.body?.name, email: req.body?.email });
    if (!contact.name && !contact.email) return res.status(400).json({ error: 'اكتب الاسم أو البريد على الأقل.' });
    if (req.body?.email && !contact.email) return res.status(400).json({ error: 'عنوان البريد غير صالح.' });
    const result = await pool.query('UPDATE message_contacts SET full_name=$1,email=$2,normalized_email=$2,updated_at=now() WHERE id=$3 RETURNING id,full_name,email', [contact.name, contact.email, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'لم نجد جهة الاتصال.' });
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'هذا البريد موجود بالفعل في جهة اتصال أخرى.' });
    next(error);
  }
});
app.post('/api/admin/message-lists', auth, async (req, res, next) => {
  try {
    const list = await saveMessageRecipientList(req.body?.name, req.body?.rows);
    res.status(201).json(list);
  } catch (error) { res.status(400).json({ error: error.message || 'تعذر حفظ القائمة.' }); }
});
app.post('/api/admin/message-lists/import-file', auth, messageRecipientImportUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختر ملف القائمة أولًا.' });
    const rows = await extractMessageContacts(req.file);
    const list = await saveMessageRecipientList(req.body?.name, rows);
    res.status(201).json(list);
  } catch (error) { next(Object.assign(error, { status: 400 })); }
  finally { if (req.file) await fs.promises.unlink(req.file.path).catch(() => {}); }
});
app.delete('/api/admin/message-lists/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM message_recipient_lists WHERE id=$1 RETURNING name', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'لم نجد هذه القائمة.' });
    res.json({ ok: true, name: result.rows[0].name });
  } catch (error) { next(error); }
});
app.post('/api/admin/messages/preview-recipients', auth, async (req, res) => {
  try {
    const resolved = await resolveMessageRecipients(req.body || {});
    res.json({ ok: true, total: resolved.totalCandidates, ready: resolved.recipients.length, skippedUnsubscribed: resolved.skippedUnsubscribed, courseName: resolved.courseName });
  } catch (error) { res.status(400).json({ error: error.message || 'تعذر فحص المستلمين.' }); }
});
app.post('/api/admin/messages/test', auth, async (req, res) => {
  try {
    if (!resendApiKey) return res.status(503).json({ error: 'خدمة البريد غير مهيأة حاليًا.' });
    const test = normaliseMessageContact({ email: req.body?.email, name: req.body?.name });
    const subject = clean(req.body?.subject, 160), body = normaliseMessageBody(req.body?.message);
    const ctaLabel = clean(req.body?.ctaLabel, 80), ctaUrl = safeMessageUrl(req.body?.ctaUrl);
    if (!test.email || !subject || !body) return res.status(400).json({ error: 'أدخل بريد التجربة وعنوان الرسالة ونصها.' });
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) return res.status(400).json({ error: 'اكتب نص الزر ورابطه معًا، أو اتركهما فارغين.' });
    const course = clean(req.body?.courseName, 180);
    const preference = await getEmailPreference(test.email);
    const message = messageEmailMarkup({ subject: `${messageDirection(messageText(body)) === 'ltr' ? '[Test]' : '[تجريبية]'} ${subject}`, body, ctaLabel, ctaUrl, person: test, preference, courseName: course });
    await sendEmail({ to: test.email, marketing:true, subject: message.subject, html: message.html });
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message || 'تعذر إرسال الرسالة التجريبية.' }); }
});
app.post('/api/admin/messages', auth, async (req, res, next) => {
  try {
    if (!resendApiKey) return res.status(503).json({ error: 'خدمة البريد غير مهيأة حاليًا.' });
    // Legacy clients retain their API shape. A persisted fingerprint protects response-loss retries too.
    const submissionKey = clean(req.body?.requestId,120) || crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
    const previous = await pool.query('SELECT id,status,total_recipients,scheduled_at FROM email_campaigns WHERE submission_key=$1',[submissionKey]);
    if (previous.rowCount) { const old=previous.rows[0]; return res.json({ok:true,campaignId:old.id,status:old.status,total:old.total_recipients,scheduledAt:old.scheduled_at,reused:true}); }
    const subject = clean(req.body?.subject, 160);
    const message = normaliseMessageBody(req.body?.message);
    const ctaLabel = clean(req.body?.ctaLabel, 80);
    const ctaUrl = safeMessageUrl(req.body?.ctaUrl);
    const templateId = clean(req.body?.templateId, 80) || null;
    const attachmentPath = clean(req.body?.attachmentPath, 300);
    const rawSchedule = clean(req.body?.scheduledAt, 80);
    if (attachmentPath && (!attachmentPath.startsWith('/uploads/') || !fs.existsSync(path.join(uploadDir, path.basename(attachmentPath))))) return res.status(400).json({ error: 'المرفق غير صالح أو انتهت صلاحيته.' });
    if (!subject || !message) return res.status(400).json({ error: 'عنوان الرسالة ونصها مطلوبان.' });
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) return res.status(400).json({ error: 'اكتب نص الزر ورابطه معًا، أو اتركهما فارغين.' });
    let scheduledAt = null;
    if (rawSchedule) {
      const parsed = new Date(rawSchedule);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return res.status(400).json({ error: 'اختر موعدًا مستقبليًا للإرسال.' });
      scheduledAt = parsed.toISOString();
    }
    if (templateId) {
      const template = await pool.query('SELECT id FROM message_templates WHERE id=$1', [templateId]);
      if (!template.rowCount) return res.status(400).json({ error: 'القالب المختار لم يعد موجودًا.' });
    }
    let resolved;
    try { resolved = await resolveMessageRecipients(req.body || {}); }
    catch (error) { return res.status(400).json({ error: error.message || 'تعذر تحديد المستلمين.' }); }
    if (!resolved.recipients.length) return res.status(400).json({ error: resolved.skippedUnsubscribed ? 'كل العناوين المختارة ألغت اشتراكها سابقًا.' : 'لا يوجد مستلمون صالحون.' });
    const client = await pool.connect();
    let campaignId;
    try {
      await client.query('BEGIN');
      const campaign = await client.query(`INSERT INTO email_campaigns(subject,body,audience,template_id,cta_label,cta_url,attachment_path,status,scheduled_at,total_recipients,skipped_unsubscribed,course_name,submission_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(submission_key) WHERE submission_key<>'' DO NOTHING RETURNING id`, [subject, message, resolved.audience, templateId, ctaLabel, ctaUrl, attachmentPath, scheduledAt ? 'scheduled' : 'queued', scheduledAt, resolved.recipients.length, resolved.skippedUnsubscribed, resolved.courseName,submissionKey]);
      if (!campaign.rowCount) {
        const old=(await client.query('SELECT id,status,total_recipients,scheduled_at FROM email_campaigns WHERE submission_key=$1',[submissionKey])).rows[0];
        await client.query('COMMIT');
        return res.json({ok:true,campaignId:old.id,status:old.status,total:old.total_recipients,scheduledAt:old.scheduled_at,reused:true});
      }
      campaignId = campaign.rows[0].id;
      for (const person of resolved.recipients) await client.query("INSERT INTO email_deliveries(campaign_id,email,recipient_name,status) VALUES($1,$2,$3,'queued')", [campaignId, person.email, person.name]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (scheduledAt) return res.status(201).json({ ok: true, campaignId, status: 'scheduled', scheduledAt, total: resolved.recipients.length, skippedUnsubscribed: resolved.skippedUnsubscribed });
    res.status(202).json({ ok: true, campaignId, status: 'queued', total: resolved.recipients.length, skippedUnsubscribed: resolved.skippedUnsubscribed });
    void processScheduledMessageCampaigns();
  } catch (error) { next(error); }
});
app.get('/api/admin/campaigns', auth, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT c.id,c.subject,c.audience,c.status,c.scheduled_at,c.sent_at,c.created_at,c.total_recipients,c.skipped_unsubscribed,count(d.id)::int AS total,
      count(*) FILTER (WHERE d.delivered_at IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE d.status='opened' OR d.opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE d.status='clicked' OR d.clicked_at IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE d.status IN ('failed','bounced','complained'))::int AS failed,
      count(*) FILTER (WHERE d.resend_email_id<>'' OR d.status IN ('sent','delivered','opened','clicked'))::int AS sent,
      count(*) FILTER (WHERE d.status='queued')::int AS queued,
      count(*) FILTER (WHERE d.status='skipped')::int AS skipped
      FROM email_campaigns c LEFT JOIN email_deliveries d ON d.campaign_id=c.id
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`);
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.get('/api/admin/campaigns/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT email,recipient_name,status,delivered_at,opened_at,clicked_at,error,created_at FROM email_deliveries WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.post('/api/admin/campaigns/:id/cancel', auth, async (req, res, next) => {
  try {
    const campaign = await pool.query("UPDATE email_campaigns SET status='cancelled',sending_at=NULL WHERE id=$1 AND status='scheduled' RETURNING id", [req.params.id]);
    if (!campaign.rowCount) return res.status(400).json({ error: 'يمكن إلغاء الرسالة وهي في حالة الجدولة فقط.' });
    await pool.query("UPDATE email_deliveries SET status='cancelled',error='ألغيت جدولة الرسالة من لوحة الإدارة.' WHERE campaign_id=$1 AND status='queued'", [req.params.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get('/api/admin/export.csv', auth, async (_req, res, next) => { try { const result=await pool.query('SELECT reference,name,email,phone,course_name,certificate,total,payment_method,status,request_kind,organization,request_details,audience_size,preferred_timing,certificate_interest,created_at,receipt_path FROM registrations ORDER BY created_at DESC'); const blocked=await blockedEmails(pool,result.rows.map(r=>r.email)); const header=['رقم الطلب','الاسم','البريد الإلكتروني','الموبايل','الدورة','الشهادة','المبلغ','طريقة الدفع','الحالة','نوع الطلب','المؤسسة','تفاصيل الاحتياج','عدد المشاركين','الموعد المفضل','رغبة الشهادات','تاريخ التسجيل','وصل التحويل']; const quote=v=>'"'+String(v ?? '').replaceAll('"','""')+'"'; const csv='\ufeff'+[header,...result.rows.map(r=>[r.reference,r.name,blocked.has(normalizeEmail(r.email))?'':r.email,r.phone,r.course_name,r.certificate,r.total,r.payment_method,trainingPackageText(r.status),r.request_kind,r.organization,r.request_details,r.audience_size,r.preferred_timing,r.certificate_interest,r.created_at,r.receipt_path])].map(row=>row.map(quote).join(',')).join('\n'); res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="inexc-registrations.csv"'}).send(csv); } catch(error){next(error);} });
installLearnerService({app,pool,auth,uploadDir,sendEmail,emailShell,mailEnabled:!!resendApiKey});
installServiceCatalog({app,pool,auth,uploadDir});
app.use((error, _req, res, _next) => { console.error(error); if(error.constraint==='membership_orders_verified_payment_unique')return res.status(409).json({error:'رقم عملية الدفع هذا مستخدم في طلب آخر. راجع العملية قبل إصدار الباقة.'}); res.status(error instanceof multer.MulterError ? 400 : [400,401,403,404,409,429].includes(error.status) ? error.status : 500).json({ error: error.message || 'حدث خطأ في الخادم.' }); });

setupDatabase().then(() => setupServiceCatalog(pool)).then(() => setupLearnerService(pool)).then(() => setupStripePayments(pool)).then(() => setupCoursePaymentControls(pool)).then(() => setupMembershipPayments(pool)).then(() => { app.listen(port, () => console.log(`INEXC API listening on ${port}`)); void processCourseAlertQueue(); void processScheduledMessageCampaigns(); setInterval(() => { void processCourseAlertQueue(); void processScheduledMessageCampaigns(); }, 60 * 1000); }).catch(error => { console.error(error); process.exit(1); });

