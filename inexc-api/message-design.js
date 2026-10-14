import {fontFaces} from './message-font-faces.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const system=(id,label,family,fallback='Arial,sans-serif')=>({id,label,family,stack:`'${family}',${fallback}`,group:'خطوط النظام'});
const web=(id,label,family,group='خطوط عربية')=>({id,label,family,stack:`'${family}',Tahoma,Arial,sans-serif`,group,web:true});
export const emailFonts=[web('ibm','IBM Plex Sans Arabic','IBM Plex Sans Arabic'),web('noto-naskh','Noto Naskh Arabic · نسخ','Noto Naskh Arabic'),web('noto-arabic','Noto Sans Arabic','Noto Sans Arabic'),web('cairo','Cairo · القاهرة','Cairo'),web('tajawal','Tajawal · تجوّل','Tajawal'),web('almarai','Almarai · المراعي','Almarai'),web('changa','Changa','Changa'),web('amiri','Amiri · أميري','Amiri'),web('readex','Readex Pro','Readex Pro'),web('alexandria','Alexandria · الإسكندرية','Alexandria'),web('inter','Inter','Inter','خطوط إنجليزية'),web('lato','Lato','Lato','خطوط إنجليزية'),web('open-sans','Open Sans','Open Sans','خطوط إنجليزية'),web('roboto','Roboto','Roboto','خطوط إنجليزية'),web('source-sans','Source Sans 3','Source Sans 3','خطوط إنجليزية'),system('arial','Arial','Arial'),system('tahoma','Tahoma','Tahoma'),system('verdana','Verdana','Verdana'),system('trebuchet','Trebuchet MS','Trebuchet MS'),system('georgia','Georgia','Georgia','Times New Roman,serif'),system('times','Times New Roman','Times New Roman','serif'),system('courier','Courier New','Courier New','monospace'),system('segoe','Segoe UI','Segoe UI'),system('calibri','Calibri','Calibri'),system('cambria','Cambria','Cambria','Georgia,serif'),system('helvetica','Helvetica','Helvetica'),system('palatino','Palatino Linotype','Palatino Linotype','Georgia,serif'),system('arial-black','Arial Black','Arial Black'),system('lucida','Lucida Sans Unicode','Lucida Sans Unicode'),system('garamond','Garamond','Garamond','Georgia,serif')];
export const fontById=id=>emailFonts.find(f=>f.id===id);
export const fontStack=id=>(fontById(id)||emailFonts[0]).stack;
export const fontIdFromCSS=css=>{const first=String(css||'').split(',')[0].trim().replace(/['"]/g,'').toLowerCase();return emailFonts.find(f=>f.family.toLowerCase()===first)?.id;};
export const fontSizes=[10,12,14,16,18,20,22,24,26,28,30,32,36,40,44,48,56,64,72];
export function fontCSS(ids=[]){return [...new Set(ids)].map(id=>id==='ibm'?[['Regular',400],['Medium',500],['SemiBold',600],['Bold',700]].map(([file,w])=>`@font-face{font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:${w};font-display:swap;src:url('https://www.inexctraining.com/assets/fonts/ibm-plex-arabic/${file}.woff2') format('woff2')}`).join('\n'):fontFaces[id]||'').join('\n');}
export const buttonKinds=[['url','رابط موقع'],['whatsapp','واتساب'],['email','بريد إلكتروني'],['phone','اتصال هاتفي'],['download','تحميل ملف'],['meeting','حجز موعد'],['map','الموقع على الخريطة'],['facebook','فيسبوك'],['instagram','إنستغرام'],['linkedin','لينكدإن'],['telegram','تلغرام'],['youtube','يوتيوب']];
export function safeButtonHref(value){
 const raw=String(value||'').trim();if(/[\u0000-\u001f\u007f]/.test(raw))return '';
 try{const u=new URL(raw);if(['https:','http:'].includes(u.protocol)&&u.hostname)return u.href;if(u.protocol==='mailto:'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(u.pathname))return u.href;if(u.protocol==='tel:'&&/^\+?[\d ()-]{7,24}$/.test(u.pathname))return u.href;}catch{}return '';
}
const latinDigits=value=>String(value||'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
export function buttonHref(button={}){
 const target=String(button.target??button.href??'').trim(),message=String(button.message||'').slice(0,1000);
 if(button.kind==='whatsapp'){
  let phone=latinDigits(target).replace(/[ +().-]/g,'').replace(/^00/,'');if(!/^[1-9]\d{7,14}$/.test(phone))return '';
  return 'https://wa.me/'+phone+(message?'?text='+encodeURIComponent(message):'');
 }
 if(button.kind==='phone'){const phone=latinDigits(target).replace(/[ ()-]/g,'');return /^\+?[1-9]\d{6,14}$/.test(phone)?'tel:'+phone:'';}
 if(button.kind==='email'){const mail=target.replace(/^mailto:/i,'');return /^[^\s<>@?]+@[^\s<>@?]+\.[^\s<>@?]+$/.test(mail)?'mailto:'+mail+(message?'?subject='+encodeURIComponent(message):''):'';}
 const safe=safeButtonHref(target);return /^https?:/.test(safe)?safe:'';
}
export function buttonSettings(raw={}){
 const size=Number(raw.size);return{kind:buttonKinds.some(([id])=>id===raw.kind)?raw.kind:'url',label:String(raw.label??'').trim().slice(0,120),target:String(raw.target??raw.href??'').trim().slice(0,1000),message:String(raw.message??'').slice(0,1000),variant:['solid','outline','soft'].includes(raw.variant)?raw.variant:'solid',color:/^#[a-f\d]{6}$/i.test(raw.color)?raw.color:'#0868ce',align:['left','center','right'].includes(raw.align)?raw.align:'center',radius:[0,6,12,24].includes(Number(raw.radius))?Number(raw.radius):6,fullWidth:raw.fullWidth===true,size:fontSizes.includes(size)?size:16};
}
function readable(hex){const a=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*a[0]+.7152*a[1]+.0722*a[2]>.179?'#202124':'#ffffff';}
export function renderButton(raw,{family='tahoma',label,href}={}){
 const b=buttonSettings(raw),url=href||buttonHref(b);if(!url||!(label??b.label))return '';
 const light=b.variant!=='solid',fg=light?(readable(b.color)==='#ffffff'?b.color:'#343a40'):readable(b.color),bg=b.variant==='solid'?b.color:b.variant==='soft'?'#edf5ff':'#ffffff';
 return `<a href="${esc(url)}" style="display:${b.fullWidth?'block':'inline-block'};box-sizing:border-box;max-width:100%;background:${bg};color:${fg};border:1px solid ${b.color};border-radius:${b.radius}px;padding:12px 24px;text-align:center;font-family:${esc(fontStack(family))};font-size:${b.size}px;font-weight:700;line-height:1.7;text-decoration:none;overflow-wrap:anywhere;mso-padding-alt:12px 24px">${esc(label??b.label)}</a>`;
}
