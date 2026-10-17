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
  await Promise.all([document.fonts?.load('700 72px INEXCPlex'),document.fonts?.load('500 32px INEXCPlex')]);
  const logo=new Image();logo.src='/assets/inexc-approved-logo.jpg';await logo.decode();
  const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1260;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('تعذر تجهيز صورة المشاركة على هذا الجهاز.');
  ctx.scale(2,2);
  const round=(x,y,w,h,r)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()};
  const glow=(x,y,r,color)=>{const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'#0064e000');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2)};
  const bg=ctx.createLinearGradient(0,50,1200,580);bg.addColorStop(0,'#031231');bg.addColorStop(.48,'#043eaa');bg.addColorStop(1,'#0055df');ctx.fillStyle=bg;ctx.fillRect(0,0,1200,630);
  glow(710,6,470,'#0078ff90');glow(1230,500,420,'#03baff64');glow(320,370,260,'#075be655');
  ctx.lineWidth=1;ctx.strokeStyle='#3483ed20';for(let x=55;x<550;x+=76){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,548);ctx.stroke()}for(let y=64;y<548;y+=74){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(570,y);ctx.stroke()}
  ctx.strokeStyle='#038dff';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(-62,546,386,-Math.PI/2,0);ctx.stroke();
  ctx.beginPath();ctx.moveTo(940,0);ctx.bezierCurveTo(1130,110,740,290,1015,426);ctx.bezierCurveTo(1120,480,1145,535,1200,560);ctx.stroke();
  for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(1200,65+i*79);ctx.bezierCurveTo(1120,165+i*28,915,240+i*27,935,365+i*12);ctx.bezierCurveTo(945,430,1140,436+i*32,1200,520+i*20);ctx.strokeStyle=['#28caffc9','#76efffaa','#178affae','#0b7bf9aa'][i];ctx.lineWidth=2+i;ctx.stroke()}
  for(const [x,y] of [[131,187],[297,382],[133,276]]){glow(x,y,18,'#5beaffbb');ctx.fillStyle='#aff7ff';ctx.beginPath();ctx.arc(x,y,2.5,0,7);ctx.fill()}
  ctx.fillStyle='#fff';round(891,36,277,116,20);const ratio=Math.min(251/logo.width,106/logo.height);ctx.drawImage(logo,1029-logo.width*ratio/2,94-logo.height*ratio/2,logo.width*ratio,logo.height*ratio);
  ctx.direction='ltr';ctx.textAlign='left';ctx.fillStyle='#f4f8ff';ctx.font='500 18px Arial,sans-serif';ctx.fillText('I N E X C   M E M B E R S H I P',54,71);
  ctx.fillStyle='#3caaff';ctx.fillRect(54,90,36,1);
  ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#fff';let titleSize=70;do{ctx.font=`700 ${titleSize}px INEXCPlex,Arial,sans-serif`;if(ctx.measureText(m.title).width<645)break;titleSize-=2}while(titleSize>42);ctx.fillText(m.title,934,227,645);
  ctx.textAlign='left';ctx.direction='ltr';let nameSize=51;do{ctx.font=`700 ${nameSize}px INEXCPlex,Arial,sans-serif`;if(ctx.measureText(m.name).width<650)break;nameSize-=2}while(nameSize>30);ctx.fillText(m.name,334,314,650);
  ctx.direction='rtl';ctx.textAlign='right';ctx.font='600 23px INEXCPlex,Arial,sans-serif';ctx.fillText(m.specialty,850,362,535);
  ctx.strokeStyle='#02bbff';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(713,379,178,41,16);ctx.stroke();ctx.fillStyle='#fff';ctx.font='600 24px INEXCPlex,Arial,sans-serif';ctx.textAlign='center';ctx.fillText('بطاقة فعّالة',802,408,165);
  ctx.fillStyle='#fff';round(50,314,168,200,18);
  if(m.url&&global.INEXCQRCode){
   const modules=global.INEXCQRCode.create(m.url,{errorCorrectionLevel:'M'}).modules;
   const moduleSize=143/(modules.size+8);ctx.fillStyle='#072c71';
   for(let y=0;y<modules.size;y++)for(let x=0;x<modules.size;x++)if(modules.get(y,x))ctx.fillRect(62+(x+4)*moduleSize,326+(y+4)*moduleSize,moduleSize+.07,moduleSize+.07);
  }
  ctx.direction='rtl';ctx.textAlign='center';ctx.fillStyle='#07347d';ctx.font='700 17px INEXCPlex,Arial,sans-serif';ctx.fillText('افتح صفحة البطاقة',134,498,150);
  const tile=ctx.createLinearGradient(840,450,920,526);tile.addColorStop(0,'#00c9ff');tile.addColorStop(1,'#0846bc');ctx.fillStyle=tile;round(837,448,81,78,13);ctx.fillStyle='#d7f4ff';ctx.direction='ltr';ctx.textAlign='center';ctx.font='700 43px Arial,sans-serif';ctx.fillText('AI',878,503);
  ctx.strokeStyle='#afddff';ctx.beginPath();ctx.moveTo(934,467);ctx.lineTo(934,514);ctx.stroke();ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#fff';ctx.font='600 24px INEXCPlex,Arial,sans-serif';ctx.fillText('التميز الابتكاري',1099,484);ctx.fillText('للتعليم والتدريب',1099,513);
  ctx.strokeStyle='#a3d8ff99';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(30,547);ctx.lineTo(1170,547);ctx.stroke();
  ctx.direction='ltr';ctx.textAlign='left';ctx.fillStyle='#fff';ctx.font='500 18px Arial,sans-serif';ctx.fillText('I N E X C  ·  L E A R N I N G  C O N T I N U E S',53,590);
  ctx.font='700 22px Arial,sans-serif';ctx.fillText('◎  www.inexctraining.com',466,591);
  ctx.direction='rtl';ctx.textAlign='right';ctx.font='600 21px INEXCPlex,Arial,sans-serif';ctx.fillText(m.status,1152,590,285);
  ctx.strokeStyle='#0fc7ff';ctx.lineWidth=3;ctx.strokeRect(1.5,1.5,1197,627);
  // Keep the full resolution while reducing PNG entropy below the API upload limit.
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),channels=pixels.data;
  for(let i=0;i<channels.length;i+=4){channels[i]&=252;channels[i+1]&=252;channels[i+2]&=252}
  ctx.putImageData(pixels,0,0);
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
