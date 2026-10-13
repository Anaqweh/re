import { messageDocument, messageText, messageDirection, normaliseMessageBody, renderMessageBody, safeInlineLink } from './message-format.js';
export const escapeMail = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (v,n) => String(v || '').trim().slice(0,n);
export function mailSettings(input = {}) {
  return {
    preheader: clean(input.preheader,180), fallbackName: clean(input.fallbackName,100),
    logoUrl: /^https:\/\//.test(safeInlineLink(input.logoUrl)) ? safeInlineLink(input.logoUrl) : '',
    brandColor: /^#[a-f0-9]{6}$/i.test(input.brandColor) ? input.brandColor : '#0866c6',
    signature: clean(input.signature,600), signatureEnabled: input.signatureEnabled !== false, plain: input.plain === true,
  };
}
export function checkMessage(payload, { course = '' } = {}) {
  const issues = [];
  if (!clean(payload.subject,160)) issues.push('اكتب عنوان الرسالة.');
  if (!normaliseMessageBody(payload.message)) issues.push('اكتب نص الرسالة.');
  if (!!payload.ctaLabel !== !!payload.ctaUrl || (payload.ctaUrl && !/^https?:/.test(safeInlineLink(payload.ctaUrl)))) issues.push('أكمل نص زر الدعوة ورابطه الصحيح.');
  const raw = [payload.subject, messageText(payload.message), payload.ctaLabel, payload.preheader].join('\n');
  for (const token of new Set(raw.match(/\{\{[^}]+\}\}/g) || [])) {
    if (!['{{name}}','{{email}}','{{course}}'].includes(token)) issues.push(`متغير غير معروف: ${token}`);
    if (token === '{{course}}' && !course) issues.push('اختر دورة أو استبدل متغير اسم الدورة بنص.');
  }
  for (const block of messageDocument(payload.message).blocks) {
    if (block.type === 'image' && (!block.src || !block.alt)) issues.push('أكمل رابط الصورة HTTPS ونصها البديل.');
    if (block.type === 'button' && (!/^https?:/.test(block.href || '') || !block.runs.some(r => r.text.trim()))) issues.push('أكمل نص زر المحتوى ورابطه.');
  }
  if (/(?:https?:\/\/(?:\s|$)|https?:\/\/\.{2,}|\bwww\.\s)/i.test(raw)) issues.push('توجد روابط غير مكتملة في النص.');
  return [...new Set(issues)];
}
// This same function powers authenticated preview, plain-text export and actual delivery.
export function renderMail({ subject, body, ctaLabel = '', ctaUrl = '', person = {}, courseName = '', settings = {}, unsubscribeUrl = '' }) {
  const config = mailSettings(settings);
  const dir = messageDirection(messageText(body)), english = dir === 'ltr';
  const variables = { name: person.name || config.fallbackName || (english ? 'friend' : 'صديقنا العزيز'), email: person.email || '', course: courseName || '' };
  const merge = v => String(v || '').replace(/\{\{(name|email|course)\}\}/g, (_, k) => variables[k]);
  const rendered = renderMessageBody(body, variables), align = rendered.direction === 'rtl' ? 'right' : 'left';
  const title = merge(subject), preview = merge(config.preheader) || rendered.text.slice(0,120);
  const signature = config.signatureEnabled ? config.signature || (english ? 'Kind regards,\nThe INEXC Training Team' : 'مع خالص التحية،\nفريق INEXC Training') : '';
  const url = safeInlineLink(merge(ctaUrl)), label = merge(ctaLabel);
  const action = label && /^https?:/.test(url) ? `<p style="margin:24px 0"><a href="${escapeMail(url)}" style="background:${config.brandColor};color:#ffffff;display:inline-block;padding:12px 24px;text-decoration:none;border-radius:6px">${escapeMail(label)}</a></p>` : '';
  const footer = unsubscribeUrl ? `<p style="font-size:12px;line-height:1.8;color:#596c7e;margin-top:28px"><a href="${escapeMail(unsubscribeUrl)}" style="color:#52677d">${english ? 'Unsubscribe from INEXC emails' : 'إلغاء الاشتراك في رسائل INEXC'}</a></p>` : '';
  const heading = config.plain ? '' : `<tr><td style="padding:22px 28px;border-bottom:3px solid ${config.brandColor}">${config.logoUrl ? `<img src="${escapeMail(config.logoUrl)}" alt="INEXC Training" width="150" style="max-width:150px;height:auto;border:0">` : `<strong dir="ltr" style="color:${config.brandColor};font-size:20px">INEXC Training</strong>`}</td></tr>`;
  const html = `<!doctype html><html lang="${english ? 'en' : 'ar'}" dir="${rendered.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMail(title)}</title></head><body style="margin:0;background:${config.plain ? '#fff' : '#f4f7fb'};font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#17324d"><div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeMail(preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff">${heading}<tr><td dir="${rendered.direction}" align="${align}" style="padding:28px;direction:${rendered.direction};text-align:${align};font-size:16px;line-height:1.9">${rendered.html}${action}<p dir="auto" style="white-space:pre-wrap;margin-top:24px">${escapeMail(merge(signature)).replace(/\n/g,'<br>')}</p>${footer}</td></tr></table></td></tr></table></body></html>`;
  return { subject: title, html, text: [rendered.text, label && url ? `${label}: ${url}` : '', merge(signature), unsubscribeUrl ? `${english ? 'Unsubscribe' : 'إلغاء الاشتراك'}: ${unsubscribeUrl}` : ''].filter(Boolean).join('\n\n'), direction: rendered.direction };
}
