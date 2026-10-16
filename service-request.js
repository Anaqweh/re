/* Dedicated service enquiries; never calls course, registration, payment or mail routes. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),base=window.INEXC_REGISTRATION_ENDPOINT,serviceId=new URLSearchParams(location.search).get('service')||'';
 const form=$('serviceRequestForm'),status=$('requestStatus'),fields=['name','email','phone','organization','details','preferred_timing'];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let ready=false,pending=false,requestId=crypto.randomUUID(),sequence=0;
 async function load(){const current=++sequence;ready=false;form.hidden=true;$('requestService').hidden=true;$('requestRecovery').hidden=true;status.hidden=false;status.textContent='جارٍ تحميل الخدمة…';
  try{
   if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(serviceId))throw Error('رابط الخدمة غير مكتمل. اختر الخدمة من صفحة الخدمات.');
   const response=await fetch(base+'/services',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('تعذر تحميل الخدمة الآن. حاول مجددًا.');
   const data=await response.json();if(current!==sequence)return;
   if(data.version!==1||!Array.isArray(data.items))throw Error('تعذر تحميل الخدمة الآن. حاول مجددًا.');
   const record=data.items.find(r=>r.id.toLowerCase()===serviceId.toLowerCase()&&r.published===true);if(!record)throw Error('هذه الخدمة غير متاحة للطلب حاليًا. يمكنك استعراض خدماتنا الأخرى.');
   $('requestTitle').textContent='طلب '+record.name;document.title='طلب '+record.name+' | INEXC';$('requestServiceName').textContent=record.name;$('requestSummary').textContent=record.summary;$('requestCategory').textContent=record.category||'خدمات INEXC';
   $('requestServiceMeta').innerHTML=[['طريقة التقديم',record.delivery],['مدة التنفيذ',record.duration],['السعر',record.price_text]].filter(([,v])=>v).map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');$('requestService').hidden=false;
   if(data.requestLinks!==1)throw Error('نموذج طلب الخدمة غير متاح مؤقتًا. يرجى المحاولة لاحقًا.');
   ready=true;form.hidden=false;status.hidden=true;
  }catch(e){if(current!==sequence)return;status.textContent=e.name==='TimeoutError'?'استغرق الاتصال وقتًا أطول من المتوقع. حاول مجددًا.':e.message||'تعذر تحميل الخدمة. حاول مجددًا.';$('requestRecovery').hidden=false}
 }
 form.onsubmit=async e=>{e.preventDefault();if(!ready||pending||!form.reportValidity())return;
  const data={id:requestId,...Object.fromEntries(fields.map(k=>[k,form.elements.namedItem(k).value.trim()]))};
  if(['name','email','phone','details'].some(k=>!data[k])){$('requestError').textContent='أدخل بيانات التواصل وتفاصيل طلبك.';return}
  pending=true;$('requestSubmit').disabled=true;$('requestSubmit').textContent='جارٍ إرسال الطلب…';$('requestError').textContent='';
  try{const response=await fetch(base+'/services/'+encodeURIComponent(serviceId)+'/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'تعذر تأكيد استلام الطلب. أعد المحاولة.');if(!result.ok||typeof result.reference!=='string'||!result.reference)throw Error('تعذر تأكيد استلام الطلب. أعد المحاولة.');
   ready=false;form.hidden=true;$('requestReference').textContent=result.reference;$('requestSuccess').hidden=false;$('requestSuccess').focus();
  }catch(e){$('requestError').textContent=e.name==='TimeoutError'||e instanceof TypeError?'تعذر تأكيد استلام الطلب بسبب الاتصال. أعد المحاولة بنفس البيانات؛ لن يتكرر طلبك.':e.message}
  finally{pending=false;$('requestSubmit').disabled=false;$('requestSubmit').textContent='إرسال طلب الخدمة ←'}
 };
 $('requestRetry').onclick=load;load();
})();
