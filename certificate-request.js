(()=>{'use strict';
 const el=id=>document.getElementById(id),API=window.INEXC_REGISTRATION_ENDPOINT,params=new URLSearchParams(location.hash.slice(1));
 const credentials={request:params.get('request')||'',token:params.get('token')||''};
 let record,busy=false,pollCount=0,pollTimer;
 const labels={requested:'تم طلب الشهادة',awaiting_payment:'بانتظار الدفع',paid:'مدفوع',no_fee:'مؤكد — دون رسوم',cancelled:'التسجيل ملغى'};
 async function call(path,body){const r=await fetch(API+'/certificate-requests/'+path,{method:'POST',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,...body})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'تعذّر تحميل الطلب. أعد المحاولة لاحقًا.');return data}
 function message(text){el('certMessage').textContent=text;el('certMessage').hidden=!text}
 function done(paid){el('certForm').hidden=true;el('certDone').hidden=false;el('certDoneTitle').textContent=paid?'تم سداد رسوم الشهادة بنجاح':'تم تأكيد بيانات الشهادة';el('certDoneText').textContent=paid?'سُجلت عملية الدفع على طلبك، ويمكن لفريق التدريب متابعة بيانات شهادتك.':'حُفظ الاسم بالعربية والإنجليزية على طلبك. لا توجد رسوم مستحقة لهذا الطلب.';message('')}
 function render(d){
  record=d;el('certContent').hidden=false;el('certCourse').textContent=d.courseName;el('certTitle').textContent=d.certificateName;el('certReference').textContent=d.reference;el('certState').textContent=labels[d.state]||'قيد المتابعة';el('certAmount').textContent=d.amount>0?new Intl.NumberFormat('ar-AE',{style:'currency',currency:'AED'}).format(d.amount):'دون رسوم';
  el('certArabic').value=d.arabicName||'';el('certEnglish').value=d.englishName||'';el('certArabic').readOnly=el('certEnglish').readOnly=d.namesLocked;el('certNamesConsent').checked=!!d.namesConfirmed;
  el('certContinue').textContent=d.amount===0?'تأكيد بيانات الشهادة':d.paymentLink?'استكمال الدفع الآمن':'المتابعة إلى الدفع الآمن';
  el('certPaymentNote').textContent=d.amount===0?'لا يلزم دفع أي مبلغ لهذا الطلب.':'سيظهر مبلغ الشهادة قبل تأكيد الدفع.';
  if(d.state==='paid'||d.state==='no_fee')return done(d.state==='paid');
  el('certContinue').disabled=d.state==='cancelled'||d.processing||d.amount>0&&!d.canPay;
  if(d.state==='cancelled')message('تم إلغاء تسجيل الدورة. تواصل مع الإدارة لمراجعة طلب الشهادة.');
  else if(d.processing){message('عملية الدفع قيد التأكيد. لا تسدّد مرة أخرى؛ سنحدّث الحالة عند وصول التأكيد.');if(pollCount++<12)pollTimer=setTimeout(refresh,5000)}
  else if(d.amount>0&&!d.canPay)message('الدفع الإلكتروني غير متاح حاليًا. تسجيلك في الدورة مؤكد؛ تواصل مع شؤون المتدربين.');
  else message(params.get('cancelled')?'لم يكتمل الدفع. يمكنك استكماله من هذه الصفحة؛ تسجيل الدورة ما زال مؤكدًا.':'');
 }
 async function refresh(){try{render(await call('status'))}catch(e){message(e.message)}}
 el('certForm').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!record)return;if(!el('certForm').reportValidity())return;busy=true;el('certContinue').disabled=true;el('certFormError').textContent='';el('certForm').setAttribute('aria-busy','true');
  try{const d=await call('checkout',{arabicName:el('certArabic').value,englishName:el('certEnglish').value});if(d.state==='paid'||d.state==='no_fee'){render({...record,state:d.state,namesConfirmed:true});return}if(d.paymentLink){const u=new URL(d.paymentLink);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('تعذّر التحقق من رابط الدفع.');location.assign(u.href);return}await refresh()}
  catch(err){el('certFormError').textContent=err.message}
  finally{busy=false;el('certForm').removeAttribute('aria-busy');if(!el('certForm').hidden)el('certContinue').disabled=record?.processing||record?.state==='cancelled'||record?.amount>0&&!record?.canPay}
 });
 window.addEventListener('pagehide',()=>clearTimeout(pollTimer));
 if(!/^[a-f\d-]{36}$/i.test(credentials.request)||!/^[a-f\d]{64}$/.test(credentials.token))message('افتح الرابط الخاص الوارد في رسالة طلب الشهادة على بريدك الإلكتروني.');else refresh();
})();
