/* Authenticated payment controls. Public pages and all checkout APIs enforce the saved course choices. */
(()=>{
 const $=id=>document.getElementById(id),api=window.INEXC_REGISTRATION_ENDPOINT,form=$('courseForm');if(!api||!form)return;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={stripe:'Stripe',bank:'التحويل البنكي',membership:'بطاقة INEXC',link:'رابط خارجي'};
 let ready=false,data,loading,generation=0;const rowDrafts=new Map();
 const tab=document.createElement('button');tab.type='button';tab.className='light';tab.dataset.view='payments';tab.textContent='طرق الدفع';document.querySelector('#app .tabs').append(tab);
 const panel=document.createElement('section');panel.id='payments';panel.className='view';panel.innerHTML=`
  <div class="payment-head"><div><h2>طرق الدفع</h2><p>اختر كيف يدفع المتدربون في كل دورة. يمكنك تشغيل طريقة واحدة أو أكثر، أو إيقافها جميعًا، وتطبيق اختيار موحد على جميع الدورات.</p></div><button class="primary" id="enableStripeEverywhere" type="button">تفعيل Stripe لجميع الدورات</button></div>
  <div class="payment-overview"><section class="panel"><h3>جاهزية الدفع الإلكتروني</h3><div id="stripeCheckStatus" class="payment-check-status" role="status">جارٍ قراءة إعدادات الدفع…</div><div class="payment-actions"><button class="light" id="checkStripeNow" type="button">فحص إنشاء صفحة الدفع</button></div><p class="payment-check-note">ينشئ الفحص جلسة داخلية لدى Stripe ويغلقها فورًا، دون تسجيل متدرب أو تحصيل مبلغ أو إرسال بريد.</p></section>
  <section class="panel"><h3>اختيار موحّد لجميع الدورات</h3><p>يستبدل الاختيار أدناه طرق الدفع الحالية في جميع الدورات المنشورة والمخفية. اختيار المربعات الثلاثة الأساسية يفعّل Stripe والتحويل البنكي وبطاقة INEXC معًا.</p><div class="payment-choices">${Object.entries(names).map(([key,label])=>`<label class="payment-choice"><input id="bulkPayment-${key}" type="checkbox" ${key!=='link'?'checked':''}>${label}</label>`).join('')}</div><label class="payment-defaults"><input id="paymentApplyToNew" type="checkbox" checked> اعتمادها أيضًا للدورات الجديدة</label><div class="payment-actions"><button class="primary" id="applyPaymentMethods" type="button">تطبيق على جميع الدورات</button><button class="light" id="selectAllPayments" type="button">اختيار الطرق الأساسية الثلاث</button><button class="light" id="clearAllPayments" type="button">إلغاء جميع الاختيارات</button></div><p class="payment-check-note">الرابط الخارجي يحتاج عنوانًا محفوظًا لكل دورة؛ Stripe ينشئ رابط الدفع تلقائيًا.</p></section></div>
  <div id="paymentGlobalMessage" role="status"></div><section class="panel payment-course-panel"><div class="payment-toolbar"><input id="paymentCourseSearch" type="search" placeholder="ابحث باسم الدورة" aria-label="البحث في طرق دفع الدورات"><span id="paymentCount"></span><button class="light" id="reloadCoursePayments" type="button">تحديث</button></div><div class="payment-table-wrap"><table class="payment-table"><thead><tr><th>الدورة</th><th>Stripe</th><th>تحويل بنكي</th><th>بطاقة INEXC</th><th>رابط خارجي</th><th>الحفظ</th></tr></thead><tbody id="paymentCourseRows"></tbody></table></div></section>`;
 document.querySelector('#app main').append(panel);
 const signedIn=()=>window.INEXCAdminSession?.valid?.()&&!!sessionStorage.getItem('inexc_do_admin');
 const message=(text,error=false)=>{$('paymentGlobalMessage').textContent=text;$('paymentGlobalMessage').dataset.error=String(error)};
 async function request(path,options={}){
  if(!signedIn())throw Error('سجّل الدخول إلى لوحة الإدارة أولًا.');
  const response=await fetch(api+path,{...options,cache:'no-store',headers:{Authorization:'Bearer '+sessionStorage.getItem('inexc_do_admin'),'Content-Type':'application/json'}}),result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(response.status===404?'يلزم تحديث خادم الموقع لتفعيل لوحة طرق الدفع.':result.error||'تعذّر حفظ إعدادات الدفع.');return result;
 }
 function applyDefaults(){if(!data?.defaults)return;for(const [id,method]of [['payStripe','stripe'],['payBank','bank'],['payLink','link']])$(id).checked=data.defaults.payments.includes(method);$('payMembership').checked=data.defaults.membershipEnabled;window.INEXCCourseCards?.reset();}
 function status(result){const target=$('stripeCheckStatus');target.replaceChildren();target.dataset.state=result.ready===true?'ready':result.ready===false?'error':'';target.textContent=result.message||(result.configured?'إعدادات Stripe موجودة. اضغط الفحص للتأكد من إمكانية إنشاء صفحة دفع.':'Stripe غير مهيّأ على الخادم.');if(result.diagnostic){const code=document.createElement('code');code.textContent=[result.diagnostic.stage,result.diagnostic.code,result.diagnostic.param,...(result.diagnostic.permissions||[])].filter(Boolean).join(' · ');target.append(code);}if(result.checkedAt){const time=document.createElement('small');time.textContent=' آخر فحص: '+new Date(result.checkedAt).toLocaleString('ar-AE');target.append(document.createElement('br'),time);}}
 function renderRows(){
  const selected=$('paymentCourseSearch').value.trim().toLowerCase(),rows=(data?.courses||[]).filter(c=>c.name.toLowerCase().includes(selected));$('paymentCount').textContent=rows.length+' دورة';
  $('paymentCourseRows').innerHTML=rows.map(c=>{const choices=rowDrafts.get(c.id)||c;return `<tr data-payment-course="${c.id}"><td><strong>${escape(c.name)}</strong><small>${c.active?'منشورة':'مخفية'} · ${Number(c.price).toLocaleString('ar-AE')} د.إ</small></td>${Object.entries(names).map(([key,label])=>`<td><input type="checkbox" data-method="${key}" aria-label="${escape(label+' — '+c.name)}" ${(key==='membership'?choices.membershipEnabled:choices.payments.includes(key))?'checked':''}>${key==='link'&&!c.paymentLink?'<small>لم يُضف رابط</small>':''}</td>`).join('')}<td><button class="light" data-save-payment="${c.id}" type="button">حفظ</button><div data-row-message role="status">${rowDrafts.has(c.id)?'تغييرات غير محفوظة':''}</div></td></tr>`}).join('')||'<tr><td colspan="6" class="payment-empty">لا توجد دورات مطابقة.</td></tr>';
 }
 function setData(result){data=result;ready=result.version===2;status(result.stripe);renderRows();}
 async function load(){
  if(!signedIn())return;if(loading)return loading;const current=generation;
  loading=(async()=>{try{const result=await request('/admin/course-payments');if(current!==generation)return;setData(result);for(const key of Object.keys(names))$('bulkPayment-'+key).checked=key==='membership'?result.defaults.membershipEnabled:result.defaults.payments.includes(key);if(!$('courseId').value&&!$('courseName').value)applyDefaults();}catch(error){if(current!==generation)return;ready=false;message(error.message,true);status({ready:false,message:error.message});}finally{if(current===generation)loading=null;}})();return loading;
 }
 function open(){document.querySelectorAll('#app .tabs button,#app .view').forEach(node=>node.classList.remove('active'));tab.classList.add('active');panel.classList.add('active');location.hash='payments';void load();}
 tab.onclick=open;$('openPaymentSettings').onclick=event=>{event.preventDefault();open()};$('reloadCoursePayments').onclick=()=>load();$('paymentCourseSearch').oninput=renderRows;
 function clearDraft(){window.INEXCAdminDrafts?.clear(panel)}
 async function update(input,button){
  if(!ready)return message('انتظر تحميل إعدادات الدفع أو حدّث الخادم أولًا.',true);button.disabled=true;const current=generation;
  try{const result=await request('/admin/course-payments',{method:'PUT',body:JSON.stringify(input)});if(current!==generation)return;rowDrafts.clear();clearDraft();setData(result);message('تم حفظ طرق الدفع لـ '+result.updated+' دورة. تظهر الاختيارات الجديدة في صفحة التسجيل.');void window.loadCourses?.({force:true});}
  catch(error){message(error.message,true)}finally{button.disabled=false}
 }
 $('enableStripeEverywhere').onclick=()=>update({scope:'all',action:'enable-stripe',applyToNew:true},$('enableStripeEverywhere'));
 $('applyPaymentMethods').onclick=()=>update({scope:'all',action:'replace',payments:['stripe','bank','link'].filter(key=>$('bulkPayment-'+key).checked),membershipEnabled:$('bulkPayment-membership').checked,applyToNew:$('paymentApplyToNew').checked},$('applyPaymentMethods'));
 $('selectAllPayments').onclick=()=>{for(const key of Object.keys(names))$('bulkPayment-'+key).checked=key!=='link'};
 $('clearAllPayments').onclick=()=>{for(const key of Object.keys(names))$('bulkPayment-'+key).checked=false};
 const rowChoices=row=>({payments:['stripe','bank','link'].filter(key=>row.querySelector('[data-method="'+key+'"]').checked),membershipEnabled:row.querySelector('[data-method="membership"]').checked});
 $('paymentCourseRows').onchange=event=>{const row=event.target.closest('[data-payment-course]');if(!row)return;rowDrafts.set(row.dataset.paymentCourse,rowChoices(row));row.querySelector('[data-row-message]').textContent='تغييرات غير محفوظة'};
 $('paymentCourseRows').onclick=async event=>{
  const button=event.target.closest('[data-save-payment]');if(!button)return;const row=button.closest('tr'),out=row.querySelector('[data-row-message]');button.disabled=true;out.textContent='جارٍ الحفظ…';const current=generation;
  try{const result=await request('/admin/course-payments',{method:'PUT',body:JSON.stringify({courseId:button.dataset.savePayment,...rowChoices(row)})});if(current!==generation)return;rowDrafts.delete(button.dataset.savePayment);data=result;out.dataset.error='false';out.textContent='تم الحفظ';void window.loadCourses?.({force:true});}catch(error){out.dataset.error='true';out.textContent=error.message;}finally{button.disabled=false}
 };
 $('checkStripeNow').onclick=async()=>{const button=$('checkStripeNow');button.disabled=true;status({message:'جارٍ إنشاء جلسة فحص وإغلاقها…'});const current=generation;try{const result=await request('/admin/course-payments/stripe-check',{method:'POST',body:'{}'});if(current===generation)status(result);}catch(error){if(current===generation)status({ready:false,message:error.message})}finally{button.disabled=false}};
 form.addEventListener('submit',event=>{if(ready)return;event.preventDefault();event.stopImmediatePropagation();$('courseError').textContent='إعدادات الدفع لم تُحمّل بعد. افتح «طرق الدفع» واضغط تحديث، أو حدّث خادم الموقع.';void load();},true);
 window.INEXCPaymentsAdmin={applyDefaults,refresh:load,ready:()=>ready};
 window.addEventListener('inexc:unlocked',()=>{void load()});window.addEventListener('inexc:locked',()=>{generation++;ready=false;data=null;loading=null;$('paymentCourseRows').replaceChildren();message('');status({message:'سجّل الدخول لعرض إعدادات الدفع.'});});
 if(signedIn())void load();if(location.hash==='#payments'&&signedIn())open();
})();
