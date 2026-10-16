/* اتصال نموذج التسجيل بواجهة INEXC الخاصة على DigitalOcean. */
window.addEventListener('DOMContentLoaded', async () => {
  const endpoint = window.INEXC_REGISTRATION_ENDPOINT || '';
  const form = document.getElementById('registrationForm');
  if (!endpoint || !form) return;

  const courseField = document.getElementById('course')?.closest('.field');
  const certificateArea = document.getElementById('certificateArea');
  const summary = document.querySelector('.summary');
  const paymentArea = document.getElementById('paymentArea');
  const courseSelect = document.getElementById('course');
  const regularTitle = form.querySelector('.section-title');
  const requestType = new URLSearchParams(window.location.search).get('type') === 'institution' ? 'institution' : 'individual';
  const emailField = document.getElementById('email')?.closest('.field');
  if (emailField && !document.getElementById('requestType')) {
    emailField.insertAdjacentHTML('afterend', `<div class="field full" id="requestTypeField"><label>نوع الطلب <span class="req">*</span></label><select id="requestType"><option value="individual">تسجيل فردي في دورة</option><option value="institution">طلب برنامج تدريبي لمؤسسة</option></select></div><div id="institutionFields" class="field full" style="display:none"><div class="institution-box"><h3>تفاصيل طلب المؤسسة</h3><p>أخبرنا بما تحتاجه مؤسستك، وسنقترح برنامجًا مناسبًا دون أي التزام أو عرض سعر في هذه المرحلة.</p><div class="grid"><div class="field"><label>اسم المؤسسة <span class="req">*</span></label><input id="organization" placeholder="اسم المؤسسة أو الشركة"></div><div class="field"><label>عدد المشاركين المتوقع</label><input id="audienceSize" placeholder="مثال: 25 مشاركًا"></div><div class="field full"><label>هل ترغبون بشهادة لكل متدرب؟</label><select id="certificateInterest"><option value="غير محدد">لم نحدد بعد</option><option value="نعم">نعم، نرغب بشهادة لكل متدرب</option><option value="لا">لا، لا نرغب بالشهادات</option><option value="اقتراح">نرغب بمناقشة الخيارات المناسبة</option></select></div><div class="field full"><label>ما التدريب أو الاحتياج الذي ترغبون به؟ <span class="req">*</span></label><textarea id="institutionRequest" rows="5" placeholder="اكتبوا الموضوع المقترح، الفئة المستهدفة، الأهداف أو أي تفاصيل تهمكم"></textarea></div><div class="field full"><label>الموعد أو طريقة التنفيذ المفضلة</label><input id="preferredTiming" placeholder="مثال: خلال شهر نوفمبر، حضوري في دبي أو عن بُعد"></div></div></div></div>`);
    document.head.insertAdjacentHTML('beforeend', '<style>.institution-box{background:#f5faff;border:1px solid #d9eafd;border-radius:14px;padding:17px;margin:4px 0 17px}.institution-box h3{margin:0;color:#103b70;font-size:15px}.institution-box p{margin:5px 0 15px;color:#60788f;font-size:11px}.institution-box textarea{width:100%;font:inherit;color:#19314b;font-size:13px;border:1px solid #d8e7f7;border-radius:10px;padding:12px;background:#fff;outline:0;resize:vertical}.institution-box textarea:focus{border-color:#0866c6;box-shadow:0 0 0 3px #0866c618}</style>');
  }
  const applyRequestType = () => {
    const institutional = document.getElementById('requestType')?.value === 'institution';
    document.getElementById('institutionFields').style.display = institutional ? 'block' : 'none';
    if (courseField) courseField.style.display = institutional ? 'none' : '';
    if (courseSelect) courseSelect.disabled = institutional;
    if (certificateArea) certificateArea.style.display = institutional ? 'none' : '';
    if (summary) summary.style.display = institutional ? 'none' : '';
    if (paymentArea) paymentArea.style.display = institutional ? 'none' : '';
    document.getElementById('organization').required = institutional;
    document.getElementById('institutionRequest').required = institutional;
    if (regularTitle) regularTitle.innerHTML = institutional ? 'طلب برنامج تدريبي لمؤسسة<small>اترك تفاصيل احتياجكم وسيتواصل فريقنا معكم.</small>' : 'بيانات التسجيل<small>جميع الحقول المعلّمة مطلوبة.</small>';
    const button = document.getElementById('submitButton');
    if (institutional) button.textContent = 'إرسال طلب المؤسسة';
    else if (typeof renderCourse === 'function' && selectedCourse) renderCourse();
  };
  document.getElementById('requestType').value = requestType;
  document.getElementById('requestType').addEventListener('change', applyRequestType);
  applyRequestType();

  // Failure/old API leaves existing bank and INEXC-card payment available.
  void fetch(`${endpoint}/payments/stripe/capabilities`, {cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{
    window.INEXCStripeEnabled=data?.enabled===true;
    if(selectedCourse&&document.getElementById('requestType')?.value!=='institution'){renderPayments();updateSummary();}
  }).catch(()=>{window.INEXCStripeEnabled=false;});

  try {
    const response = await fetch(`${endpoint}/courses`);
    if (!response.ok) throw new Error('تعذر تحميل الدورات.');
    const courses = await response.json();
    if (!Array.isArray(courses) || !courses.length) throw new Error('لا توجد دورات متاحة الآن.');
    COURSES.splice(0, COURSES.length, ...courses);
    renderCourses();
    applyRequestType();
    try{
      if(new URLSearchParams(location.search).get('resume')==='stripe'){
        const draft=JSON.parse(sessionStorage.getItem('inexc_stripe_draft'));
        if(draft&&draft.course_id===selectedCourse?.id){for(const id of ['name','email','phone'])document.getElementById(id).value=draft[id]||'';const choice=document.querySelector('[name=certificate][value="'+draft.certificate+'"]');if(choice){choice.checked=true;choice.dispatchEvent(new Event('change',{bubbles:true}));}}
      }
    }catch{}
    window.dispatchEvent(new Event('inexc:courses-ready'));
  } catch (error) {
    COURSES.splice(0);
    renderCourses();
    courseSelect.options[0].textContent = 'تعذّر تحميل الدورات — أعد تحميل الصفحة';
    console.warn('INEXC courses unavailable', error);
  }

  let registrationPending = false;
  let stripeAttempt = null;
  form.onsubmit = async event => {
    event.preventDefault();
    if (registrationPending) return;
    const institutional = document.getElementById('requestType')?.value === 'institution';
    if (!institutional && !selectedCourse) return alert('يرجى اختيار الدورة.');
    const file = !institutional && selectedPayment === 'bank' ? document.getElementById('receipt').files[0] : null;
    if (!institutional && selectedPayment === 'bank') {
      const receiptError = window.INEXCReceiptError(file, true);
      if (receiptError) return alert(receiptError);
    }
    const total = institutional ? 0 : selectedCourse.price + (selectedCertificate ? (selectedCourse.certificate?.price || 0) : 0);
    if (!institutional && total > 0 && !['bank','link','stripe'].includes(selectedPayment)) return alert('اختر وسيلة دفع متاحة أو استخدم بطاقتك التدريبية.');
    registrationPending = true;
    const button = document.getElementById('submitButton');
    button.disabled = true;
    button.textContent = 'جارٍ إرسال الطلب...';

    try {
      if (institutional) {
        const response = await fetch(`${endpoint}/institution-requests`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('name').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            organization: document.getElementById('organization').value.trim(), certificateInterest: document.getElementById('certificateInterest').value,
            audienceSize: document.getElementById('audienceSize').value.trim(),
            requestDetails: document.getElementById('institutionRequest').value.trim(),
            preferredTiming: document.getElementById('preferredTiming').value.trim()
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'تعذر إرسال طلب المؤسسة.');
        form.style.display = 'none';
        document.getElementById('success').classList.add('show');
        document.getElementById('reference').textContent = `رقم طلبكم: ${result.reference}`;
        document.getElementById('successText').textContent = 'تم استلام طلب مؤسستكم بنجاح. سيتواصل فريق INEXC معكم قريبًا لمناقشة البرنامج المناسب.';
        return;
      }
      if (selectedPayment === 'stripe') {
        const input = {name:document.getElementById('name').value.trim(),email:document.getElementById('email').value.trim(),phone:document.getElementById('phone').value.trim(),course_id:selectedCourse.id,certificate:selectedCertificate?'yes':'no'};
        const fingerprint=JSON.stringify(input);
        if(!stripeAttempt){try{stripeAttempt=JSON.parse(sessionStorage.getItem('inexc_stripe_attempt'))}catch{}}
        if(!stripeAttempt||stripeAttempt.fingerprint!==fingerprint)stripeAttempt={fingerprint,requestKey:crypto.randomUUID()};
        try{sessionStorage.setItem('inexc_stripe_attempt',JSON.stringify(stripeAttempt));sessionStorage.setItem('inexc_stripe_draft',JSON.stringify(input));}catch{}
        const response=await fetch(`${endpoint}/payments/stripe/checkout`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,request_key:stripeAttempt.requestKey})});
        const result=await response.json();
        if(!response.ok){if([409,410].includes(response.status)){stripeAttempt=null;try{sessionStorage.removeItem('inexc_stripe_attempt')}catch{}}throw new Error(result.error||'تعذّر تجهيز الدفع الإلكتروني.');}
        window.location.href=result.paymentLink;
        return;
      }
      const data = new FormData();
      data.append('name', document.getElementById('name').value.trim());
      data.append('email', document.getElementById('email').value.trim());
      data.append('phone', document.getElementById('phone').value.trim());
      data.append('course_id', selectedCourse.id);
      data.append('certificate', selectedCertificate ? 'yes' : 'no');
      data.append('payment_method', total === 0 ? 'free' : selectedPayment);
      if (file) data.append('receipt', file);
      const response = await fetch(`${endpoint}/registrations`, { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر إرسال الطلب.');
      if (result.paymentLink) {
        window.location.href = result.paymentLink;
        return;
      }
      form.style.display = 'none';
      document.getElementById('success').classList.add('show');
      document.getElementById('reference').textContent = `رقم طلبك: ${result.reference}`;
      document.getElementById('successText').textContent = selectedPayment === 'bank'
        ? 'تم استلام طلب التسجيل ووصل التحويل. سنراجع العملية ونؤكد التسجيل عبر البريد الإلكتروني.'
        : 'تم استلام طلب التسجيل. سنرسل لك تفاصيل التأكيد عبر البريد الإلكتروني.';
    } catch (error) {
      registrationPending = false;
      alert(error.message || 'حدث خطأ أثناء إرسال الطلب.');
      button.disabled = false;
      institutional ? applyRequestType() : updateSummary();
    }
  };
});

/* Keep the exact saved beneficiary details readable in an Arabic form. */
window.INEXCReceiptError = (file, required = false) => {
  if (!file) return required ? 'يرجى إرفاق وصل التحويل البنكي.' : '';
  if (file.size > 5 * 1024 * 1024) return 'حجم الوصل يجب ألا يتجاوز 5MB.';
  if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)) return 'ارفع وصلًا بصيغة PDF أو JPG أو PNG أو WEBP.';
  return '';
};
function renderBankDetails() {
  const data = selectedCourse?.bank || {}, box = document.getElementById('bankBox');
  let title = document.getElementById('bankTitleLine');
  if (!title) { title = document.createElement('p'); title.id = 'bankTitleLine'; box.querySelector('h3').after(title); }
  const set = (id, label, value, copy = false) => {
    const element = document.getElementById(id);
    element.replaceChildren(); element.style.display = value ? '' : 'none';
    if (!value) return;
    const caption = document.createElement('span'); caption.textContent = label;
    const text = document.createElement('bdi'); text.dir = 'ltr'; text.textContent = value;
    element.append(caption, text);
    if (copy) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'bank-copy'; button.textContent = 'نسخ'; button.setAttribute('aria-label', 'نسخ '+label);
      button.onclick = async () => { try { await navigator.clipboard.writeText(String(value)); button.textContent = 'تم النسخ'; } catch { const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(text); selection.removeAllRanges(); selection.addRange(range); button.textContent = 'حددنا الرقم للنسخ'; } };
      element.append(button);
    }
  };
  set('bankTitleLine', 'اسم البنك', data.title);
  set('bankName', 'اسم صاحب الحساب', data.name);
  set('bankAccount', 'رقم الحساب', data.account, true);
  set('bankIban', 'IBAN', data.iban, true);
}
function toggleBank() {
  const bank = selectedPayment === 'bank';
  document.getElementById('bankBox').classList.toggle('show', bank);
  document.getElementById('receipt').required = bank;
  renderBankDetails();
}
