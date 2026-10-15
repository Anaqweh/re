(function(){
 'use strict';
 const params=new URLSearchParams(location.search),root=document.getElementById('publicIdRoot');
 const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
 const loadScript=src=>new Promise((resolve,reject)=>{const node=document.createElement('script');const finish=error=>{clearTimeout(timer);node.onload=node.onerror=null;if(error){node.remove();reject(error)}else resolve()};const timer=setTimeout(()=>finish(Error('انتهت مهلة الاتصال بخدمة بيانات المتدربين. أعد المحاولة.')),12000);node.src=src;node.onload=()=>finish();node.onerror=()=>finish(Error('تعذر الاتصال بخدمة بيانات المتدربين.'));document.head.append(node)});
 const demo={profile:{id:'preview',full_name:'سارة محمد عبدالله',specialty:'التعليم وتطبيقات الذكاء الاصطناعي'},digitalId:{idNumber:'INEXC-DEMO-001',tierKey:'silver',trainingHours:40},professionalValue:{overallReadiness:100},certificates:[{course_name:'الذكاء الاصطناعي في التعليم',certificate_number:'DEMO-CERT-001'},{course_name:'تصميم تجارب تعلّم رقمية',certificate_number:'DEMO-CERT-002'}]};
 function error(message){root.innerHTML='<section class="tc-panel tc-page-error"><div class="tc-status-icon" style="margin-inline:auto">!</div><h2>تعذّر عرض البطاقة</h2><p></p><a class="tc-btn primary" href="digital-id.html">التحقق من رابط آخر</a><button class="tc-btn" id="retryCard" type="button">إعادة المحاولة</button></section>';root.querySelector('p').textContent=message;document.getElementById('retryCard').onclick=()=>location.reload();}
 if(params.get('preview')==='1'){
  document.getElementById('previewNotice').hidden=false;
  if(params.get('embedded')==='1'){document.querySelector('.tc-header').hidden=true;document.getElementById('cardIntro').hidden=true;document.getElementById('previewNotice').hidden=true;document.querySelector('.tc-page-footer').hidden=true;document.querySelector('.tc-page-main').style.padding='12px';}
  if(params.get('device')==='phone'){root.innerHTML='<div style="width:min(100%,410px);margin:auto;padding:8px;background:#dbe9f8;border:1px solid #bacfe7;border-radius:26px"><iframe title="معاينة بطاقة المتدرب على الهاتف" src="digital-id.html?preview=1&amp;embedded=1" style="width:100%;height:1530px;border:0;border-radius:19px;background:#f5f8fc"></iframe></div>';return;}
  TraineeCard.mount(root,demo,{demo:true});return;
 }
 const profileId=params.get('id');
 if(!profileId){
  document.getElementById('cardLookup').onsubmit=event=>{event.preventDefault();const value=document.getElementById('cardReference').value.trim();let id=value;
   try{if(value.includes('://'))id=new URL(value).searchParams.get('id')||'';}catch{id='';}
   if(!uuid.test(id)){document.getElementById('lookupError').textContent='أدخل رابط البطاقة الكامل أو رمز السجل الصحيح.';document.getElementById('cardReference').setAttribute('aria-invalid','true');return;}
   location.href='digital-id.html?id='+encodeURIComponent(id);
  };return;
 }
 if(!uuid.test(profileId)){error('الرابط غير مكتمل. افتح رابط البطاقة الأصلي أو امسح رمز QR مرة أخرى.');return;}
 root.innerHTML='<section class="tc-panel tc-loading" role="status"><div class="tc-spinner" aria-hidden="true"></div><p>جارٍ تحميل سجل البطاقة…</p></section>';
 (async()=>{try{
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');await loadScript('supabase-config.js');await loadScript('js/course-career-map.js');await loadScript('js/trainee-auth.js?v=20261016-card1');
  const payload=await TraineeAuth.withTimeout(TraineeAuth.loadPublicDigitalId(profileId),18000,'تعذر تحميل السجل في الوقت الحالي. أعد المحاولة بعد قليل.');
  if(!payload)throw Error('لم نجد سجلًا متاحًا لهذه البطاقة. تحقق من رابطك أو تواصل مع INEXC.');
  TraineeCard.mount(root,payload);document.title='بطاقة '+(payload.profile.full_name||'المتدرب')+' | INEXC';
 }catch(e){error(e.message||'تعذر تحميل سجل البطاقة. أعد المحاولة لاحقًا.');}})();
})();
