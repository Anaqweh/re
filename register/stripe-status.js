/* This page cannot confirm a payment by URL parameters; it only displays the server's verified state. */
(()=>{
 const el=id=>document.getElementById(id),fragment=new URLSearchParams(location.hash.slice(1));let credentials,polls=0,busy=false,timer;
 if(fragment.has('checkout')&&fragment.has('token')){credentials={checkout:fragment.get('checkout'),token:fragment.get('token'),cancelled:fragment.get('cancelled')==='1'};try{sessionStorage.setItem('inexc_stripe_result',JSON.stringify(credentials))}catch{}history.replaceState(null,'',location.pathname);}
 else{try{credentials=JSON.parse(sessionStorage.getItem('inexc_stripe_result'))}catch{}}
 try{const draft=JSON.parse(sessionStorage.getItem('inexc_stripe_draft'));if(draft?.course_id)el('backToRegistration').href='/register/?course_id='+encodeURIComponent(draft.course_id)+'&resume=stripe'}catch{}
 async function refresh(){
  if(busy)return;clearTimeout(timer);
  if(!credentials){el('paymentTitle').textContent='افتح رابط متابعة الدفع الخاص بطلبك';el('paymentMessage').textContent='لم نتمكن من تحديد العملية. يمكنك الرجوع إلى التسجيل أو التواصل مع فريق INEXC برقم طلبك.';el('checkPayment').hidden=true;return;}
  busy=true;el('checkPayment').disabled=true;
  try{
   const response=await fetch(window.INEXC_REGISTRATION_ENDPOINT+'/payments/stripe/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkout:credentials.checkout,token:credentials.token})}),data=await response.json();
   if(!response.ok)throw Error(data.error||'تعذّر التحقق الآن. اضغط تحديث حالة الدفع.');
   el('paymentDetails').hidden=false;el('paymentCourse').textContent=data.courseName;el('paymentReference').textContent=data.reference;el('paymentAmount').textContent='المبلغ: '+Number(data.amount).toLocaleString('ar-AE')+' د.إ';
   el('resumePayment').hidden=true;
   if(data.state==='paid'){
    el('paymentTitle').textContent='تم الدفع بنجاح';
    el('paymentMessage').textContent=data.registrationStatus==='ملغى'?'تم استلام الدفع، لكن التسجيل ملغى. تواصل مع الإدارة برقم الطلب لمراجعة حالته.':'تم تأكيد الدفع وتسجيلك في الدورة. احتفظ برقم الطلب للرجوع إليه.';
    el('checkPayment').hidden=true;el('backToRegistration').href='/account.html';el('backToRegistration').textContent='صفحتي التدريبية';
    try{sessionStorage.removeItem('inexc_stripe_attempt');sessionStorage.removeItem('inexc_stripe_draft')}catch{}
   }else if(data.state==='expired'){
    el('paymentTitle').textContent='انتهت مهلة صفحة الدفع';el('paymentMessage').textContent='لم يتم تأكيد دفع لهذه العملية. يمكنك العودة إلى التسجيل لبدء عملية جديدة.';
    try{sessionStorage.removeItem('inexc_stripe_attempt')}catch{}
   }else{
    el('paymentTitle').textContent=credentials.cancelled?'لم يكتمل الدفع بعد':'بانتظار تأكيد الدفع';
    el('paymentMessage').textContent=credentials.cancelled?'يمكنك العودة إلى صفحة الدفع الآمنة لإكمال العملية، أو الرجوع إلى التسجيل لاختيار طريقة أخرى.':'لم يصل تأكيد نهائي للعملية بعد. نحدّث الحالة تلقائيًا؛ لا تبدأ عملية دفع أخرى إذا كان المبلغ قد خُصم.';
    if(/^https:\/\/checkout\.stripe\.com\//.test(data.paymentLink||'')){el('resumePayment').href=data.paymentLink;el('resumePayment').hidden=false;}
    if(!credentials.cancelled&&polls++<8)timer=setTimeout(refresh,3000);
   }
  }catch(error){el('paymentTitle').textContent='تعذّر التحقق من الدفع الآن';el('paymentMessage').textContent=error.message;}
  finally{busy=false;el('checkPayment').disabled=false;}
 }
 el('checkPayment').onclick=refresh;void refresh();
})();
