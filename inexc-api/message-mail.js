import {subscriptionUrl} from './message-subscription-links.js';
import {mailSettings as version4Settings,renderMail as renderVersion4} from './message-mail-v4.js';
import {fontStack,fontCSS,fontById,buttonSettings,buttonHref,renderButton,safeButtonHref} from './message-design.js';
import { messageDocument, messageText, messageDirection, renderMessageBody, safeInlineLink } from './message-format.js';
import { renderMail as renderLegacyMail, mailSettings as legacySettings, checkMessage as legacyCheck, escapeMail } from './message-mail-legacy.js';
export { escapeMail };
const clean = (v,n) => String(v ?? '').trim().slice(0,n);
const layouts = ['branded','course','workshop','newsletter','thankyou','letter','dossier','signature'];
export const mailTextFields = {brandName:100,brandTagline:140,eyebrow:100,headline:180,intro:500,footerText:500,footerLinkLabel:120,unsubscribeLabel:160,signature:600};
export function mailIdentityDefaults(english=false) {
  return {brandName:'INEXC Training',brandTagline:english?'Knowledge. Practice. Impact.':'معرفة. تطبيق. أثر.',eyebrow:'',headline:'',intro:'',footerText:english?'INEXC Training · Professional learning':'INEXC Training · للتعلّم والتطوير المهني',footerLinkLabel:'inexctraining.com',footerLinkUrl:'https://www.inexctraining.com/',unsubscribeLabel:english?'Unsubscribe from these emails':'إلغاء الاشتراك في هذه الرسائل',signature:english?'Kind regards,\nThe INEXC Training Team':'مع خالص التحية،\nفريق INEXC Training'};
}
export function mailSettings(input={}) {
  const share={shareEnabled:input.shareEnabled===true,shareText:clean(input.shareText,350),shareLabel:clean(input.shareLabel,80)};
  if(input.designVersion!==3)return {...version4Settings(input),...share};
  const config={...version4Settings({...input,designVersion:2}),designVersion:3,...share};
  config.fontFamily=fontById(input.fontFamily)?input.fontFamily:'tahoma';
  config.headingFont=fontById(input.headingFont)?input.headingFont:config.fontFamily;
  const number=(v,min,max,def)=>Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):def;
  config.bodySize=number(input.bodySize,12,32,16);config.headingSize=number(input.headingSize,20,60,32);config.lineHeight=number(input.lineHeight,1.3,2.6,1.9);
  config.brandCaption=clean(input.brandCaption??'INEXC TRAINING',100);
  config.buttons=(Array.isArray(input.buttons)?input.buttons:[]).slice(0,8).map(buttonSettings);
  config.layout=layouts.includes(input.layout)?input.layout:'branded';
  // Undefined means use a language-aware default. An explicitly empty field stays empty.
  for(const [key,max] of Object.entries(mailTextFields))if(input[key]!==undefined)config[key]=clean(input[key],max);else delete config[key];
  config.footerLinkUrl=input.footerLinkUrl===undefined?'https://www.inexctraining.com/':safeInlineLink(clean(input.footerLinkUrl,600));
  config.headerEnabled=input.headerEnabled!==false;
  config.footerEnabled=input.footerEnabled!==false;
  config.heroEnabled=input.heroEnabled!==false;
  config.panels=(Array.isArray(input.panels)?input.panels:[]).slice(0,6).map(p=>({label:clean(p?.label,60),title:clean(p?.title,120),text:clean(p?.text,400)}));
  return config;
}
export function checkMessage(payload,options={}) {
  let issues=legacyCheck(payload,options);
  if(payload.designVersion===3){issues=issues.filter(v=>v!=='أكمل نص زر المحتوى ورابطه.');for(const b of messageDocument(payload.message).blocks)if(b.type==='button'&&(!safeButtonHref(b.href)||!b.runs.some(r=>r.text.trim())))issues.push('أكمل نص زر المحتوى ورابطه.');for(const [i,b] of (payload.buttons||[]).entries())if(!b.label||!buttonHref(b))issues.push(`أكمل نص ووجهة الزر ${i+1}؛ أرقام واتساب والاتصال تُكتب مع رمز الدولة.`);}
  const extra=[...Object.keys(mailTextFields).map(k=>payload[k]),...(payload.panels||[]).flatMap(p=>[p.label,p.title,p.text]),payload.brandCaption,...(payload.buttons||[]).flatMap(b=>[b.label,b.message])].join('\n');
  for(const token of new Set(extra.match(/\{\{[^}]+\}\}/g)||[])){
    if(!['{{name}}','{{email}}','{{course}}'].includes(token))issues.push(`متغير غير معروف: ${token}`);
    if(token==='{{course}}'&&!options.course)issues.push('اختر دورة أو استبدل متغير اسم الدورة بنص.');
  }
  if(payload.designVersion>=2&&payload.footerEnabled!==false&&payload.footerLinkLabel&&!/^https?:/.test(safeInlineLink(payload.footerLinkUrl)))issues.push('أكمل رابط الموقع في التذييل أو احذف نص الرابط.');
  if(payload.designVersion>=2&&!clean(payload.unsubscribeLabel??'إلغاء الاشتراك',160))issues.push('اكتب نصًا واضحًا لرابط إلغاء الاشتراك.');
  return [...new Set(issues)];
}
const table=(content,style='',attrs='')=>`<table role="presentation" cellspacing="0" cellpadding="0" border="0" ${attrs} style="border-collapse:collapse;${style}">${content}</table>`;
function palette(hex){
  const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16));
  const blend=(base,amount)=>'#'+rgb.map((v,i)=>Math.round(v*(1-amount)+base[i]*amount).toString(16).padStart(2,'0')).join('');
  const linear=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return{color:hex,ink:'#343a40',pale:blend([255,255,255],.94),line:blend([255,255,255],.78),mid:blend([255,255,255],.6),on:(.2126*linear[0]+.7152*linear[1]+.0722*linear[2])>.179?'#202124':'#ffffff'};
}
// Email-native geometric marks: table cells and borders, no image, SVG, canvas or remote font dependency.
function geometry(p,kind='grid',dark=false){
  const stroke=dark?p.mid:p.color,bg=dark?p.color:p.pale,line=dark?p.mid:p.line;
  const square=(size,content='',border=stroke)=>table(`<tr><td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${bg}" style="width:${size}px;height:${size}px;border:1px solid ${border};font-size:0;line-height:0">${content||'&nbsp;'}</td></tr>`,`width:${size}px;table-layout:fixed;`,`width="${size}" align="center"`);
  let mark;
  if(kind==='steps'){
    let step=table(`<tr><td width="16" height="16" bgcolor="${stroke}" style="font-size:0;line-height:0">&nbsp;</td></tr>`,'width:16px;','width="16"');
    for(const size of [40,64,88,112])step=table(`<tr><td width="${size}" height="${size}" align="right" valign="bottom" style="border-top:1px solid ${stroke};border-left:1px solid ${stroke};font-size:0;line-height:0">${step}</td></tr>`,`width:${size}px;table-layout:fixed;`,`width="${size}"`);
    mark=step;
  }else if(kind==='frame'){
    mark=square(112,square(82,square(50,square(18,'',stroke),line)));
  }else{
    mark=table([0,1,2].map(y=>'<tr>'+[0,1,2].map(x=>`<td width="36" height="36" align="center" valign="middle" bgcolor="${x===1&&y===1?stroke:bg}" style="width:36px;height:36px;border:1px solid ${x===y?stroke:line};font-size:0;line-height:0">&nbsp;</td>`).join('')+'</tr>').join(''),'width:112px;table-layout:fixed;','width="112"');
  }
  return table(`<tr><td>${mark}</td></tr>`,'width:112px;','width="112" aria-hidden="true" dir="ltr"');
}
function renderDesignMail(args){
  const {subject,body,ctaLabel='',ctaUrl='',person={},courseName='',settings={},unsubscribeUrl=''}=args;
  const input=mailSettings(settings);
  if(input.designVersion===2)return renderVersion4(args);
  if(input.designVersion!==3)return renderLegacyMail(args);
  const doc=messageDocument(body),dir=['rtl','ltr'].includes(doc.direction)?doc.direction:messageDirection(messageText(body)),english=dir==='ltr',align=english?'left':'right';
  const config={...mailIdentityDefaults(english),...input},p=palette(config.brandColor);
  const variables={name:person.name||config.fallbackName||(english?'friend':'صديقنا العزيز'),email:person.email||'',course:courseName||''};
  const merge=v=>String(v??'').replace(/\{\{(name|email|course)\}\}/g,(_,key)=>variables[key]);
  const text=v=>escapeMail(merge(v)).replace(/\n/g,'<br>');
  const rendered=renderMessageBody(body,variables,{font:config.fontFamily,lineHeight:config.lineHeight}),plain=config.plain||config.layout==='letter';
  const title=merge(subject),preview=merge(config.preheader)||rendered.text.slice(0,120);
  const brand=config.logoUrl?`<img src="${escapeMail(config.logoUrl)}" width="144" alt="${escapeMail(merge(config.brandName))}" style="max-width:144px;width:100%;height:auto;display:block;border:0">`:`<strong dir="auto" style="font-size:21px;font-weight:700;line-height:1.5;color:${p.ink}">${text(config.brandName)}</strong>`;
  const brandRow=table(`<tr><td class="mail-brand" align="${align}" style="vertical-align:middle">${brand}</td><td class="mail-tagline" align="${english?'right':'left'}" style="padding-${align}:16px;vertical-align:middle;font-size:12px;line-height:1.8;color:#48617c">${text(config.brandTagline)}</td></tr>`,'width:100%;','width="100%"');
  let heading=config.headerEnabled?`<tr><td class="mail-pad" style="padding:26px 36px;border-top:5px solid ${p.color}">${brandRow}</td></tr>`:'';
  if(config.layout==='signature'&&config.headerEnabled)heading=`<tr><td class="mail-pad" align="center" bgcolor="${p.color}" style="padding:30px 36px 32px;background:linear-gradient(115deg,#0874dc,${p.color});border-radius:18px 18px 0 0;text-align:center;color:${p.on}">${config.brandCaption?`<div dir="auto" style="font-size:13px;line-height:1.8;font-weight:700;margin-bottom:14px">${text(config.brandCaption)}</div>`:''}${config.logoUrl?brand:`<div dir="auto" style="font-family:${escapeMail(fontStack(config.headingFont))};font-size:26px;font-weight:700;line-height:1.7">${text(config.brandName)}</div>`}${config.brandTagline?`<div dir="auto" style="font-size:14px;line-height:1.9;margin-top:10px">${text(config.brandTagline)}</div>`:''}</td></tr>`;
  const eyebrow=config.eyebrow?`<div dir="auto" style="font-size:13px;font-weight:700;line-height:1.8;margin:0 0 16px">${text(config.eyebrow)}</div>`:'';
  const headline=config.headline?`<h1 dir="auto" style="font-family:${escapeMail(fontStack(config.headingFont))};font-size:${config.headingSize}px;line-height:1.5;font-weight:700;margin:0;overflow-wrap:anywhere">${text(config.headline)}</h1>`:'';
  const intro=config.intro?`<p dir="auto" style="font-size:${config.bodySize}px;line-height:${config.lineHeight};margin:18px 0 0">${text(config.intro)}</p>`:'';
  const rule=table(`<tr><td height="5" width="50" bgcolor="${p.color}" style="font-size:0;line-height:0">&nbsp;</td><td height="5" width="28" bgcolor="${p.mid}" style="font-size:0;line-height:0">&nbsp;</td><td height="5" width="18" bgcolor="${p.line}" style="font-size:0;line-height:0">&nbsp;</td></tr>`,'width:96px;','width="96" aria-hidden="true"');
  let hero='';
  if(!plain&&config.heroEnabled&&(eyebrow||headline||intro)){
    if(config.layout==='signature'){hero=`<tr><td class="mail-pad" style="padding:32px 36px 0;color:${p.color}">${eyebrow}${headline}${intro}</td></tr>`;}else if(config.layout==='course'){
      hero=`<tr><td class="mail-pad" bgcolor="${p.color}" style="padding:32px 36px 40px;background:linear-gradient(120deg,#0874dc,${p.color});color:${p.on}">${table(`<tr><td valign="top" style="padding-bottom:22px;color:${p.mid}">${eyebrow}</td><td width="120" align="${english?'right':'left'}" style="padding-bottom:22px">${geometry(p,'steps',true)}</td></tr>`,'width:100%;','width="100%"')}${headline}${intro}</td></tr><tr><td height="6" bgcolor="${p.color}" style="font-size:0;line-height:0">&nbsp;</td></tr>`;
    }else if(config.layout==='workshop'){
      hero=`<tr><td class="mail-pad" style="padding:6px 36px 32px">${table(`<tr><td bgcolor="${p.pale}" style="padding:24px;color:${p.ink};border-top:2px solid ${p.color};border-${align}:8px solid ${p.color}">${table(`<tr><td valign="top">${eyebrow}</td><td width="120" style="padding-bottom:24px">${geometry(p)}</td></tr>`,'width:100%;','width="100%"')}${headline}${intro}</td></tr>`,'width:100%;','width="100%"')}</td></tr>`;
    }else if(config.layout==='newsletter'){
      hero=`<tr><td class="mail-pad" style="padding:12px 36px 32px;color:${p.ink}">${table(`<tr><td style="padding:14px 0;border-top:1px solid ${p.line};border-bottom:1px solid ${p.line};color:${p.color}">${eyebrow.replace('margin:0 0 16px','margin:0')}</td><td width="96" align="${english?'right':'left'}" style="border-top:1px solid ${p.line};border-bottom:1px solid ${p.line}">${rule}</td></tr>`,'width:100%;margin-bottom:28px;','width="100%"')}${headline}${intro}</td></tr>`;
    }else if(config.layout==='thankyou'){
      hero=`<tr><td class="mail-pad" align="center" bgcolor="${p.pale}" style="padding:36px;color:${p.ink};border-top:1px solid ${p.line};border-bottom:1px solid ${p.line}">${table(`<tr><td style="padding-bottom:24px">${geometry(p,'frame')}</td></tr>`,'margin:0 auto;')}${eyebrow}${headline}${intro}</td></tr>`;
    }else if(config.layout==='dossier'){
      hero=`<tr><td class="mail-pad" style="padding:12px 36px 36px;color:${p.ink}">${table(`<tr><td width="8" bgcolor="${p.color}"></td><td style="padding-${align}:24px"><div style="color:${p.color}">${eyebrow}</div>${headline}${intro}</td></tr>`,'width:100%;','width="100%"')}</td></tr>`;
    }else{
      hero=`<tr><td class="mail-pad" bgcolor="${p.color}" style="padding:32px 36px 40px;color:${p.on}">${table(`<tr><td valign="top">${eyebrow}</td><td width="120" style="padding-bottom:24px">${geometry(p,'frame')}</td></tr>`,'width:100%;','width="100%"')}${headline}${intro}</td></tr>`;
    }
  }
  const panels=config.panels.filter(v=>v.label||v.title||v.text);
  const panelContent=v=>`${v.label?`<div dir="auto" style="font-size:12px;line-height:1.8;font-weight:700;color:${p.color};margin-bottom:10px">${text(v.label)}</div>`:''}${v.title?`<h2 dir="auto" style="font-family:${escapeMail(fontStack(config.headingFont))};font-size:${Math.max(18,config.bodySize+2)}px;line-height:1.7;font-weight:700;color:${p.ink};margin:0 0 10px">${text(v.title)}</h2>`:''}${v.text?`<div dir="auto" style="font-size:${config.bodySize}px;line-height:${config.lineHeight};color:#4b5563">${text(v.text)}</div>`:''}`;
  const panelRows=config.layout==='course'||config.layout==='thankyou'||config.layout==='branded'
    ? Array.from({length:Math.ceil(panels.length/3)},(_,i)=>'<tr><td>'+table('<tr>'+panels.slice(i*3,i*3+3).map(v=>`<td class="mail-panel" width="${Math.floor(100/Math.min(panels.length-i*3,3))}%" valign="top" style="padding:18px;border:1px solid ${p.line};background:${p.pale}">${panelContent(v)}</td>`).join('')+'</tr>','width:100%;table-layout:fixed;','width="100%"')+'</td></tr>').join('')
    : panels.map(v=>`<tr><td class="mail-panel" style="padding:20px 22px;border-bottom:1px solid ${p.line};border-${align}:3px solid ${p.color};background:${p.pale}">${panelContent(v)}</td></tr>`).join('');
  const panelSection=!plain&&panels.length?`<tr><td class="mail-pad" style="padding:28px 36px 0">${table(panelRows,'width:100%;table-layout:fixed;','width="100%"')}</td></tr>`:'';
  const actionUrl=safeInlineLink(merge(ctaUrl));
  const action=ctaLabel&&/^https?:/.test(actionUrl)?table(`<tr><td bgcolor="${p.color}" style="border:1px solid ${p.color};text-align:center"><a href="${escapeMail(actionUrl)}" style="display:inline-block;padding:14px 26px;color:${p.on};text-decoration:none;font-size:16px;font-weight:700;line-height:1.8;mso-padding-alt:14px 26px">${text(ctaLabel)}</a></td></tr>`,'margin-top:28px;max-width:100%;'):'';
  const extraActions=config.buttons.map(b=>`<div style="margin-top:14px;text-align:${b.align}">${renderButton(b,{family:config.fontFamily,label:merge(b.label),href:buttonHref({...b,message:merge(b.message)})})}</div>`).join('');
  const signature=config.signatureEnabled&&config.signature?table(`<tr><td style="padding-top:22px;border-top:1px solid ${p.line};font-size:14px;line-height:1.9;color:${p.ink}">${text(config.signature)}</td></tr>`,'width:100%;margin-top:32px;','width="100%"'):'';
  const footerUrl=safeInlineLink(merge(config.footerLinkUrl));
  const footer=config.footerEnabled&&(config.footerText||config.footerLinkLabel)?`<tr><td class="mail-pad" bgcolor="${p.pale}" style="padding:24px 36px;border-top:1px solid ${p.line};font-size:13px;line-height:1.9;color:#405773">${config.footerText?`<div dir="auto">${text(config.footerText)}</div>`:''}${config.footerLinkLabel&&/^https?:/.test(footerUrl)?`<a dir="auto" href="${escapeMail(footerUrl)}" style="display:inline-block;margin-top:8px;color:${p.ink};text-decoration:underline">${text(config.footerLinkLabel)}</a>`:''}</td></tr>`:'';
  // The link remains operational even when all optional visual regions are hidden.
  const unsubscribeLabel=config.unsubscribeLabel||mailIdentityDefaults(english).unsubscribeLabel;
  const unsubscribe=unsubscribeUrl?`<p style="margin:22px 16px 0;font-size:12px;line-height:1.9;text-align:center"><a href="${escapeMail(unsubscribeUrl)}" style="color:#48617c;text-decoration:underline">${text(unsubscribeLabel)}</a></p>`:'';
  const usedFonts=[config.fontFamily,config.headingFont,...doc.blocks.flatMap(b=>b.runs.map(r=>r.font).filter(Boolean))];
  const html=`<!doctype html><html lang="${english?'en':'ar'}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeMail(title)}</title><style>${fontCSS(usedFonts)}body,table,td{font-family:${fontStack(config.fontFamily)}}h1,h2{font-family:${fontStack(config.headingFont)}}.mail-copy h2{font-size:${Math.max(20,Math.round(config.headingSize*.72))}px}table{mso-table-lspace:0;mso-table-rspace:0}td{overflow-wrap:anywhere;word-break:break-word}img{max-width:100%}a{overflow-wrap:anywhere}@media only screen and (max-width:600px){.mail-outer{padding:12px 6px!important}.mail-shell{width:100%!important}.mail-pad{padding:24px 20px!important}.mail-panel{display:block!important;box-sizing:border-box!important;width:100%!important}.mail-brand,.mail-tagline{display:block!important;width:100%!important;text-align:${align}!important;padding:0!important}.mail-tagline{padding-top:8px!important}h1{font-size:${Math.min(config.headingSize,30)}px!important}}</style></head><body dir="${dir}" style="margin:0;padding:0;background:${plain?'#ffffff':'#edf2f8'};color:${p.ink};font-family:${escapeMail(fontStack(config.fontFamily))}"><div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeMail(preview)}</div>${table(`<tr><td class="mail-outer" align="center" style="padding:32px 12px"><!--[if mso]><table role="presentation" width="640" cellspacing="0" cellpadding="0"><tr><td><![endif]-->${table(`${heading}${hero}${panelSection}<tr><td class="mail-pad mail-copy" dir="${rendered.direction}" align="${align}" style="padding:32px 36px;direction:${rendered.direction};text-align:${align};font-family:${escapeMail(fontStack(config.fontFamily))};font-size:${config.bodySize}px;line-height:${config.lineHeight}">${rendered.html}${action}${extraActions}${signature}</td></tr>${footer}`,'width:100%;max-width:640px;table-layout:fixed;text-align:'+align+';direction:'+dir+';background:#ffffff;border-radius:'+(config.layout==='signature'?'18px':'0')+';border:1px solid '+(plain?'#ffffff':p.line)+';','width="100%" class="mail-shell"')}<!--[if mso]></td></tr></table><![endif]-->${unsubscribe}</td></tr>`,'width:100%;','width="100%"')}</body></html>`;
  const plainText=[config.headerEnabled?merge(config.brandName):'',config.headerEnabled?merge(config.brandTagline):'',!plain&&config.heroEnabled?[config.eyebrow,config.headline,config.intro].map(merge).filter(Boolean).join('\n'): '',!plain?panels.map(v=>[v.label,v.title,v.text].map(merge).filter(Boolean).join('\n')).join('\n\n'):'',rendered.text,...config.buttons.map(b=>`${merge(b.label)}: ${buttonHref({...b,message:merge(b.message)})}`),ctaLabel&&/^https?:/.test(actionUrl)?`${merge(ctaLabel)}: ${actionUrl}`:'',config.signatureEnabled?merge(config.signature):'',config.footerEnabled?merge(config.footerText):'',config.footerEnabled&&config.footerLinkLabel&&/^https?:/.test(footerUrl)?`${merge(config.footerLinkLabel)}: ${footerUrl}`:'',unsubscribeUrl?`${merge(unsubscribeLabel)}: ${unsubscribeUrl}`:''].filter(Boolean).join('\n\n');
  return {subject:title,html,text:plainText,direction:rendered.direction};
}

// Opt-in per message: historical campaigns keep their exact previous content.
export function renderMail(args){
  const mail=renderDesignMail(args),settings=mailSettings(args.settings||{});
  if(!settings.shareEnabled)return mail;
  const english=mail.direction==='ltr',url=args.shareUrl||subscriptionUrl('',true);
  let valid;try{const parsed=new URL(url);valid=parsed.origin==='https://www.inexctraining.com'&&parsed.pathname==='/subscribe.html';}catch{}
  if(!valid)return mail;
  const text=settings.shareText||(english?'Know someone who would enjoy these emails? Share the subscription link.':'تعرف شخصًا قد تهمّه رسائلنا؟ شاركه رابط الاشتراك.');
  const label=settings.shareLabel||(english?'Share with a friend':'شارك مع صديق');
  const section=`<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:8px 18px 30px"><table role="presentation" width="100%" style="max-width:640px;background:#eef6ff;border:1px solid #cbdff7"><tr><td dir="${english?'ltr':'rtl'}" align="center" style="padding:22px;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#414a57"><p style="margin:0 0 12px">${escapeMail(text)}</p><a href="${escapeMail(url)}" style="display:inline-block;padding:10px 22px;background:#0868ce;color:white;text-decoration:none;border-radius:6px;font-weight:bold">${escapeMail(label)}</a></td></tr></table></td></tr></table>`;
  return {...mail,html:mail.html.replace('</body>',section+'</body>'),text:mail.text+'\n\n'+text+'\n'+label+': '+url};
}
