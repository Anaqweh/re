/* Card checkout: validate the current quote, debit atomically on the server. */
window.addEventListener('DOMContentLoaded',()=>{
 const API=window.INEXC_REGISTRATION_ENDPOINT,form=document.getElementById('registrationForm'),payment=document.getElementById('paymentArea');if(!API||!form||!payment)return;
 const el=id=>document.getElementById(id),course=()=>typeof selectedCourse!=='undefined'?selectedCourse:null,certificate=()=>typeof selectedCertificate!=='undefined'&&!!selectedCertificate;
 payment.insertAdjacentHTML('afterend','<div id="membershipPayment" class="field full" style="margin-top:14px"><label style="display:flex;align-items:center;gap:10px;border:1px solid #cfe3f8;border-radius:12px;padding:14px;background:#f7fbff"><input type="checkbox" id="useMembershipCard" style="width:20px;min-height:20px"> التسجيل باستخدام بطاقة INEXC</label><div id="membershipFields" hidden style="margin-top:10px;background:#f7fbff;border:1px solid #dcecff;border-radius:12px;padding:14px"><label for="membershipCode">رقم البطاقة</label><input id="membershipCode" dir="ltr" autocomplete="off" placeholder="رقم بطاقتك الصادرة" aria-describedby="membershipInfo"><p id="membershipInfo" class="hint" role="status">أدخل رقم البطاقة والبريد المرتبط بها، ثم تحقّق من الرصيد.</p><button id="verifyMembership" type="button" class="light">التحقق من الرصيد</button><p class="hint">لا يُخصم الرصيد عند التحقق. يتم الخصم بعد تأكيد التسجيل فقط.</p></div></div>');
 const use=el('useMembershipCard'),info=el('membershipInfo'),verify=el('verifyMembership'),receipt=el('receipt'),submit=el('submitButton');
 let quote=null,quoteKey='',serial=0,busy=false,capable=false;
 const fingerprint=()=>JSON.stringify([course()?.id||'',el('email').value.trim().toLowerCase(),el('membershipCode').value.trim().toUpperCase(),certificate()]);
 const clear=()=>{quote=null;quoteKey='';serial++;info.style.color='';info.textContent='أدخل رقم البطاقة والبريد المرتبط بها، ثم تحقّق من الرصيد.'};
 function sync(){
  const institutional=el('requestType')?.value==='institution',c=course(),unavailable=c?.membershipEnabled===false;
  el('membershipPayment').hidden=institutional||!c||unavailable;
  if(institutional||unavailable){
   const wasSelected=use.checked;use.checked=false;clear();el('membershipFields').hidden=true;el('paymentChoices').hidden=false;
   payment.style.display=institutional?'none':'';
   if(institutional)receipt.required=false;
   else if(wasSelected&&c){renderPayments();updateSummary()}
   return;
  }
  el('membershipFields').hidden=!use.checked||!c;
  if(quote&&quoteKey!==fingerprint())clear();
  if(!use.checked||!c)return;
  const fee=Number(quote?.certificateFee||0);
  payment.style.display=fee>0?'block':'none';el('paymentChoices').hidden=true;
  // The quote may follow a different course or a link-only payment selection.
  // Refresh the bank details even when ordinary bank payment was not selected.
  if(fee>0&&typeof renderBankDetails==='function')renderBankDetails();
  el('bankBox').classList.toggle('show',fee>0);receipt.required=fee>0;
  el('total').textContent=quote?quote.cost+' وحدة من البطاقة'+(fee>0?' + '+fee+' د.إ رسوم الشهادة':''):'تحقق من الرصيد أولًا';
  submit.textContent=busy?'جارٍ تأكيد التسجيل…':'تأكيد التسجيل بالبطاقة';
 }
 window.addEventListener('inexc:courses-ready',sync);
 const originalSummary=window.updateSummary;if(typeof originalSummary==='function')window.updateSummary=function(...args){const result=originalSummary.apply(this,args);sync();return result};
 use.addEventListener('change',()=>{clear();if(!use.checked){payment.style.display='';el('paymentChoices').hidden=false;if(course()&&typeof renderPayments==='function')renderPayments();if(course()&&typeof updateSummary==='function')updateSummary()}sync()});
 form.addEventListener('input',e=>{if(['email','membershipCode'].includes(e.target.id)){clear();sync()}});
 form.addEventListener('change',e=>{if(e.target.id==='course'||e.target.id==='requestType'||e.target.name==='certificate'){clear();if(!use.checked){el('paymentChoices').hidden=false;if(el('requestType')?.value!=='institution')payment.style.display=''}sync()}});
 const readiness=fetch(API+'/learner/capabilities',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{capable=d?.cardCheckout>=2;return capable}).catch(()=>false);
 verify.onclick=async()=>{if(busy)return;const requestId=++serial,current=fingerprint(),c=course();if(!c||!el('membershipCode').value.trim()||!el('email').value.trim())return info.textContent='اختر الدورة وأدخل رقم البطاقة والبريد الإلكتروني أولًا.';verify.disabled=true;info.textContent='جارٍ التحقق…';try{if(!await readiness)throw Error('يجري تفعيل التسجيل بالبطاقة. حاول لاحقًا أو استخدم طريقة الدفع الأخرى.');const r=await fetch(API+'/memberships/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:el('membershipCode').value.trim(),email:el('email').value.trim(),course_id:c.id,certificate:certificate()?'yes':'no'})}),d=await r.json();if(requestId!==serial||current!==fingerprint()||!use.checked)return;if(!r.ok)throw Error(d.error||'تعذّر التحقق من البطاقة.');quote=d;quoteKey=current;info.style.color='#24734f';info.textContent='رصيدك '+d.remainingBefore+' وحدة · تكلفة الحجز '+d.cost+' · المتبقي بعد الحجز '+d.remainingAfter+' وحدات.'+(d.certificateFee>0?' رسوم الشهادة بعد الخصم '+d.certificateFee+' د.إ. أرفق وصلها أدناه.':'');sync()}catch(e){if(requestId===serial){quote=null;quoteKey='';info.style.color='#ad3445';info.textContent=e.message;sync()}}finally{verify.disabled=false}};
 form.addEventListener('submit',async event=>{if(!use.checked)return;event.preventDefault();event.stopImmediatePropagation();if(busy)return;if(!capable||!quote||quoteKey!==fingerprint()){info.textContent='تحقّق من البطاقة لهذه الدورة قبل تأكيد التسجيل.';return}if(!form.reportValidity())return;const file=quote.certificateFee>0?receipt.files[0]:null;const receiptError=window.INEXCReceiptError(file,quote.certificateFee>0);if(receiptError){info.textContent=receiptError;return}busy=true;submit.disabled=true;use.disabled=true;verify.disabled=true;sync();try{const body=new FormData();for(const id of ['name','email','phone'])body.append(id,el(id).value.trim());body.append('course_id',course().id);body.append('certificate',certificate()?'yes':'no');body.append('payment_method','membership');body.append('membership_code',el('membershipCode').value.trim());body.append('expected_units',String(quote.cost));body.append('expected_certificate_fee',String(quote.certificateFee||0));if(quote.certificateFee>0&&file)body.append('receipt',file);const r=await fetch(API+'/registrations',{method:'POST',body}),d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'تعذّر إكمال الحجز.'),{status:r.status});form.style.display='none';el('success').classList.add('show');el('reference').textContent='رقم تسجيلك: '+d.reference;el('successText').textContent=(d.alreadyRegistered?'أنت مسجّل بالفعل في هذه الدورة؛ لم نخصم وحدات إضافية.':'تم تأكيد التسجيل باستخدام البطاقة.')+' رصيدك المتبقي الآن: '+d.remaining+' وحدات.'+(d.certificateFee>0?' وصل رسوم الشهادة قيد المراجعة.':'');if(!el('learnerAccountLink'))el('success').insertAdjacentHTML('beforeend','<p><a id="learnerAccountLink" class="back" href="/account.html">دوراتي وشهاداتي ورصيد بطاقتي ←</a></p>');sessionStorage.removeItem('inexc_membership_checkout')}catch(e){if(e.status===409)clear();info.style.color='#ad3445';info.textContent=e.message;info.scrollIntoView?.({block:'center',behavior:'smooth'})}finally{busy=false;submit.disabled=false;use.disabled=false;verify.disabled=false;sync()}},true);
 try{const saved=JSON.parse(sessionStorage.getItem('inexc_membership_checkout'));if(new URLSearchParams(location.search).get('membership')==='1'&&saved&&Date.now()-saved.createdAt<600000){for(const id of ['email','name','phone'])if(saved[id])el(id).value=saved[id];el('membershipCode').value=saved.code;use.checked=true;sync()}else if(saved)sessionStorage.removeItem('inexc_membership_checkout')}catch{}
 sync();
});
