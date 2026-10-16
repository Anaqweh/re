import {richTextPrefix,normaliseMessageBody} from './inexc-api/message-format.js';
import {renderMail,mailIdentityDefaults} from './inexc-api/message-mail.js?v=20261015-sub1';

const cardsUrl='https://www.inexctraining.com/cards/';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=value=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
const months=value=>Number(value)+(Number(value)>=3&&Number(value)<=10?' أشهر':' شهرًا');
const paragraph=(text,style={})=>({type:'paragraph',direction:'rtl',runs:[{text,...style}]});

export function membershipFeatures(plan){
  const explicit=String(plan.featureLines||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(explicit.length)return [...new Set(explicit)];
  const features=[],units=Number(plan.bookingUnits),course=Number(plan.courseUnitCost),diploma=Number(plan.diplomaUnitCost);
  if(units>0){
    const choices=[];
    if(course>0&&units>=course)choices.push(`${Math.floor(units/course)} من الدورات`);
    if(diploma>0&&units>=diploma)choices.push(`${Math.floor(units/diploma)} من الدبلومات`);
    if(choices.length)features.push('رصيد يتيح حجز حتى '+choices.join(' أو حتى '));
  }
  if(Number(plan.certificateDiscount)>0)features.push(`خصم ${Number(plan.certificateDiscount)}% على رسوم الشهادات`);
  if(Number(plan.earlyAccessHours)>0)features.push(`حجز مبكر قبل العامة بـ${Number(plan.earlyAccessHours)} ساعة`);
  features.push(...String(plan.perks||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean));
  return [...new Set(features)];
}

// Use the existing rich-text format: drafts, templates, preview and delivery all
// keep the same content without a server migration or a new HTML email engine.
export function membershipEmailPayload(plans,selectedIds,options={}){
  const wanted=new Set(selectedIds),selected=plans.filter(p=>wanted.has(p.id)&&p.active!==false);
  if(!selected.length)throw Error('اختر بطاقة تدريبية واحدة على الأقل.');
  const blocks=[paragraph(options.introduction??'مرحبًا {{name}}،\nاختر ما يناسب رحلتك في التعلّم من بطاقات INEXC التدريبية، وتعرّف إلى المزايا المتاحة لكل بطاقة.')];
  for(const plan of selected){
    if(!String(plan.name||'').trim()||plan.priceUsd===null||plan.priceUsd===undefined||!Number.isFinite(Number(plan.priceUsd))||Number(plan.priceUsd)<0)throw Error('راجع اسم البطاقة وسعرها في إدارة البطاقات قبل إعداد الرسالة.');
    blocks.push({type:'divider',runs:[]});
    if(plan.badgeText)blocks.push(paragraph(String(plan.badgeText),{color:'#1559d6',size:13}));
    blocks.push({type:'heading',direction:'rtl',runs:[{text:String(plan.name),bold:true,color:'#173d68',size:24}]});
    blocks.push({type:'paragraph',direction:'ltr',align:'right',runs:[{text:price(plan.priceUsd),bold:true,color:'#1559d6',size:32},{text:' USD',color:'#52647a',size:14}]});
    if(Number(plan.validMonths)>0)blocks.push(paragraph('مدة الصلاحية: '+months(plan.validMonths),{color:'#52647a',size:14}));
    for(const feature of membershipFeatures(plan))blocks.push({type:'bullet',direction:'rtl',runs:[{text:feature}]});
    if(plan.remaining!==undefined&&Number(plan.remaining)<=0)blocks.push(paragraph('هذه البطاقة غير متاحة للشراء حاليًا.',{color:'#52647a',size:14}));
  }
  blocks.push({type:'divider',runs:[]},paragraph('للاطّلاع على التفاصيل والتوافر الحالي واختيار بطاقتك، تفضّل بزيارة صفحة البطاقات التدريبية.',{color:'#52647a',size:14}));
  return {
    ...mailIdentityDefaults(false),designVersion:3,layout:'signature',plain:false,
    fontFamily:'ibm',headingFont:'ibm',bodySize:16,headingSize:30,lineHeight:1.9,
    brandColor:'#1559d6',brandCaption:'INEXC TRAINING',brandName:'بطاقات INEXC التدريبية',brandTagline:'معرفة. تطبيق. أثر.',
    headerEnabled:true,heroEnabled:true,footerEnabled:true,signatureEnabled:true,
    eyebrow:'مساحة أوسع للتعلّم',headline:selected.length===1?selected[0].name:'اختر البطاقة التي تناسبك',intro:'',panels:[],buttons:[],
    subject:options.subject??(selected.length===1?selected[0].name+' | INEXC Training':'بطاقات INEXC التدريبية | اختر ما يناسبك'),
    preheader:selected.map(p=>p.name).join(' · ').slice(0,180),
    message:normaliseMessageBody(richTextPrefix+JSON.stringify({direction:'rtl',blocks})),
    ctaLabel:'استعراض البطاقات والتسجيل',ctaUrl:cardsUrl,
    audience:'custom',extraRecipients:'',scheduledAt:'',attachmentPath:'',shareEnabled:false
  };
}

export async function mountMembershipEmail({target,api,onCompose,settings={}}){
  target.innerHTML='<div class="empty" role="status">جارٍ تحميل البطاقات التدريبية…</div>';
  let plans;
  try{
    const rows=await api('/memberships/plans',{cache:'no-store'});
    if(!Array.isArray(rows))throw Error('تعذّر قراءة بيانات البطاقات.');
    plans=rows.filter(p=>p.active!==false);
  }catch(error){
    target.innerHTML=`<div class="card"><h2>تعذّر تحميل البطاقات</h2><p>${esc(error.message)}</p><button type="button" data-membership-retry>إعادة المحاولة</button></div>`;
    target.querySelector('[data-membership-retry]').onclick=()=>mountMembershipEmail({target,api,onCompose,settings});return;
  }
  if(!plans.length){target.innerHTML='<div class="empty"><h2>لا توجد بطاقات منشورة حاليًا</h2><p>أظهر البطاقات من قسم بطاقات INEXC، ثم افتح هذا النموذج مجددًا.</p></div>';return;}
  if(!document.querySelector('[data-membership-email-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./message-memberships.css?v=20261016-mail1',import.meta.url).href;link.dataset.membershipEmailStyle='';document.head.append(link);
  }
  target.innerHTML=`<div class="section-head"><div class="eyebrow">INEXC / TRAINING CARDS</div><h2>إرسال البطاقات التدريبية</h2><p class="muted">بطاقة واحدة، بطاقتان، أو جميع البطاقات في رسالة واحدة. اختر البطاقات وراجع المعاينة، ثم حدّد المستلمين.</p></div>
  <div class="membership-mail-grid"><form class="card stack membership-mail-form">
    <fieldset class="membership-mail-picker"><legend>1. اختر البطاقات</legend><div class="row between"><label class="row"><input type="checkbox" data-membership-all checked>تحديد جميع البطاقات</label><span class="muted" data-membership-count role="status"></span></div>
    <div class="membership-mail-options">${plans.map(p=>`<label class="membership-mail-option"><input type="checkbox" data-membership-id="${esc(p.id)}" checked><span><strong>${esc(p.name)}</strong><small>${Number(p.validMonths)>0?'صلاحية '+months(p.validMonths):'بطاقة تدريبية'}${p.remaining!==undefined&&Number(p.remaining)<=0?' · غير متاحة للشراء حاليًا':''}</small></span><b dir="ltr">${price(p.priceUsd)} <small>USD</small></b></label>`).join('')}</div></fieldset>
    <fieldset class="membership-mail-picker"><legend>2. أضف لمستك</legend><div class="fields"><label>عنوان البريد<input data-membership-subject maxlength="160" required value="بطاقات INEXC التدريبية | اختر ما يناسبك" dir="auto"></label><label>مقدمة الرسالة<textarea data-membership-introduction maxlength="1000" rows="5" dir="auto">مرحبًا {{name}}،
اختر ما يناسب رحلتك في التعلّم من بطاقات INEXC التدريبية، وتعرّف إلى المزايا المتاحة لكل بطاقة.</textarea></label></div><p class="hint">تظهر الأسعار والمزايا الحالية. يمكنك تعديل النص وحفظه كقالب في الخطوة التالية.</p></fieldset>
    <div class="notice error" data-membership-error role="alert" hidden></div><button type="submit" class="primary" data-membership-continue>اختيار المستلمين ومتابعة الرسالة</button><p class="hint">تفتح الخطوة التالية محرّر الرسالة. الإرسال يتم بعد مراجعة المستلمين وتأكيده.</p>
  </form><div class="card membership-mail-preview"><div class="row between"><h3>معاينة البريد</h3><div class="row" role="group" aria-label="حجم المعاينة"><button type="button" data-membership-device="desktop" aria-pressed="true">حاسوب</button><button type="button" data-membership-device="phone" aria-pressed="false">هاتف</button></div></div><div class="membership-mail-envelope"><span>الموضوع</span><strong data-membership-preview-subject></strong></div><div class="membership-mail-preview-surface"><iframe sandbox="" title="معاينة رسالة البطاقات التدريبية" data-membership-preview></iframe></div></div></div>`;
  const $=s=>target.querySelector(s),inputs=[...target.querySelectorAll('[data-membership-id]')];
  const chosen=()=>inputs.filter(n=>n.checked).map(n=>n.dataset.membershipId);
  let payload,busy=false,subjectEdited=false;
  function preview(){
    const ids=chosen(),all=$('[data-membership-all]');all.checked=ids.length===inputs.length;all.indeterminate=ids.length>0&&!all.checked;
    $('[data-membership-count]').textContent=`${ids.length} / ${inputs.length}`;
    if(!subjectEdited)$('[data-membership-subject]').value=ids.length===1?plans.find(p=>p.id===ids[0]).name+' | INEXC Training':'بطاقات INEXC التدريبية | اختر ما يناسبك';
    const error=$('[data-membership-error]');
    try{
      payload={...settings,...membershipEmailPayload(plans,ids,{subject:$('[data-membership-subject]').value.trim(),introduction:$('[data-membership-introduction]').value})};
      if(!payload.subject)throw Error('اكتب عنوانًا للبريد.');
      // Preview only: no contact lookup, draft mutation, campaign or mail request.
      const mail=renderMail({subject:payload.subject,body:payload.message,settings:payload,ctaLabel:payload.ctaLabel,ctaUrl:payload.ctaUrl,unsubscribeUrl:'https://www.inexctraining.com/'});
      $('[data-membership-preview]').srcdoc=mail.html;$('[data-membership-preview-subject]').textContent=payload.subject;error.hidden=true;
    }catch(e){payload=null;error.textContent=e.message;error.hidden=false;$('[data-membership-preview]').srcdoc='';$('[data-membership-preview-subject]').textContent='';}
    $('[data-membership-continue]').disabled=!payload||busy;
  }
  $('[data-membership-all]').onchange=e=>{inputs.forEach(n=>n.checked=e.target.checked);preview()};
  inputs.forEach(n=>n.onchange=preview);
  $('[data-membership-subject]').oninput=()=>{subjectEdited=true;preview()};$('[data-membership-introduction]').oninput=preview;
  target.querySelectorAll('[data-membership-device]').forEach(button=>button.onclick=()=>{target.querySelectorAll('[data-membership-device]').forEach(n=>n.setAttribute('aria-pressed',String(n===button)));$('.membership-mail-preview-surface').classList.toggle('phone',button.dataset.membershipDevice==='phone')});
  $('form').onsubmit=async event=>{event.preventDefault();preview();if(!payload||busy)return;busy=true;$('[data-membership-continue]').disabled=true;try{await onCompose(payload)}catch(e){const error=$('[data-membership-error]');error.hidden=false;error.textContent=e.message}finally{busy=false;$('[data-membership-continue]').disabled=!payload}};
  preview();
}
