window.addEventListener('DOMContentLoaded',async()=>{
 const el=id=>document.getElementById(id),API=window.INEXC_REGISTRATION_ENDPOINT,id=new URLSearchParams(location.search).get('course_id'),form=el('feedbackForm');let attempt=null,busy=false;
 if(!API||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')){el('courseName').textContent='رابط التقييم غير صالح';el('pageStatus').textContent='استخدم رابط التقييم الذي وصلك من إدارة الدورة.';return}
 try{const response=await fetch(API+'/course-feedback/'+encodeURIComponent(id),{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'تعذّر تحميل الدورة.');el('courseName').textContent=data.name;document.title='رأيك في '+data.name+' | INEXC';form.hidden=false;el('backToCourse').href='/course/?id='+encodeURIComponent(id);el('backToCourse').hidden=false}catch{el('courseName').textContent='تعذّر فتح نموذج التقييم';el('pageStatus').textContent='قد يكون الرابط غير متاح حاليًا. أعد المحاولة لاحقًا أو تواصل مع إدارة الدورة.';return}
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  const body={name:el('reviewName').value.trim(),content:el('reviewContent').value.trim(),rating:Number(el('reviewRating').value),consent:el('reviewConsent').checked,website:el('website').value};
  if(body.name.length<2||body.content.length<10){el('formStatus').textContent='اكتب اسمًا من حرفين على الأقل ورأيًا من 10 أحرف على الأقل.';return}
  const fingerprint=JSON.stringify(body),key='inexc_feedback_attempt_'+id;
  try{if(!attempt)attempt=JSON.parse(sessionStorage.getItem(key))}catch{}
  if(!attempt||attempt.fingerprint!==fingerprint){attempt={fingerprint,requestKey:crypto.randomUUID()};try{sessionStorage.setItem(key,JSON.stringify(attempt))}catch{}}
  busy=true;el('sendFeedback').disabled=true;el('sendFeedback').textContent='جارٍ إرسال رأيك…';el('formStatus').textContent='';
  try{const response=await fetch(API+'/course-feedback/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestKey:attempt.requestKey})});const data=await response.json();if(!response.ok||data.ok!==true)throw Error(data.error||'تعذّر تأكيد الإرسال. حاول مرة أخرى.');form.hidden=true;el('feedbackSuccess').hidden=false;el('feedbackSuccess').focus();}
  catch(error){el('formStatus').textContent=error.message||'تعذّر تأكيد الإرسال. بياناتك ما زالت هنا؛ حاول مرة أخرى.'}
  finally{busy=false;el('sendFeedback').disabled=false;el('sendFeedback').textContent='إرسال الرأي للمراجعة'}
 });
});
