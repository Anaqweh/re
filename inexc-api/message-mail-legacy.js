import { messageDocument, messageText, messageDirection, normaliseMessageBody, renderMessageBody, safeInlineLink } from './message-format-v4.js';
export const escapeMail = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (v,n) => String(v || '').trim().slice(0,n);
export function mailSettings(input = {}) {
  return {
    layout: ['branded','course','workshop','newsletter','thankyou','letter'].includes(input.layout)?input.layout:'branded',
    eyebrow:clean(input.eyebrow,80), headline:clean(input.headline,160), intro:clean(input.intro,320),
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
  const raw = [payload.subject, messageText(payload.message), payload.ctaLabel, payload.preheader, payload.headline, payload.intro, payload.eyebrow].join('\n');
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
  const document=messageDocument(body);
  const dir = ['rtl','ltr'].includes(document.direction)?document.direction:messageDirection(messageText(body)), english = dir === 'ltr';
  const variables = { name: person.name || config.fallbackName || (english ? 'friend' : 'صديقنا العزيز'), email: person.email || '', course: courseName || '' };
  const merge = v => String(v || '').replace(/\{\{(name|email|course)\}\}/g, (_, k) => variables[k]);
  const rendered = renderMessageBody(body, variables), align = rendered.direction === 'rtl' ? 'right' : 'left';
  const title = merge(subject), preview = merge(config.preheader) || rendered.text.slice(0,120);
  const signature = config.signatureEnabled ? config.signature || (english ? 'Kind regards,\nThe INEXC Training Team' : 'مع خالص التحية،\nفريق INEXC Training') : '';
  const url = safeInlineLink(merge(ctaUrl)), label = merge(ctaLabel);
  const action = label && /^https?:/.test(url) ? `<p style="margin:24px 0"><a href="${escapeMail(url)}" style="background:${config.brandColor};color:#ffffff;display:inline-block;padding:12px 24px;text-decoration:none;border-radius:6px">${escapeMail(label)}</a></p>` : '';
  const footer = unsubscribeUrl ? `<p style="font-size:12px;line-height:1.8;color:#596c7e;margin-top:28px"><a href="${escapeMail(unsubscribeUrl)}" style="color:#52677d">${english ? 'Unsubscribe from INEXC emails' : 'إلغاء الاشتراك في رسائل INEXC'}</a></p>` : '';
  const color=config.brandColor, plain=config.plain || config.layout==='letter';
  const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const onColor=(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2])>.179?'#102b46':'#ffffff';
  const brand=config.logoUrl?`<img src="${escapeMail(config.logoUrl)}" alt="INEXC Training" width="144" style="display:block;max-width:144px;height:auto;border:0">`:'<strong dir="ltr" style="font-size:20px;color:#153957">INEXC <span style="font-weight:400">TRAINING</span></strong>';
  const heading=plain?'':`<tr><td class="mail-pad" style="padding:26px 36px;border-top:5px solid ${color}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td>${brand}</td><td align="${align==='right'?'left':'right'}" style="font-size:11px;color:#607184">${english?'LEARN. APPLY. GROW.':'معرفة · تطبيق · أثر'}</td></tr></table></td></tr>`;
  const headline=escapeMail(merge(config.headline)||title),intro=escapeMail(merge(config.intro));
  const eyebrow=escapeMail(merge(config.eyebrow)||(english?'A NOTE FROM INEXC':'مساحة للتعلّم والتطوير'));
  let hero='';
  const heroText=`<div style="font-size:12px;font-weight:bold;margin:0 0 14px">${eyebrow}</div><h1 style="font-size:30px;line-height:1.55;margin:0;font-weight:700">${headline}</h1>${intro?`<p style="font-size:16px;line-height:1.9;margin:16px 0 0">${intro}</p>`:''}`;
  if(!plain){
    if(config.layout==='newsletter')hero=`<tr><td class="mail-pad" dir="${dir}" align="${align}" style="padding:12px 36px 30px;color:#153957;border-bottom:1px solid #dce6f0">${heroText}</td></tr>`;
    else if(config.layout==='thankyou')hero=`<tr><td class="mail-pad" dir="${dir}" align="center" style="padding:36px;background:#edf7f4;color:#124f4b;border-top:1px solid #d6ece5"><div style="font-size:32px;margin-bottom:12px;color:#176b5b">✦</div>${heroText}</td></tr>`;
    else if(config.layout==='workshop')hero=`<tr><td class="mail-pad" dir="${dir}" align="${align}" style="padding:32px 36px;background:#edf3fa;color:#163954;border-${align}:6px solid ${color}">${heroText}</td></tr>`;
    else hero=`<tr><td class="mail-pad" dir="${dir}" align="${align}" style="padding:36px;background:${config.layout==='course'?'#102e4c':color};color:${config.layout==='course'?'#ffffff':onColor}">${heroText}<table role="presentation" width="54" cellspacing="0" cellpadding="0" style="margin-top:24px"><tr><td height="4" bgcolor="#8fc7ed"></td></tr></table></td></tr>`;
  }
  const sign=signature?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:30px;border-top:1px solid #dfE7ef"><tr><td dir="${dir}" style="padding-top:22px;font-size:14px;line-height:1.9">${escapeMail(merge(signature)).replace(/\n/g,'<br>')}</td></tr></table>`:'';
  const html = `<!doctype html><html lang="${english ? 'en' : 'ar'}" dir="${rendered.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeMail(title)}</title><style>@media only screen and (max-width:600px){.mail-pad{padding:24px 20px!important}.mail-shell{width:100%!important}.mail-outer{padding:12px 6px!important}h1{font-size:26px!important}}a{overflow-wrap:anywhere}img{max-width:100%}</style></head><body dir="${dir}" style="margin:0;background:${plain ? '#fff' : '#edf2f7'};font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#17324d"><div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeMail(preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="mail-outer" align="center" style="padding:32px 12px"><!--[if mso]><table role="presentation" width="640"><tr><td><![endif]--><table class="mail-shell" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid ${plain?'#ffffff':'#dce5ee'}">${heading}${hero}<tr><td class="mail-pad" dir="${rendered.direction}" align="${align}" style="padding:32px 36px;direction:${rendered.direction};text-align:${align};font-size:16px;line-height:1.9">${rendered.html}${action.replace('color:#ffffff','color:'+onColor)}${sign}</td></tr>${plain?'':`<tr><td style="padding:20px 30px;background:#f6f8fb;text-align:center;font-size:12px;color:#536a80"><strong>INEXC Training</strong><br><a href="https://www.inexctraining.com" style="color:#194e80;text-decoration:none">inexctraining.com</a></td></tr>`}</table><!--[if mso]></td></tr></table><![endif]-->${footer}</td></tr></table></body></html>`;
  return { subject: title, html, text: [plain?'':merge(config.eyebrow),plain?'':merge(config.headline),plain?'':merge(config.intro),rendered.text, label && url ? `${label}: ${url}` : '', merge(signature), unsubscribeUrl ? `${english ? 'Unsubscribe' : 'إلغاء الاشتراك'}: ${unsubscribeUrl}` : ''].filter(Boolean).join('\n\n'), direction: rendered.direction };
}
