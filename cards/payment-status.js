// Only the authenticated server-to-Stripe result can confirm a membership purchase.
(()=>{
 const packageText=value=>String(value??'').replaceAll('بطاق','باق');
const el=id=>document.getElementById(id),fragment=new URLSearchParams(location.hash.slice(1));let credentials,busy=false,polls=0,timer;
 if(fragment.has('checkout')&&fragment.has('token')){credentials={checkout:fragment.get('checkout'),token:fragment.get('token'),cancelled:fragment.get('cancelled')==='1'};try{sessionStorage.setItem('inexc_membership_payment_result',JSON.stringify(credentials))}catch{}history.replaceState(null,'',location.pathname)}else{try{credentials=JSON.parse(sessionStorage.getItem('inexc_membership_payment_result'))}catch{}}
 async function refresh(){
  if(busy)return;clearTimeout(timer);if(!credentials){el('paymentTitle').textContent='افتح رابط متابعة طلب الباقة';el('paymentMessage').textContent='يمكنك العودة إلى الباقات أو التواصل معنا برقم الطلب.';el('checkPayment').hidden=true;return;}
  busy=true;el('checkPayment').disabled=true;
  try{
   const response=await fetch(window.INEXC_REGISTRATION_ENDPOINT+'/memberships/payment-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkout:credentials.checkout,token:credentials.token})}),data=await response.json();if(!response.ok)throw Error(data.error||'تعذّر التحقق. أعد المحاولة.');
   el('paymentDetails').hidden=false;el('paymentPlan').textContent=packageText(data.planName);el('paymentReference').textContent=data.reference;el('paymentAmount').textContent='المبلغ: '+Number(data.amount).toLocaleString('ar-AE')+' USD';el('resumePayment').hidden=true;
   if(data.state==='paid'){
    el('paymentTitle').textContent=data.cardNumber?'تم الدفع وتفعيل باقتك':'تم الدفع — الطلب قيد المراجعة';el('paymentMessage').textContent=data.cardNumber?'باقتك جاهزة: '+data.cardNumber+'. يمكنك استخدامها مع بريدك الإلكتروني لحجز الدورات المتاحة.':'تم استلام الدفع. تواصل معنا برقم الطلب لمراجعة إصدار الباقة.';
    el('checkPayment').hidden=!!data.cardNumber;
    if(data.cardUrl){const url=new URL(data.cardUrl);if(url.origin===location.origin&&url.pathname==='/my-card/'){el('backToRegistration').href=url.href;el('backToRegistration').textContent='عرض باقتي التدريبية'}}
    try{sessionStorage.removeItem('inexc_membership_payment_attempt');sessionStorage.removeItem('inexc_membership_purchase_draft')}catch{}
   }else if(data.state==='expired'){
    el('paymentTitle').textContent='لم يكتمل الدفع';el('paymentMessage').textContent='انتهت صفحة الدفع أو تعذّرت العملية. يمكنك العودة لاختيار طريقة الدفع المناسبة.';try{sessionStorage.removeItem('inexc_membership_payment_attempt')}catch{}
   }else{
    el('paymentTitle').textContent=credentials.cancelled?'لم يكتمل الدفع بعد':'بانتظار تأكيد الدفع';el('paymentMessage').textContent='يمكنك متابعة الدفع أو العودة لاختيار التحويل البنكي. إذا خُصم المبلغ، حدّث الحالة قبل بدء عملية أخرى.';
    if(/^https:\/\/checkout\.stripe\.com\//.test(data.paymentLink||'')){el('resumePayment').href=data.paymentLink;el('resumePayment').hidden=false;}
    if(!credentials.cancelled&&polls++<8)timer=setTimeout(refresh,3000);
   }
  }catch(error){el('paymentTitle').textContent='تعذّر التحقق من الدفع';el('paymentMessage').textContent=error.message}finally{busy=false;el('checkPayment').disabled=false}
 }
 el('checkPayment').onclick=refresh;void refresh();
})();
