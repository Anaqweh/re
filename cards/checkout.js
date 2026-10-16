const API = window.INEXC_REGISTRATION_ENDPOINT;
let plans = [];
const esc = v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function description(p) {
  if (p.featureLines) return p.featureLines.split('\n').map(x => x.trim()).filter(Boolean);
  const list = [];
  if (p.slug === 'launch') list.push('حجز دورتين أو دبلومين مباشرين أونلاين');
  if (p.slug === 'mastery') list.push('3 حجوزات تدريبية مباشرة أونلاين');
  if (p.slug === 'leadership') list.push('6 دورات أو حتى 5 دبلومات مباشرة أونلاين');
  list.push('صلاحية ' + p.validMonths + (p.validMonths === 12 ? ' شهرًا' : ' أشهر'));
  if (p.certificateDiscount) list.push('خصم ' + p.certificateDiscount + '% على رسوم الشهادات');
  if (p.earlyAccessHours) list.push('حجز مبكر قبل العامة بـ' + p.earlyAccessHours + ' ساعة');
  if (p.perks) list.push(p.perks);
  return [...new Set(list)];
}
function availability(p) {
  const remaining=Math.max(0,Number(p.remaining)||0),maximum=Math.max(1,Number(p.maxCards)||1);
  const mode=p.stockMode||'count',urgent=remaining>0&&remaining<=Number(p.lowStockThreshold??15);
  const message=remaining===0?'اكتمل إصدار هذه البطاقة':urgent?p.lowStockLabel||'اقترب اكتمال الإصدار':p.stockLabel||'فرصتك ما زالت متاحة';
  if(mode==='hidden'&&remaining>0)return '';
  const number=mode==='limited'&&remaining>0?'<span class="availability-copy">'+esc(urgent?'عدد محدود جدًا من البطاقات':'إصدار محدود — احجز بطاقتك')+'</span>':'<span class="availability-number">'+remaining+' <small>بطاقة متاحة</small></span>';
  return '<div class="availability '+(remaining===0?'sold-out':urgent?'urgent':mode==='limited'?'quiet':'')+'" role="status"><div class="availability-top"><span class="availability-copy">'+esc(message)+'</span>'+number+'</div>'+(mode==='count'&&remaining>0?'<div class="availability-track" aria-hidden="true"><i style="width:'+Math.min(100,Math.round(remaining/maximum*100))+'%"></i></div>':'')+'</div>';
}
function render() {
  const host = document.getElementById('plans');
  host.innerHTML = plans.map(p => {
    const soldOut = p.remaining <= 0;
    const items = description(p).map(x => '<li>' + esc(x) + '</li>').join('');
    return '<article class="plan ' + ((p.featured ?? (p.slug === 'mastery')) ? 'featured' : '') + '">' +
      ((p.badgeText ?? (p.slug === 'mastery' ? 'الأكثر توازنًا' : '')) ? '<span class="ribbon">'+esc(p.badgeText ?? 'الأكثر توازنًا')+'</span>' : '') +
      '<h2>' + esc(p.name) + '</h2><div class="price">$ ' + Number(p.priceUsd).toLocaleString('en-US') + '</div>' +
      availability(p) +
      '<ul class="features">' + items + '</ul>' +
      '<button class="buy" data-plan="' + p.id + '"' + (soldOut ? ' disabled' : '') + '>' + (soldOut ? 'نفدت البطاقات' : 'احصل على البطاقة') + '</button></article>';
  }).join('');
  host.querySelectorAll('[data-plan]').forEach(button => button.onclick = () => openPlan(button.dataset.plan));
}
let paymentOptions={electronicEnabled:false,bankConfigured:false,bank:{}},busy=false,currentPlan;
const el=id=>document.getElementById(id),selectedMethod=()=>document.querySelector('[name=method]:checked')?.value;
function syncMethod(){
 const bank=selectedMethod()==='bank';el('bankDetails').hidden=!bank;el('receipt').required=bank;
 el('submitText').textContent=busy?'جارٍ تجهيز الطلب…':bank?'إرسال الطلب ورفع الإيصال':'المتابعة إلى الدفع الآمن';el('submit').disabled=busy||!selectedMethod();
 el('paymentAssurance').textContent=bank?'تُراجع بيانات التحويل قبل تفعيل بطاقتك.':'تُستكمل بيانات البطاقة البنكية على صفحة الدفع الآمنة.';
 document.querySelectorAll('[name=method]').forEach(input=>input.disabled=busy||input.closest('label').hidden);el('close').disabled=busy;el('orderForm').setAttribute('aria-busy',String(busy));
}
function openPlan(id){
 const p=plans.find(x=>x.id===id);if(!p||busy)return;currentPlan=p;el('planId').value=id;el('modalTitle').textContent='إتمام شراء البطاقة';
 el('modalInfo').textContent='أكمل بياناتك واختر طريقة الدفع المناسبة لك.';
 el('summaryPlan').textContent=p.name;el('summaryPrice').textContent=Number(p.priceUsd).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 el('summaryDuration').textContent=Number(p.validMonths)+(Number(p.validMonths)>=3&&Number(p.validMonths)<=10?' أشهر':' شهرًا');el('durationRow').hidden=!Number(p.validMonths);
 const enabled=p.paymentMethods||['bank'];document.querySelectorAll('[name=method]').forEach(input=>{const available=enabled.includes(input.value)&&(input.value==='stripe'?paymentOptions.electronicEnabled:paymentOptions.bankConfigured);input.closest('label').hidden=!available;input.disabled=!available;input.checked=false});
 const first=document.querySelector('[name=method]:not(:disabled)');if(first)first.checked=true;
 const bank=paymentOptions.bank||{};for(const [id,key]of [['bankTitle','title'],['bankName','name'],['bankAccount','account'],['bankIban','iban']])el(id).textContent=bank[key]||'—';el('bankTitleRow').hidden=!bank.title;
 document.querySelectorAll('[data-copy]').forEach(button=>button.disabled=!bank[button.dataset.copy==='bankAccount'?'account':'iban']);
 el('bankAmount').textContent='قيمة البطاقة: '+Number(p.priceUsd).toLocaleString('ar-AE')+' USD';el('copyStatus').textContent='';
 el('message').textContent=first?'':'لا توجد وسيلة دفع متاحة حاليًا لهذه البطاقة. حاول لاحقًا أو تواصل معنا.';el('formView').style.display='block';el('success').classList.remove('show');syncMethod();el('dialog').setAttribute('aria-labelledby','modalTitle summaryPlan');el('dialog').showModal();el('dialog').scrollTop=0;
}
el('receipt').addEventListener('change',()=>{el('receiptName').textContent=el('receipt').files[0]?.name||'لم يُرفق ملف بعد'});
el('close').onclick=()=>{if(!busy)el('dialog').close()};el('dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault()});document.querySelectorAll('[name=method]').forEach(input=>input.onchange=()=>{el('message').textContent='';syncMethod()});
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const value=el(button.dataset.copy).textContent;try{await navigator.clipboard.writeText(value);el('copyStatus').textContent='تم النسخ.'}catch{el('copyStatus').textContent='تعذّر النسخ تلقائيًا. حدّد الرقم وانسخه يدويًا.'}});
function requestKey(data,file){
 const fingerprint=JSON.stringify({...data,...(data.payment_method==='bank'?{receipt:file?[file.name,file.size,file.lastModified]:null}:{})});let saved;try{saved=JSON.parse(sessionStorage.getItem('inexc_membership_payment_attempt'))}catch{}
 if(saved?.fingerprint===fingerprint&&Date.now()-saved.createdAt<3600000)return saved.key;
 const key=crypto.randomUUID();sessionStorage.setItem('inexc_membership_payment_attempt',JSON.stringify({fingerprint,key,createdAt:Date.now()}));return key;
}
el('orderForm').onsubmit=async event=>{
 event.preventDefault();if(busy)return;const method=selectedMethod();if(!method)return;if(!el('orderForm').reportValidity())return;
 const data={plan_id:el('planId').value,name:el('name').value.trim(),email:el('email').value.trim(),phone:el('phone').value.trim(),payment_method:method},file=el('receipt').files[0];
 if(method==='bank'&&(!file||file.size>5*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))){el('message').textContent='أرفق PDF أو صورة JPG أو PNG أو WEBP، بحد أقصى 5 MB.';return;}
 busy=true;syncMethod();el('message').textContent='';
 try{
  data.request_key=requestKey(data,file);sessionStorage.setItem('inexc_membership_purchase_draft',JSON.stringify({...data,createdAt:Date.now()}));
  let response;
  if(method==='stripe')response=await fetch(API+'/memberships/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  else{const body=new FormData();for(const [key,value]of Object.entries(data))body.append(key,value);body.append('receipt',file);response=await fetch(API+'/memberships/orders',{method:'POST',body});}
  const result=await response.json();if(!response.ok){if([409,410].includes(response.status))sessionStorage.removeItem('inexc_membership_payment_attempt');throw Error(result.error||'تعذّر تجهيز الطلب. أعد المحاولة.');}
  if(method==='stripe'){
   const url=new URL(result.paymentLink);if(url.protocol!=='https:'||(url.hostname!=='checkout.stripe.com'&&!(url.origin===location.origin&&url.pathname==='/cards/payment-status.html')))throw Error('تعذّر التحقق من رابط الدفع.');location.href=url.href;return;
  }
  sessionStorage.removeItem('inexc_membership_payment_attempt');sessionStorage.removeItem('inexc_membership_purchase_draft');el('formView').style.display='none';el('success').classList.add('show');el('successText').textContent='تم استلام وصل التحويل. بعد مراجعته وتأكيد وصول المبلغ ستصدر بطاقتك الرقمية وترتبط ببريدك الإلكتروني. رقم الطلب: '+result.reference;el('dialog').setAttribute('aria-labelledby','successHeading');el('successHeading').focus();
 }catch(error){el('message').textContent=error.message}finally{busy=false;syncMethod()}
};
async function loadPaymentOptions(){
 const response=await fetch(API+'/memberships/payment-options',{cache:'no-store'});
 if(response.ok)return response.json();
 if(response.status!==404)throw Error('تعذّر تحميل وسائل الدفع.');
 // During a staged API update, keep existing bank purchases available using public saved data.
 const coursesResponse=await fetch(API+'/courses');if(!coursesResponse.ok)throw Error('تعذّر تحميل بيانات البنك.');
 const courses=await coursesResponse.json(),banks=courses.map(c=>c.bank).filter(b=>b&&(b.account||b.iban));
 const unique=[...new Map(banks.map(b=>[JSON.stringify(b),b])).values()],bank=unique.length===1?unique[0]:{};
 return {version:0,electronicEnabled:false,bankConfigured:!!(bank.account||bank.iban),bank};
}
function followPlanLink(){
 const params=new URLSearchParams(location.search),booking=params.get('book'),id=booking||params.get('plan');if(!id)return;
 const button=[...document.querySelectorAll('#plans [data-plan]')].find(node=>node.dataset.plan===id);
 if(!button){const notice=document.createElement('p');notice.setAttribute('role','status');notice.textContent='البطاقة المطلوبة غير متاحة حاليًا. يمكنك استعراض البطاقات المتوفرة أدناه.';el('plans').before(notice);return;}
 const card=button.closest('.plan');card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'center',behavior:'auto'});
 // A link only opens the existing purchase form. Stock, pricing, payment
 // availability and order creation remain in their existing verified flow.
 if(booking&&!button.disabled)openPlan(id);
}
Promise.all([fetch(API+'/memberships/plans').then(r=>r.ok?r.json():Promise.reject()),loadPaymentOptions()])
 .then(([data,options])=>{plans=data;paymentOptions=options;const total=plans.reduce((sum,p)=>sum+Number(p.maxCards||0),0);document.querySelector('.hero .tag').textContent='إصدار عضوية محدود — '+total+' بطاقة';render();
  if(new URLSearchParams(location.search).get('resume')==='1'){try{const draft=JSON.parse(sessionStorage.getItem('inexc_membership_purchase_draft'));if(draft&&Date.now()-draft.createdAt<3600000&&plans.some(p=>p.id===draft.plan_id)){openPlan(draft.plan_id);for(const id of ['name','email','phone'])el(id).value=draft[id]||''}}catch{}}else followPlanLink();
 }).catch(()=>el('plans').innerHTML='<p>تعذّر تحميل البطاقات ووسائل الدفع الآن. أعد تحميل الصفحة لاحقًا.</p>');
