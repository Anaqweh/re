(()=>{'use strict';
const $=id=>document.getElementById(id),api=window.INEXC_REGISTRATION_ENDPOINT||'',plan=new URLSearchParams(location.search).get('plan')||'';
let courses=[],verified=null,busy=false;
const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('error',error)};
const money=value=>Number(value).toLocaleString('ar-AE',{maximumFractionDigits:2})+' د.إ';
const selectedCourse=()=>courses.find(course=>course.id===$('course').value);
function certificateChoice(){
 verified=null;$('certificate').value='no';
 const certificate=selectedCourse()?.certificate;
 $('certificateChoice').hidden=certificate?.mode!=='optional';
 $('certificateInfo').textContent=certificate?.mode==='optional'?(certificate.name+' — رسوم الشهادة: '+money(certificate.price)+'. يُرسل رابط استكمال الطلب والدفع إلى بريدك بعد تأكيد التسجيل.'):'';
}
if(!/^[a-f\d-]{36}$/i.test(plan)){notice('رابط الباقة المجانية غير صالح.',true);return}
fetch(api+'/memberships/free-course?plan='+encodeURIComponent(plan),{cache:'no-store'}).then(async response=>{
 const data=await response.json();if(!response.ok)throw Error(data.error||'تعذر عرض الدورات المجانية.');courses=data.courses||[];
 if(!courses.length){notice('لا توجد دورة مجانية متاحة للحجز بهذه الباقة حاليًا. ستظهر هنا عند إضافتها ونشرها.');return}
 // During the API rollout use the existing, certificate-aware registration page.
 if(data.certificateSelectionVersion!==1){notice('اختر الدورة والشهادة المطلوبة من صفحة التسجيل.');const link=document.createElement('a');link.href='/register/?course_id='+encodeURIComponent(courses[0].id);link.textContent='متابعة التسجيل واختيار الشهادة ←';$('notice').append(document.createElement('br'),link);return}
 const select=$('course');select.replaceChildren();courses.forEach(course=>{const option=document.createElement('option');option.value=course.id;option.textContent=course.name;select.append(option)});certificateChoice();$('lookup').hidden=false;
}).catch(error=>notice(error.message,true));
$('course').onchange=certificateChoice;
$('certificate').onchange=()=>{verified=null};
$('resendCard').onclick=async()=>{const button=$('resendCard');button.disabled=true;$('resendStatus').textContent='جارٍ إرسال الطلب…';try{const response=await fetch(api+'/learner/card-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value.trim()})}),data=await response.json();if(!response.ok)throw Error(data.error||'تعذر طلب رقم البطاقة.');$('resendStatus').textContent=data.message}catch(error){$('resendStatus').textContent=error.message}finally{button.disabled=false}};
$('lookup').onsubmit=async event=>{
 event.preventDefault();if(busy)return;busy=true;$('verify').disabled=true;notice('جارٍ التحقق من البطاقة…');
 try{
  const course=selectedCourse(),courseId=course.id,code=$('code').value.trim(),email=$('email').value.trim(),certificateRequested=course.certificate?.mode==='included'||course.certificate?.mode==='optional'&&$('certificate').value==='yes';
  const response=await fetch(api+'/memberships/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({course_id:courseId,code,email,certificate:certificateRequested})}),data=await response.json();
  if(!response.ok)throw Error(data.error||'تعذر التحقق من البطاقة.');
  if(Number(data.card?.plan?.priceUsd)!==0||data.card?.plan?.id!==plan)throw Error('هذه الصفحة مخصصة للباقة المجانية المرتبطة ببطاقتك.');
  if(!Number.isFinite(data.cost)||!Number.isFinite(data.certificateFee))throw Error('تعذر عرض رسوم الحجز. أعد التحقق من البطاقة.');
  verified={courseId,code,email,certificateRequested,expectedUnits:data.cost,expectedCertificateFee:data.certificateFee};
  $('verifiedCourse').textContent='الدورة: '+course.name;
  $('certificateSummary').hidden=false;
  $('certificateSummary').textContent=certificateRequested?'الشهادة: '+course.certificate.name+' — '+(data.certificateFee>0?'رسومها '+money(data.certificateFee)+'، وسيصلك رابط الدفع بالبريد الإلكتروني.':'دون رسوم. سيصلك رابط تأكيد بيانات الشهادة بالبريد الإلكتروني.'):'التسجيل في الدورة دون طلب شهادة.';
  $('lookup').hidden=true;$('decision').hidden=false;notice('');
 }catch(error){notice(error.message,true)}finally{busy=false;$('verify').disabled=false}
};
$('edit').onclick=()=>{if(busy)return;verified=null;$('decision').hidden=true;$('lookup').hidden=false;notice('')};
$('decline').onclick=()=>{$('decision').hidden=true;$('declined').hidden=false;notice('')};
$('return').onclick=()=>{verified=null;$('declined').hidden=true;$('lookup').hidden=false};
$('agree').onclick=async()=>{
 if(busy||!verified)return;busy=true;for(const id of ['agree','edit','decline'])$(id).disabled=true;notice('جارٍ تأكيد التسجيل…');
 try{
  const response=await fetch(api+'/memberships/free-course/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...verified,planId:plan,shareConsent:true})}),data=await response.json();
  if(!response.ok){if(data.alreadyRegistered){$('decision').hidden=true;$('existingHelp').hidden=false;$('lookup').hidden=false;}throw Error(data.error||'تعذر تأكيد التسجيل.')}
  $('decision').hidden=true;$('success').hidden=false;$('reference').textContent='رقم تسجيلك: '+data.reference;
  $('certificateSuccess').hidden=!data.certificateRequestId;
  $('certificateSuccess').textContent=data.certificateRequestId?'تم تسجيل طلب الشهادة. سيصلك خلال دقائق رابط خاص بالبريد الإلكتروني '+(Number(data.certificateFee)>0?'لتأكيد الاسم وسداد رسوم الشهادة: '+money(data.certificateFee):'لتأكيد بيانات الشهادة دون رسوم')+'.':'';notice('');
 }catch(error){notice(error.message,true)}finally{busy=false;for(const id of ['agree','edit','decline'])$(id).disabled=false}
};
})();
