/* Shared INEXC trainee identity card. Rendering and downloads never submit records or email. */
(function(global){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0,format=value=>number(value).toLocaleString('ar-AE');
 const icons={copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',print:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/>',check:'<path d="m8 12 3 3 5-6M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/>',award:'<circle cx="12" cy="8" r="5"/><path d="m8 12-1 9 5-3 5 3-1-9"/>',link:'<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 0-6-6l-4 4" transform="translate(3 2) scale(.85)"/>'};
 const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
 function safeUrl(value){if(!String(value||'').trim())return '';try{const url=new URL(value,location.href);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return ''}}
 function model(data,options={}){
  const p=data.profile||{},d=data.digitalId||{},demo=options.demo===true||data.isLocalSession===true;
  const certificates=Array.isArray(data.certificates)?data.certificates:Array.isArray(d.certificates)?d.certificates:[];
  const name=p.full_name||'متدرب INEXC',parts=name.trim().split(/\s+/),initials=parts.slice(0,2).map(s=>Array.from(s)[0]).join('');
  return{name,initials,specialty:p.specialty||p.country||'التطوير المهني والتعلّم المستمر',id:d.idNumber||'—',avatar:safeUrl(p.avatar_url||''),tier:({bronze:'العضوية البرونزية',silver:'العضوية الفضية',gold:'العضوية الذهبية',vip:'عضوية التميّز'})[d.tierKey]||d.tierLabel||'متدرب INEXC',certificates,certCount:certificates.length,hours:number(d.trainingHours),progress:Math.min(100,number(data.professionalValue?.overallReadiness)),url:options.qrUrl?safeUrl(options.qrUrl):demo?new URL('digital-id.html?preview=1',location.href).href:safeUrl(d.verifyUrl),demo,status:demo?'نموذج توضيحي — غير صادر':options.status||'مسجّل لدى INEXC',title:options.title||'بطاقة المتدرب',subtitle:options.subtitle||'DIGITAL LEARNER ID',numberLabel:options.numberLabel||'رقم المتدرب',qrCaption:demo?'معاينة التصميم':options.qrCaption||'امسح لعرض السجل'};
 }
 function qrMarkup(url){
  if(!url||!global.INEXCQRCode)return '';
  try{const qr=global.INEXCQRCode.create(url,{errorCorrectionLevel:'M'}).modules,margin=4,size=qr.size+margin*2;let path='';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.get(y,x))path+='M'+(x+margin)+' '+(y+margin)+'h1v1h-1z';return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" role="img" aria-label="رمز فتح صفحة البطاقة" shape-rendering="crispEdges"><rect width="'+size+'" height="'+size+'" fill="white"/><path d="'+path+'" fill="#17497b"/></svg>';}catch{return ''}
 }
 function visual(m){return '<article class="tc-card" aria-label="بطاقة '+esc(m.name)+'"><div class="tc-card-top"><img class="tc-logo" src="/assets/inexc-approved-logo.jpg" width="156" height="78" alt="INEXC — التميز الابتكاري"><div class="tc-card-type"><strong>'+esc(m.title)+'</strong><span lang="en" dir="ltr">'+esc(m.subtitle)+'</span></div></div><div class="tc-card-body"><div class="tc-avatar">'+(m.avatar?'<img src="'+esc(m.avatar)+'" alt="صورة المتدرب" referrerpolicy="no-referrer">':esc(m.initials))+'</div><div class="tc-identity"><h2 class="tc-name" dir="auto">'+esc(m.name)+'</h2><p class="tc-specialty" dir="auto">'+esc(m.specialty)+'</p><span class="tc-tier">'+esc(m.tier)+'</span></div></div><div class="tc-card-bottom"><div><div class="tc-number-label">'+esc(m.numberLabel)+'</div><bdi class="tc-number">'+esc(m.id)+'</bdi><p class="tc-issuer">التميز الابتكاري للتعليم والتدريب</p></div><div class="tc-qr">'+(qrMarkup(m.url)||'<span class="tc-qr-unavailable">رابط البطاقة متاح أدناه</span>')+'<small>'+esc(m.qrCaption)+'</small></div></div><div class="tc-card-strip"><span>'+esc(m.status)+'</span><span lang="en">INEXC · LEARNING CONTINUES</span></div></article>';}
 function render(data,options={}){
  const m=model(data,options),rows=m.certificates.map(c=>'<li class="tc-certificate"><span class="tc-cert-icon">'+icon('award')+'</span><div><strong dir="auto">'+esc(c.course_name||'دورة تدريبية')+'</strong><small>رقم الشهادة · <code>'+esc(c.certificate_number||'غير متاح')+'</code></small></div></li>').join('');
  return '<div class="tc-root" dir="rtl"><div class="tc-layout"><div class="tc-main">'+visual(m)+'<div class="tc-actions"><button type="button" class="tc-btn primary" data-tc-action="download">'+icon('download')+'تحميل البطاقة</button><button type="button" class="tc-btn" data-tc-action="print">'+icon('print')+'طباعة / PDF</button><button type="button" class="tc-btn" data-tc-action="copy">'+icon('copy')+'نسخ الرابط</button><a class="tc-btn" href="https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(m.url)+'" target="_blank" rel="noopener noreferrer">'+icon('link')+'مشاركة LinkedIn</a></div><p class="tc-feedback" role="status" aria-live="polite"></p><section class="tc-panel tc-records"><div class="tc-records-head"><h2>الشهادات المسجّلة</h2><span class="tc-record-count">'+format(m.certCount)+' شهادة</span></div>'+(rows?'<ul class="tc-certificates">'+rows+'</ul>':'<div class="tc-empty">لم تُضف شهادات إلى هذا السجل بعد.</div>')+'</section></div><aside class="tc-side"><section class="tc-panel"><div class="tc-status-icon">'+icon('check')+'</div><h2>سجل البطاقة</h2><span class="tc-status '+(m.demo?'is-preview':'')+'">'+esc(m.status)+'</span><p>'+(m.demo?'بيانات توضيحية لمعاينة التصميم. هذه النسخة ليست بطاقة متدرب صادرة.':'تعرض البطاقة بيانات المتدرب وشهاداته المسجّلة في منصة INEXC.')+'</p><p class="tc-proof-note">'+(m.demo?'تظل عبارة النموذج ظاهرة عند التحميل والطباعة.':'يربط رمز QR بهذه الصفحة لعرض السجل الحالي. لا تتضمن البطاقة بيانات الاتصال الخاصة.')+'</p></section><section class="tc-panel"><h2>مسيرة التعلّم</h2><dl class="tc-stat-list"><div><dt>الشهادات المسجّلة</dt><dd>'+format(m.certCount)+'</dd></div><div><dt>ساعات التعلّم</dt><dd>'+format(m.hours)+'</dd></div><div><dt>التقدم التدريبي</dt><dd>'+format(m.progress)+'٪</dd></div></dl><p class="tc-stat-note">تُحسب الساعات والتقدم من بيانات الدورات المسجّلة.</p></section></aside></div></div>';
 }
 async function dataUrl(path){const response=await fetch(path,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('تعذر تحميل عناصر البطاقة. أعد المحاولة.');const blob=await response.blob();return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});}
 function splitName(name){const words=name.trim().split(/\s+/),rows=[''];for(const word of words){if(rows[rows.length-1]&&rows[rows.length-1].length+word.length>30&&rows.length<3)rows.push('');rows[rows.length-1]+=(rows[rows.length-1]?' ':'')+word;}return rows;}
 async function svgFile(data,options={}){
  const m=model(data,options),[logo,font,photo]=await Promise.all([dataUrl('/assets/inexc-approved-logo.jpg'),dataUrl('/assets/fonts/ibm-plex-arabic/Regular.woff2'),m.avatar?dataUrl(m.avatar).catch(()=>''):Promise.resolve('')]);
  const lines=splitName(m.name),fontSize=Math.max(24,Math.min(43,900/Math.max(...lines.map(x=>x.length)))),qr=qrMarkup(m.url).replace('<svg ','<svg x="70" y="407" width="142" height="142" ');
  const portrait=photo?'<image href="'+photo+'" x="900" y="210" width="115" height="140" preserveAspectRatio="xMidYMid slice" clip-path="url(#portrait)"/>':'<text x="957" y="292" text-anchor="middle" fill="#0964cd" font-size="38">'+esc(m.initials)+'</text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="680" viewBox="0 0 1080 680"><defs><linearGradient id="blue"><stop stop-color="#0876de"/><stop offset="1" stop-color="#0756c4"/></linearGradient><clipPath id="portrait"><rect x="900" y="210" width="115" height="140" rx="18"/></clipPath><clipPath id="cardEdge"><rect width="1080" height="680" rx="34"/></clipPath><style>@font-face{font-family:CardPlex;src:url('+font+')}text{font-family:CardPlex,Arial,sans-serif}</style></defs><g clip-path="url(#cardEdge)"><rect width="1080" height="680" fill="url(#blue)"/><circle cx="20" cy="25" r="240" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="65"/><rect x="780" y="45" width="245" height="122" rx="16" fill="#fff"/><image href="'+logo+'" x="792" y="51" width="221" height="110"/><text x="360" y="89" text-anchor="start" direction="rtl" fill="white" font-size="30">'+esc(m.title)+'</text><text x="60" y="132" fill="#dbedff" font-size="20">'+esc(m.subtitle)+'</text><rect x="900" y="210" width="115" height="140" rx="18" fill="#e9f4ff"/>'+portrait+lines.map((line,i)=>'<text x="860" y="'+(246+i*48)+'" text-anchor="start" direction="rtl" fill="white" font-size="'+fontSize+'"'+(line.length>38?' textLength="720" lengthAdjust="spacingAndGlyphs"':'')+'>'+esc(line)+'</text>').join('')+'<text x="860" y="377" text-anchor="start" direction="rtl" fill="#deeeff" font-size="23">'+esc(m.specialty.length>52?m.specialty.slice(0,49)+'…':m.specialty)+'</text><text x="860" y="414" text-anchor="start" direction="rtl" fill="#fff" font-size="20">'+esc(m.tier)+'</text><text x="1015" y="479" text-anchor="start" direction="rtl" fill="#deeeff" font-size="20">'+esc(m.numberLabel)+'</text><text x="1015" y="523" text-anchor="end" direction="ltr" fill="white" font-size="32">'+esc(m.id)+'</text><text x="1015" y="562" text-anchor="start" direction="rtl" fill="#deeeff" font-size="18">التميز الابتكاري للتعليم والتدريب</text><rect x="61" y="398" width="160" height="160" rx="12" fill="white"/>'+qr+'<rect y="604" width="1080" height="76" fill="#eaf4ff"/><text x="1015" y="650" text-anchor="start" direction="rtl" fill="#175a9d" font-size="22">'+esc(m.status)+'</text><text x="60" y="650" fill="#175a9d" font-size="17">INEXC · LEARNING CONTINUES</text></g></svg>';
 }
 async function pngFile(data,options={}){
  const svg=await svgFile(data,options),source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
   const image=new Image();image.src=source;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=2160;canvas.height=1360;
   const context=canvas.getContext('2d');if(!context)throw Error('تعذر تجهيز الصورة على هذا الجهاز.');
   context.drawImage(image,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!blob)throw Error('تعذر إنشاء صورة البطاقة. أعد المحاولة.');
   return blob;
  }finally{URL.revokeObjectURL(source)}
 }
 async function socialPreviewPNG(data,options={}){
  const m=model(data,options);
  if(m.id!=='INEXC')throw Error('معاينة المشاركة لا تقبل رقم البطاقة.');
  await Promise.all([document.fonts?.load('700 48px INEXCPlex'),document.fonts?.load('500 26px INEXCPlex')]);
  const logo=new Image();logo.src='/assets/inexc-approved-logo.jpg';await logo.decode();
  const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1260;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('تعذر تجهيز صورة المشاركة على هذا الجهاز.');
  ctx.scale(2,2);
  const round=(x,y,w,h,r)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()};
  ctx.fillStyle='#eef5fc';ctx.fillRect(0,0,1200,630);
  const blue=ctx.createLinearGradient(24,24,1176,570);blue.addColorStop(0,'#0876de');blue.addColorStop(1,'#0756c4');ctx.fillStyle=blue;round(24,24,1152,582,34);
  ctx.strokeStyle='#ffffff14';ctx.lineWidth=44;ctx.beginPath();ctx.arc(90,70,215,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#fff';round(855,70,260,116,18);
  const ratio=Math.min(226/logo.width,98/logo.height);ctx.drawImage(logo,985-logo.width*ratio/2,128-logo.height*ratio/2,logo.width*ratio,logo.height*ratio);
  ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#fff';ctx.font='700 38px INEXCPlex,Arial,sans-serif';ctx.fillText(m.title,800,118,660);
  ctx.direction='ltr';ctx.textAlign='left';ctx.fillStyle='#d8ebff';ctx.font='500 19px Arial,sans-serif';ctx.fillText('INEXC MEMBERSHIP CARD',86,163);
  ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#fff';
  let size=55;do{ctx.font=`700 ${size}px INEXCPlex,Arial,sans-serif`;if(ctx.measureText(m.name).width<=1015)break;size-=2}while(size>35);
  ctx.fillText(m.name,1100,300,1015);
  ctx.fillStyle='#e2f0ff';ctx.font='500 30px INEXCPlex,Arial,sans-serif';ctx.fillText(m.specialty,1100,370,980);
  ctx.fillStyle='#fff';round(24,504,1152,102,[0,0,34,34]);
  ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#143e6d';ctx.font='700 29px INEXCPlex,Arial,sans-serif';ctx.fillText('شركة التميز الابتكاري للتعليم والتدريب',1100,565,935);
  ctx.direction='ltr';ctx.textAlign='left';ctx.fillStyle='#587da5';ctx.font='700 17px Arial,sans-serif';ctx.fillText('INEXC',86,564);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw Error('تعذر حفظ صورة المشاركة.');return blob;
 }
 function downloadPNG(blob,number,demo=false){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='INEXC-card-'+String(number).replace(/[^A-Za-z0-9_-]/g,'')+(demo?'-PREVIEW':'')+'.png';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 function bind(target,data,options={}){
  const root=target.matches?.('.tc-root')?target:target.querySelector('.tc-root');if(!root)return;
  const m=model(data,options),feedback=root.querySelector('.tc-feedback');
  root.querySelectorAll('.tc-avatar img').forEach(img=>img.addEventListener('error',()=>{img.parentElement.textContent=m.initials;},{once:true}));
  root.querySelectorAll('[data-tc-action]').forEach(button=>button.addEventListener('click',async()=>{
   feedback.textContent='';feedback.classList.remove('is-error');
   if(button.dataset.tcAction==='print'){
    const card=root.querySelector('.tc-card'),cleanup=()=>{document.body.classList.remove('tc-printing');card.classList.remove('tc-print-target');window.removeEventListener('afterprint',cleanup)};
    document.querySelectorAll('.tc-print-target').forEach(n=>n.classList.remove('tc-print-target'));card.classList.add('tc-print-target');document.body.classList.add('tc-printing');window.addEventListener('afterprint',cleanup,{once:true});
    try{await document.fonts?.ready;window.print();}catch{cleanup();feedback.textContent='تعذّر فتح الطباعة. جرّب تحميل البطاقة.';}return;
   }
   button.disabled=true;
   try{if(button.dataset.tcAction==='copy'){await navigator.clipboard.writeText(m.url);feedback.textContent='تم نسخ رابط البطاقة.';}
    if(button.dataset.tcAction==='download'){downloadPNG(await pngFile(data,options),m.id,m.demo);feedback.textContent='تم تجهيز البطاقة كصورة PNG.';}
   }catch(error){feedback.classList.add('is-error');feedback.textContent=button.dataset.tcAction==='copy'?'انسخ الرابط: '+m.url:error.message||'تعذّر إتمام العملية. أعد المحاولة.';}
   finally{button.disabled=false;}
  }));
 }
 global.TraineeCard={render,renderCard:(data,options={})=>visual(model(data,options)),bind,model,qrMarkup,svgFile,pngFile,socialPreviewPNG,downloadPNG,mount(target,data,options={}){target.innerHTML=render(data,options);bind(target,data,options)}};
})(window);
