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

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const uploadDir = '/app/uploads';
const allowedOrigins = (process.env.PUBLIC_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
const sessions = new Map();
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
    if (!id || !timestamp || !signatures.some(signature => signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))) return res.status(401).json({ error: 'توقيع Webhook غير صالح.' });
    const event = JSON.parse(raw);
    const emailId = clean(event?.data?.email_id, 180);
    const type = clean(event?.type, 80);
    const statusMap = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed' };
    if (emailId && statusMap[type]) {
      await pool.query(`UPDATE email_deliveries SET status=$1,
        delivered_at=CASE WHEN $1='delivered' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
        opened_at=CASE WHEN $1='opened' AND opened_at IS NULL THEN now() ELSE opened_at END,
        clicked_at=CASE WHEN $1='clicked' AND clicked_at IS NULL THEN now() ELSE clicked_at END
        WHERE resend_email_id=$2`, [statusMap[type], emailId]);
    }
    res.json({ ok: true });
  } catch (error) { console.error('Resend webhook error:', error); res.status(400).json({ error: 'Webhook غير صالح.' }); }
});
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir, { maxAge: '1h', index: false }));

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
const messageAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `mail-${crypto.randomUUID()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const blocked = ['application/x-msdownload', 'application/x-sh', 'application/x-bat'];
    cb(blocked.includes(file.mimetype) ? new Error('لا يمكن إرسال ملفات تنفيذية أو غير آمنة بالبريد.') : null, !blocked.includes(file.mimetype));
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

function clean(value, max = 400) { return String(value ?? '').trim().slice(0, max); }
function asNumber(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : 0; }
function reference() { return `IX-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
function courseSlug(id) { return `course-${String(id).replaceAll('-', '').slice(0, 12)}`; }
function publicUrl(req, value) { return `${req.protocol}://${req.get('host')}${value}`; }
function courseAxes(value) { return String(value || '').split(/\r?\n/).map(item => item.replace(/^[\s•\-–—*\d.)]+/, '').trim()).filter(Boolean).slice(0, 20); }
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
function emailShell({ title, preview, content }) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#eef5fc;color:#17324d;font-family:Tahoma,Arial,sans-serif;line-height:1.8"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${preview}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef5fc;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 32px rgba(15,70,120,.12)"><tr><td style="background:linear-gradient(135deg,#0866c6,#063f86);padding:30px 34px;color:#ffffff"><div style="font-size:12px;letter-spacing:1.6px;font-weight:700;opacity:.82">INEXC TRAINING</div><div style="font-size:25px;font-weight:800;margin-top:7px">شركة التميز الابتكاري</div><div style="font-size:13px;margin-top:5px;opacity:.9">برامج تدريبية تصنع أثرًا حقيقيًا</div></td></tr><tr><td style="padding:32px 34px">${content}</td></tr><tr><td style="padding:20px 34px;background:#f7fbff;border-top:1px solid #dceafb;text-align:center;color:#6b8095;font-size:11px">هذه رسالة آلية من INEXC Training. يرجى عدم الرد عليها مباشرة.<br><span style="color:#0866c6;font-weight:700">inexctraining.com</span></td></tr></table></td></tr></table></body></html>`;
}
async function sendEmail({ to, subject, html, attachmentPath = '' }) {
  if (!resendApiKey || !to) return;
  const payload = { from: emailFrom, to: [to], subject, html };
  if (attachmentPath) {
    const fileName = path.basename(attachmentPath);
    const filePath = path.join(uploadDir, fileName);
    if (fs.existsSync(filePath)) payload.attachments = [{ filename: fileName.replace(/^mail-[a-f0-9-]+-/, ''), content: fs.readFileSync(filePath).toString('base64') }];
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Resend: ${await response.text()}`);
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
  const details = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dceafb;border-radius:12px;overflow:hidden;margin:22px 0;font-size:13px"><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;width:38%">رقم الطلب</td><td style="padding:11px 14px;font-weight:800;color:#0866c6;direction:ltr;text-align:right">${referenceNumber}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">الدورة</td><td style="padding:11px 14px;font-weight:700;border-top:1px solid #dceafb">${course}</td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">الحالة</td><td style="padding:11px 14px;border-top:1px solid #dceafb"><span style="display:inline-block;background:#fff4d9;color:#9b6500;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700">${status}</span></td></tr><tr><td style="padding:11px 14px;background:#f7fbff;color:#627b93;border-top:1px solid #dceafb">المبلغ</td><td style="padding:11px 14px;font-weight:800;border-top:1px solid #dceafb">${amount} د.إ</td></tr></table>`;
  const userHtml = emailShell({ title: 'تم استلام طلب تسجيلك', preview: `تم استلام طلبك في دورة ${course}`, content: `<div style="font-size:23px;font-weight:800;color:#103b70">تم استلام طلب تسجيلك ✓</div><p style="margin:13px 0 0;font-size:15px">مرحبًا <strong>${name}</strong>،</p><p style="margin:7px 0;color:#526c84;font-size:14px">شكرًا لثقتك بـ INEXC Training. تم تسجيل طلبك بنجاح، وستتم مراجعته والتواصل معك عند تأكيد التسجيل أو الدفع.</p>${details}<div style="background:#eaf6ff;border-right:4px solid #0866c6;border-radius:8px;padding:12px 14px;color:#315a79;font-size:12px">احتفظ برقم الطلب للرجوع إليه عند التواصل مع فريقنا.</div><p style="margin:25px 0 0;font-size:14px">مع خالص التحية،<br><strong style="color:#103b70">فريق INEXC Training</strong></p>` });
  const adminHtml = emailShell({ title: 'طلب تسجيل جديد', preview: `طلب جديد من ${name} في دورة ${course}`, content: `<div style="font-size:23px;font-weight:800;color:#103b70">طلب تسجيل جديد</div><p style="margin:10px 0 0;color:#526c84;font-size:14px">تم استلام طلب جديد عبر الموقع. هذه تفاصيله:</p>${details}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px"><tr><td style="padding:8px 0;color:#6a8096;width:30%">الاسم</td><td style="padding:8px 0;font-weight:700">${name}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">البريد</td><td style="padding:8px 0;border-top:1px solid #e5eef6;direction:ltr;text-align:right">${escapeHtml(registration.email)}</td></tr><tr><td style="padding:8px 0;color:#6a8096;border-top:1px solid #e5eef6">الموبايل</td><td style="padding:8px 0;border-top:1px solid #e5eef6;direction:ltr;text-align:right">${escapeHtml(registration.phone)}</td></tr></table><div style="margin-top:22px;text-align:center"><a href="https://www.inexctraining.com/admin-portal.html" style="display:inline-block;background:#0866c6;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:700">فتح لوحة الإدارة</a></div>` });
  void (async () => {
    try { await sendEmailWithRetry({ to: registration.email, subject: `تم استلام طلبك – ${registration.reference}`, html: userHtml }); }
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
    price NUMERIC(10,2) NOT NULL DEFAULT 0, certificate_mode TEXT NOT NULL DEFAULT 'included',
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
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS share_slug TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS image_path TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS certificate_sample_path TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS axes TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS outcomes TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS request_kind TEXT NOT NULL DEFAULT 'individual'");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS request_details TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS audience_size TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS preferred_timing TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS certificate_interest TEXT NOT NULL DEFAULT ''");
  await pool.query("UPDATE courses SET share_slug = 'course-' || replace(left(id::text, 12), '-', '') WHERE share_slug = ''");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS courses_share_slug_unique ON courses(share_slug)');
  await pool.query(`CREATE TABLE IF NOT EXISTS email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subject TEXT NOT NULL, body TEXT NOT NULL,
    audience TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
    email TEXT NOT NULL, recipient_name TEXT NOT NULL DEFAULT '', resend_email_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'sent', delivered_at TIMESTAMPTZ, opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ,
    error TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_resend_id_unique ON email_deliveries(resend_email_id) WHERE resend_email_id <> \'\'');
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
    location: row.location, category: row.category, price: Number(row.price),
    certificate: { mode: row.certificate_mode, name: row.certificate_name, price: Number(row.certificate_price) },
    payments: row.payment_methods, paymentLink: row.payment_link,
    bank: { title: bankParts?.[1] || '', name: bankParts?.[2] === '—' ? '' : (bankParts?.[2] || savedBankName), account: row.bank_account, iban: row.bank_iban },
    imageUrl: row.image_path || '', certificateSampleUrl: row.certificate_sample_path || '',
    shareSlug: row.share_slug || courseSlug(row.id), shareUrl: `https://courses.inexctraining.com/${row.share_slug || courseSlug(row.id)}`,
    active: row.active
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'INEXC Training API' }));
app.get('/api/settings', async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key='brand_logo'");
    res.json({ logoUrl: result.rows[0]?.value || '' });
  } catch (error) { next(error); }
});
app.get('/api/courses', async (_req, res, next) => {
  try { const result = await pool.query('SELECT * FROM courses WHERE active = true ORDER BY created_at DESC'); res.json(result.rows.map(publicCourse)); } catch (error) { next(error); }
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
      { label: 'عن الدورة', html: `<section class="panel intro"><span class="tag">${escapeHtml(course.category || 'دورة تدريبية')}</span><h1>${escapeHtml(course.name)}</h1><div class="rich">${publicRichText(course.description)}</div><div class="facts"><span>📅 ${escapeHtml(course.date || 'سيُعلن قريبًا')}</span><span>📍 ${escapeHtml(course.location || 'عن بُعد / حضوري')}</span><span>💳 ${course.price === 0 ? 'مجاني' : `${course.price.toLocaleString('ar-AE')} د.إ`}</span></div></section>` },
      ...(axisGroups.length ? [{ label: 'محاور الدورة', html: `<section class="panel"><h2>محاور الدورة</h2><p class="lead">اضغط على أي محور رئيسي لعرض النقاط التي يتضمنها.</p>${axisGroups.map((axis, index) => `<details class="axis" style="padding:0;overflow:hidden"><summary style="list-style:none;display:flex;align-items:center;gap:10px;padding:16px;cursor:pointer"><i>${['١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'][index] || index + 1}</i><span>${publicInlineText(axis.title)}</span><b style="margin-right:auto;display:block">⌄</b></summary>${axis.points.length ? `<ul style="margin:0;padding:0 45px 17px 18px;color:#46627c;line-height:2;font-size:13px">${axis.points.map(point => `<li>${publicInlineText(point)}</li>`).join('')}</ul>` : '<p style="margin:0;padding:0 50px 17px;color:#60788f;font-size:13px">تفاصيل هذا المحور ستُناقش ضمن جلسات الدورة.</p>'}</details>`).join('')}</section>` }] : []),
      ...(course.outcomes.length ? [{ label: 'مخرجات الدورة', html: `<section class="panel"><h2>ماذا ستخرج به بعد الدورة؟</h2><p class="lead">مخرجات تساعدك على تحويل ما تتعلمه إلى أثر عملي.</p>${course.outcomes.map(outcome => `<article class="outcome">${publicInlineText(outcome)}</article>`).join('')}</section>` }] : []),
      { label: 'السعر', html: `<section class="panel"><h2>السعر وخيارات الشهادة</h2><div class="price" style="border:1px solid #d9eafb;background:#f7fbff;border-radius:18px;padding:22px"><span style="display:inline-grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#eaf4ff;font-size:21px">💳</span><b style="display:block;font-size:30px;color:#0866c6;margin:16px 0 7px">${course.price === 0 ? 'مجاني' : `${course.price.toLocaleString('ar-AE')} د.إ`}</b><p style="margin:0;color:#5c748c;font-size:13px;line-height:2">${escapeHtml(certificateNote)}</p></div></section>` },
      { label: 'التسجيل', html: `<section class="panel"><div class="register"><h2>جاهز للبدء؟</h2><p>أرسل طلبك الآن، وسيتواصل معك فريق INEXC لاستكمال التسجيل.</p><a href="${register}">سجّل في هذه الدورة ←</a></div></section>` }
    ];
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(course.name)} | INEXC Training</title><meta name="description" content="${escapeHtml(course.description.slice(0, 155))}"><meta property="og:type" content="website"><meta property="og:site_name" content="INEXC Training"><meta property="og:title" content="${escapeHtml(course.name)}"><meta property="og:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(course.name)}"><meta name="twitter:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta name="twitter:image" content="${escapeHtml(image)}"><style>:root{--b:#0866c6;--d:#103b70;--p:#f3f8ff;--m:#62788f}*{box-sizing:border-box}body{margin:0;background:var(--p);font-family:Arial,sans-serif;color:#19314b}.wrap{width:min(900px,calc(100% - 32px));margin:34px auto}.back{display:inline-block;color:var(--b);font-weight:bold;text-decoration:none;font-size:13px;margin:0 0 14px}.card{overflow:hidden;background:#fff;border:1px solid #dcecff;border-radius:24px;box-shadow:0 20px 50px #07539814}.cover{display:block;width:100%;height:330px;object-fit:cover;background:#0b4d90}.content{padding:30px 36px 36px}.tag{display:inline-block;background:#eaf4ff;color:var(--b);padding:6px 11px;border-radius:20px;font-size:12px;font-weight:bold}.intro h1{color:var(--d);font-size:30px;line-height:1.55;margin:15px 0 8px}.rich p{line-height:2;color:var(--m);font-size:15px;margin:0 0 11px}.rich strong,.axis strong,.outcome strong{color:#0d477e;font-weight:800}.rich-heading{color:#0b5cac;font-size:17px;margin:17px 0 7px}.facts{display:flex;gap:9px;flex-wrap:wrap;margin:21px 0}.facts span{padding:8px 10px;background:#f8fbff;border:1px solid #e0edf9;border-radius:10px;font-size:12px;color:#4d6d8a}.journey{border-top:1px solid #e6f0fa;padding-top:20px}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:23px}.step{border:1px solid #dceafb;background:#fff;color:#6b8195;border-radius:10px;padding:10px 8px;font:700 11px Arial;cursor:pointer}.step.active{background:var(--b);border-color:var(--b);color:#fff}.step.done{color:var(--b);border-color:#abd7ff}.panel{display:none}.panel.active{display:block}.panel h2{color:var(--d);font-size:22px;margin:0 0 12px}.lead{font-size:14px;line-height:2;color:var(--m);margin:0 0 18px}.axis{padding:15px 16px;margin:9px 0;background:#f7fbff;border:1px solid #dceafb;border-radius:14px;line-height:1.9;color:#46627c;font-size:14px}.axis b{display:flex;gap:9px;align-items:flex-start;color:#0d477e}.axis i{font-style:normal;color:#fff;background:var(--b);width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;flex:0 0 auto}.outcome{padding:14px 15px;margin:9px 0;border-right:4px solid #18a878;background:#f4fcf8;border-radius:10px;color:#42657d;line-height:1.9;font-size:14px}.register{padding:24px;border-radius:18px;background:linear-gradient(135deg,#063f86,#0866c6);color:#fff}.register h2{color:#fff;margin:0 0 8px}.register p{color:#e7f3ff;line-height:2;margin:0 0 18px;font-size:14px}.register a{display:inline-block;text-decoration:none;background:#fff;color:#0866c6;padding:13px 19px;border-radius:10px;font-weight:bold;font-size:14px}.controls{display:flex;justify-content:space-between;gap:10px;margin-top:25px}.controls button{border:0;border-radius:10px;padding:11px 16px;font-weight:bold;cursor:pointer}.previous{background:#eef6ff;color:var(--b)}.next{background:var(--b);color:#fff}@media(max-width:600px){.wrap{width:calc(100% - 20px);margin:18px auto}.card{border-radius:18px}.cover{height:210px}.content{padding:22px 17px 24px}.intro h1{font-size:24px}.steps{grid-template-columns:1fr 1fr}.step{font-size:10px}.axis,.outcome,.rich p{font-size:13px}.controls{position:sticky;bottom:8px;background:#ffffffed;padding-top:10px}.controls button{flex:1}}</style></head><body><main class="wrap"><a class="back" href="https://www.inexctraining.com/">← العودة إلى الدورات</a><article class="card"><img class="cover" src="${escapeHtml(image)}" alt="${escapeHtml(course.name)}"><div class="content"><div class="journey"><div class="steps">${panels.map((panel,index) => `<button class="step" type="button">${index + 1}. ${panel.label}</button>`).join('')}</div>${panels.map(panel => panel.html).join('')}<div class="controls"><button class="previous" type="button">السابق</button><button class="next" type="button">التالي ←</button></div></div></div></article></main><script>const panels=[...document.querySelectorAll('.panel')],steps=[...document.querySelectorAll('.step')],previous=document.querySelector('.previous'),next=document.querySelector('.next');let current=0;function paint(index){current=Math.max(0,Math.min(index,panels.length-1));panels.forEach((panel,i)=>panel.classList.toggle('active',i===current));steps.forEach((step,i)=>{step.classList.toggle('active',i===current);step.classList.toggle('done',i<current)});previous.hidden=current===0;next.hidden=current===panels.length-1;document.querySelector('.journey').scrollIntoView({behavior:'smooth',block:'start'})}steps.forEach((step,index)=>step.onclick=()=>paint(index));previous.onclick=()=>paint(current-1);next.onclick=()=>paint(current+1);paint(0);</script></body></html>`);
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
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(course.name)} | INEXC Training</title><meta name="description" content="${escapeHtml(course.description.slice(0, 155))}"><meta property="og:type" content="website"><meta property="og:site_name" content="INEXC Training"><meta property="og:title" content="${escapeHtml(course.name)}"><meta property="og:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(course.name)}"><meta name="twitter:description" content="${escapeHtml(course.description.slice(0, 180))}"><meta name="twitter:image" content="${escapeHtml(image)}"><style>:root{--blue:#0866c6;--dark:#103b70;--pale:#f1f7fd;--muted:#60788f}*{box-sizing:border-box}body{margin:0;background:var(--pale);color:#17324d;font-family:Arial,sans-serif;line-height:1.9}.wrap{width:min(880px,calc(100% - 32px));margin:42px auto}.card{overflow:hidden;background:#fff;border:1px solid #dceafb;border-radius:24px;box-shadow:0 24px 60px #07539818}.cover{display:block;width:100%;height:365px;object-fit:cover;background:#0a4d92}.content{padding:34px 38px 38px}.tag{display:inline-block;padding:6px 12px;color:#0866c6;background:#eaf4ff;border-radius:20px;font-size:12px;font-weight:bold}h1{font-size:31px;color:var(--dark);line-height:1.55;margin:18px 0 8px}.description{margin:0;color:#516d86;font-size:15px}.facts{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.fact{padding:8px 11px;background:#f7fbff;border:1px solid #e0eefb;border-radius:10px;color:#4b6e8c;font-size:12px}.axes,.outcomes{margin:24px 0 0;padding:19px 20px;border-radius:16px}.axes{background:#f5faff;border:1px solid #dbeafb}.outcomes{background:#f7fbff;border:1px solid #d7eafd}.axes h2,.outcomes h2{margin:0 0 8px;color:#103b70;font-size:19px}.axes ul{margin:0;padding-right:21px}.axes li{margin:5px 0;font-size:14px;color:#456783}.outcomes p{margin:9px 0;color:#385f81;font-size:14px}.outcomes b{display:inline-grid;place-items:center;width:23px;height:23px;margin-left:8px;border-radius:50%;background:#0866c6;color:#fff;font-size:11px}.actions{display:flex;align-items:center;gap:10px;margin-top:25px}.button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:var(--blue);color:#fff;padding:13px 21px;border-radius:11px;font-size:14px;font-weight:bold;box-shadow:0 10px 20px #0866c62b}.secondary{display:inline-flex;align-items:center;text-decoration:none;color:#0866c6;padding:13px 12px;font-size:13px;font-weight:bold}@media(max-width:560px){.wrap{width:calc(100% - 20px);margin:18px auto}.card{border-radius:18px}.cover{height:205px}.content{padding:22px 18px 25px}h1{font-size:24px;margin-top:14px}.description{font-size:13px}.facts{gap:7px;margin:16px 0}.fact{font-size:11px;padding:7px 9px}.axes,.outcomes{margin-top:18px;padding:15px}.axes h2,.outcomes h2{font-size:17px}.axes li,.outcomes p{font-size:13px}.actions{align-items:stretch;flex-direction:column}.button,.secondary{width:100%;justify-content:center}}</style></head><body><main class="wrap"><article class="card">${course.imageUrl ? `<img class="cover" src="${escapeHtml(publicUrl(req, course.imageUrl))}" alt="${escapeHtml(course.name)}">` : `<img class="cover" src="${fallback}" alt="INEXC Training">`}<div class="content"><span class="tag">${escapeHtml(course.category)}</span><h1>${escapeHtml(course.name)}</h1><p class="description">${escapeHtml(course.description)}</p><div class="facts"><span class="fact">📅 ${escapeHtml(course.date || 'سيُعلن قريبًا')}</span><span class="fact">📍 ${escapeHtml(course.location || 'عن بُعد / حضوري')}</span><span class="fact">💳 ${course.price === 0 ? 'مجاني' : `${course.price.toLocaleString('ar-AE')} د.إ`}</span></div>${axes}${outcomes}<div class="actions"><a class="button" href="${registrationUrl}">سجّل في الدورة</a>${sample}</div></div></article></main></body></html>`);
  } catch (error) { next(error); }
});
app.get('/api/sitemap.xml', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT id,updated_at FROM courses WHERE active = true ORDER BY updated_at DESC');
    const urls = result.rows.map(row => '<url><loc>https://www.inexctraining.com/course.html?id=' + row.id + '</loc><lastmod>' + row.updated_at.toISOString().slice(0, 10) + '</lastmod></url>').join('');
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.inexctraining.com/</loc></url><url><loc>https://www.inexctraining.com/register.html</loc></url>' + urls + '</urlset>');
  } catch (error) { next(error); }
});
app.post('/api/registrations', upload.single('receipt'), async (req, res, next) => {
  try {
    const courseId = clean(req.body.course_id, 80);
    const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1 AND active = true', [courseId]);
    if (!courseResult.rowCount) return res.status(400).json({ error: 'الدورة غير متاحة للتسجيل.' });
    const course = courseResult.rows[0];
    const name = clean(req.body.name, 150), email = clean(req.body.email, 180), phone = clean(req.body.phone, 50);
    if (!name || !email || !phone) return res.status(400).json({ error: 'يرجى إدخال الاسم والبريد الإلكتروني ورقم الموبايل.' });
    const certificateRequested = clean(req.body.certificate) === 'yes';
    const certificate = course.certificate_mode === 'none' ? 'لا' : (course.certificate_mode === 'included' || certificateRequested ? course.certificate_name : 'لا');
    const total = Number(course.price) + (course.certificate_mode === 'optional' && certificateRequested ? Number(course.certificate_price) : 0);
    const paymentMethod = total === 0 ? 'free' : clean(req.body.payment_method, 20);
    if (paymentMethod === 'link') return res.status(400).json({ error: 'الدفع عبر الرابط غير مفعّل حاليًا. يرجى اختيار التحويل البنكي وإرفاق الوصل.' });
    if (total > 0 && paymentMethod !== 'bank') return res.status(400).json({ error: 'يرجى اختيار التحويل البنكي وإرفاق الوصل.' });
    if (paymentMethod === 'bank' && !req.file) return res.status(400).json({ error: 'يرجى إرفاق وصل التحويل البنكي.' });
    const status = paymentMethod === 'bank' ? 'بانتظار مراجعة الوصل' : total > 0 ? 'بانتظار الدفع' : 'مسجل';
    const registrationReference = reference();
    const receiptPath = req.file ? `/uploads/${req.file.filename}` : '';
    await pool.query(`INSERT INTO registrations (reference,name,email,phone,course_id,course_name,certificate,total,payment_method,status,receipt_path)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [registrationReference,name,email,phone,course.id,course.name,certificate,total,paymentMethod,status,receiptPath]);
    sendRegistrationEmails({ reference: registrationReference, name, email, phone, courseName: course.name, total, status });
    res.status(201).json({ ok: true, reference: registrationReference, paymentLink: paymentMethod === 'link' ? course.payment_link : '' });
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

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body?.password || '').slice(0, 256);
  const expected = String(process.env.ADMIN_PASSWORD).slice(0, 256);
  const passwordHash = crypto.createHash('sha256').update(password).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(passwordHash, expectedHash)) return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
  pruneSessions(); const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
  res.json({ token, expiresIn: 28800 });
});
app.post('/api/admin/logout', auth, (req, res) => { sessions.delete(String(req.headers.authorization).replace(/^Bearer\s+/i, '')); res.json({ ok: true }); });
app.get('/api/admin/settings', auth, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key='brand_logo'");
    res.json({ logoUrl: result.rows[0]?.value || '' });
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
app.get('/api/admin/courses', auth, async (_req, res, next) => { try { const result = await pool.query('SELECT * FROM courses ORDER BY active DESC, created_at DESC'); res.json(result.rows.map(publicCourse)); } catch (error) { next(error); } });
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
    const c = req.body || {}; const methods = Array.isArray(c.payments) ? c.payments.filter(v => ['link','bank'].includes(v)) : [];
    if (!clean(c.name, 180)) return res.status(400).json({ error: 'اسم الدورة مطلوب.' });
    const values = [clean(c.name,180),clean(c.description,1000),courseAxes(c.axes).join('\n'),courseOutcomes(c.outcomes).join('\n'),clean(c.trainer,180),clean(c.date,80),clean(c.location,160),clean(c.category,100),asNumber(c.price),clean(c.certificate?.mode,20)||'included',clean(c.certificate?.name,180),asNumber(c.certificate?.price),methods.length?methods:['bank'],clean(c.paymentLink,500),clean(c.bank?.name,200),clean(c.bank?.account,200),clean(c.bank?.iban,200),c.active !== false];
    const result = await pool.query(`INSERT INTO courses (name,description,axes,outcomes,trainer,course_date,location,category,price,certificate_mode,certificate_name,certificate_price,payment_methods,payment_link,bank_name,bank_account,bank_iban,active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, values);
    let saved = result.rows[0];
    if (!saved.share_slug) saved = (await pool.query('UPDATE courses SET share_slug=$1 WHERE id=$2 RETURNING *', [courseSlug(saved.id), saved.id])).rows[0];
    res.status(201).json(publicCourse(saved));
  } catch (error) { next(error); }
});
app.put('/api/admin/courses/:id', auth, async (req, res, next) => {
  try {
    const c = req.body || {}; const methods = Array.isArray(c.payments) ? c.payments.filter(v => ['link','bank'].includes(v)) : [];
    const values = [clean(c.name,180),clean(c.description,1000),courseAxes(c.axes).join('\n'),courseOutcomes(c.outcomes).join('\n'),clean(c.trainer,180),clean(c.date,80),clean(c.location,160),clean(c.category,100),asNumber(c.price),clean(c.certificate?.mode,20)||'included',clean(c.certificate?.name,180),asNumber(c.certificate?.price),methods.length?methods:['bank'],clean(c.paymentLink,500),clean(c.bank?.name,200),clean(c.bank?.account,200),clean(c.bank?.iban,200),c.active !== false, req.params.id];
    const result = await pool.query(`UPDATE courses SET name=$1,description=$2,axes=$3,outcomes=$4,trainer=$5,course_date=$6,location=$7,category=$8,price=$9,certificate_mode=$10,certificate_name=$11,certificate_price=$12,payment_methods=$13,payment_link=$14,bank_name=$15,bank_account=$16,bank_iban=$17,active=$18,updated_at=now() WHERE id=$19 RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    let saved = result.rows[0];
    if (!saved.share_slug) saved = (await pool.query('UPDATE courses SET share_slug=$1 WHERE id=$2 RETURNING *', [courseSlug(saved.id), saved.id])).rows[0];
    res.json(publicCourse(saved));
  } catch (error) { next(error); }
});
app.delete('/api/admin/courses/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM courses WHERE id=$1 RETURNING name', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'الدورة غير موجودة.' });
    res.json({ ok: true, name: result.rows[0].name });
  } catch (error) { next(error); }
});
app.get('/api/admin/registrations', auth, async (_req, res, next) => { try { const result = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC'); res.json(result.rows.map(r => ({...r,total:Number(r.total)}))); } catch (error) { next(error); } });
app.put('/api/admin/registrations/:id/status', auth, async (req, res, next) => { try { const status = clean(req.body?.status,80); const allowed=['بانتظار الدفع','بانتظار مراجعة الوصل','مدفوع','مؤكد','ملغى','مسجل','طلب مؤسسة جديد','قيد التواصل']; if(!allowed.includes(status)) return res.status(400).json({error:'حالة غير صالحة.'}); await pool.query('UPDATE registrations SET status=$1,updated_at=now() WHERE id=$2',[status,req.params.id]); res.json({ok:true}); } catch(error){next(error);} });
app.delete('/api/admin/registrations/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM registrations WHERE id=$1 RETURNING receipt_path', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'طلب التسجيل غير موجود.' });
    const receipt = result.rows[0].receipt_path;
    if (receipt) fs.unlink(path.join(uploadDir, path.basename(receipt)), () => {});
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post('/api/admin/message-attachments', auth, messageAttachmentUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'اختر ملفًا لإرفاقه.' });
  res.status(201).json({ ok: true, attachmentPath: `/uploads/${req.file.filename}`, fileName: req.file.originalname });
});
app.post('/api/admin/messages', auth, async (req, res, next) => {
  try {
    if (!resendApiKey) return res.status(503).json({ error: 'خدمة البريد غير مهيأة حاليًا.' });
    const subject = clean(req.body?.subject, 160);
    const message = clean(req.body?.message, 5000);
    const audience = clean(req.body?.audience, 20);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(v => clean(v, 80)).filter(Boolean).slice(0, 500) : [];
    const courseId = clean(req.body?.courseId, 80);
    const attachmentPath = clean(req.body?.attachmentPath, 300);
    if (attachmentPath && (!attachmentPath.startsWith('/uploads/') || !fs.existsSync(path.join(uploadDir, path.basename(attachmentPath))))) return res.status(400).json({ error: 'المرفق غير صالح أو انتهت صلاحيته.' });
    const extraEmails = String(req.body?.extraEmails || '').replaceAll(String.fromCharCode(10), ',').split(/[,; ]+/)
      .map(value => clean(value, 180).toLowerCase()).filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).slice(0, 500);
    if (!subject || !message) return res.status(400).json({ error: 'عنوان الرسالة ونصها مطلوبان.' });
    if (!['all', 'selected', 'course', 'unpaid', 'custom'].includes(audience)) return res.status(400).json({ error: 'اختر شريحة المستلمين.' });
    if (audience === 'selected' && !ids.length && !extraEmails.length) return res.status(400).json({ error: 'اختر شخصًا واحدًا على الأقل أو أضف بريدًا خارجيًا.' });
    if (audience === 'course' && !courseId) return res.status(400).json({ error: 'اختر الدورة المطلوبة.' });
    if (audience === 'custom' && !extraEmails.length) return res.status(400).json({ error: 'أضف بريدًا إلكترونيًا صالحًا واحدًا على الأقل.' });
    let registeredRecipients = [];
    if (audience === 'all') registeredRecipients = (await pool.query('SELECT DISTINCT email,name FROM registrations WHERE email <> \'\' ORDER BY email LIMIT 500')).rows;
    else if (audience === 'selected') registeredRecipients = (await pool.query('SELECT DISTINCT email,name FROM registrations WHERE id = ANY($1::uuid[]) AND email <> \'\' ORDER BY email', [ids])).rows;
    else if (audience === 'course') registeredRecipients = (await pool.query('SELECT DISTINCT email,name FROM registrations WHERE course_id=$1 AND email <> \'\' ORDER BY email LIMIT 500', [courseId])).rows;
    else if (audience === 'unpaid') registeredRecipients = (await pool.query(`SELECT DISTINCT email,name FROM registrations WHERE total > 0 AND status NOT IN ('مدفوع','مؤكد') AND email <> '' ORDER BY email LIMIT 500`)).rows;
    const seen = new Set();
    const recipients = [...registeredRecipients, ...extraEmails.map(email => ({ email, name: '' }))].filter(person => {
      const key = person.email.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 500);
    if (!recipients.length) return res.status(400).json({ error: 'لا يوجد مستلمون صالحون.' });
    const body = escapeHtml(message).replace(/\n/g, '<br>');
    const campaign = await pool.query('INSERT INTO email_campaigns(subject,body,audience) VALUES($1,$2,$3) RETURNING id', [subject, message, audience]);
    const campaignId = campaign.rows[0].id;
    const results = await Promise.all(recipients.map(async person => {
      try {
        const sent = await sendEmail({
          to: person.email, subject, attachmentPath,
          html: emailShell({ title: subject, preview: message.slice(0, 120), content: `<div style="font-size:23px;font-weight:800;color:#103b70">${escapeHtml(subject)}</div><p style="margin:18px 0 0;font-size:14px;color:#304d67">مرحبًا <strong>${escapeHtml(person.name || '')}</strong>،</p><p style="margin:12px 0 0;font-size:14px;color:#304d67">${body}</p><p style="margin:26px 0 0;font-size:14px">مع خالص التحية،<br><strong style="color:#103b70">فريق INEXC Training</strong></p>` })
        });
        await pool.query('INSERT INTO email_deliveries(campaign_id,email,recipient_name,resend_email_id,status) VALUES($1,$2,$3,$4,$5)', [campaignId, person.email, person.name || '', clean(sent?.id, 180), 'sent']);
        return { ok: true };
      } catch (error) {
        await pool.query('INSERT INTO email_deliveries(campaign_id,email,recipient_name,status,error) VALUES($1,$2,$3,$4,$5)', [campaignId, person.email, person.name || '', 'failed', clean(error.message, 500)]);
        console.error('Bulk email error:', error);
        return { ok: false };
      }
    }));
    const sent = results.filter(r => r.ok).length;
    res.json({ ok: true, campaignId, sent, failed: results.length - sent, total: recipients.length });
  } catch (error) { next(error); }
});
app.get('/api/admin/campaigns', auth, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT c.id,c.subject,c.audience,c.created_at,count(d.id)::int AS total,
      count(*) FILTER (WHERE d.status='delivered')::int AS delivered,
      count(*) FILTER (WHERE d.status='opened' OR d.opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE d.status='clicked' OR d.clicked_at IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE d.status IN ('failed','bounced','complained'))::int AS failed
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
app.get('/api/admin/export.csv', auth, async (_req, res, next) => { try { const result=await pool.query('SELECT reference,name,email,phone,course_name,certificate,total,payment_method,status,request_kind,organization,request_details,audience_size,preferred_timing,certificate_interest,created_at,receipt_path FROM registrations ORDER BY created_at DESC'); const header=['رقم الطلب','الاسم','البريد الإلكتروني','الموبايل','الدورة','الشهادة','المبلغ','طريقة الدفع','الحالة','نوع الطلب','المؤسسة','تفاصيل الاحتياج','عدد المشاركين','الموعد المفضل','رغبة الشهادات','تاريخ التسجيل','وصل التحويل']; const quote=v=>'"'+String(v ?? '').replaceAll('"','""')+'"'; const csv='\ufeff'+[header,...result.rows.map(r=>[r.reference,r.name,r.email,r.phone,r.course_name,r.certificate,r.total,r.payment_method,r.status,r.request_kind,r.organization,r.request_details,r.audience_size,r.preferred_timing,r.certificate_interest,r.created_at,r.receipt_path])].map(row=>row.map(quote).join(',')).join('\n'); res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="inexc-registrations.csv"'}).send(csv); } catch(error){next(error);} });
app.use((error, _req, res, _next) => { console.error(error); res.status(error instanceof multer.MulterError ? 400 : 500).json({ error: error.message || 'حدث خطأ في الخادم.' }); });

setupDatabase().then(() => app.listen(port, () => console.log(`INEXC API listening on ${port}`))).catch(error => { console.error(error); process.exit(1); });
