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
    emailField.insertAdjacentHTML('afterend', `<div class="field full" id="requestTypeField"><label>نوع الطلب <span class="req">*</span></label><select id="requestType"><option value="individual">تسجيل فردي في دورة</option><option value="institution">طلب برنامج تدريبي لمؤسسة</option></select></div><div id="institutionFields" class="field full" style="display:none"><div class="institution-box"><h3>تفاصيل طلب المؤسسة</h3><p>أخبرنا بما تحتاجه مؤسستك، وسنقترح برنامجًا مناسبًا دون أي التزام أو عرض سعر في هذه المرحلة.</p><div class="grid"><div class="field"><label>اسم المؤسسة <span class="req">*</span></label><input id="organization" placeholder="اسم المؤسسة أو الشركة"></div><div class="field"><label>عدد المشاركين المتوقع</label><input id="audienceSize" placeholder="مثال: 25 مشاركًا"></div><div class="field full"><label>ما التدريب أو الاحتياج الذي ترغبون به؟ <span class="req">*</span></label><textarea id="institutionRequest" rows="5" placeholder="اكتبوا الموضوع المقترح، الفئة المستهدفة، الأهداف أو أي تفاصيل تهمكم"></textarea></div><div class="field full"><label>الموعد أو طريقة التنفيذ المفضلة</label><input id="preferredTiming" placeholder="مثال: خلال شهر نوفمبر، حضوري في دبي أو عن بُعد"></div></div></div></div>`);
    document.head.insertAdjacentHTML('beforeend', '<style>.institution-box{background:#f5faff;border:1px solid #d9eafd;border-radius:14px;padding:17px;margin:4px 0 17px}.institution-box h3{margin:0;color:#103b70;font-size:15px}.institution-box p{margin:5px 0 15px;color:#60788f;font-size:11px}.institution-box textarea{width:100%;font:inherit;color:#19314b;font-size:13px;border:1px solid #d8e7f7;border-radius:10px;padding:12px;background:#fff;outline:0;resize:vertical}.institution-box textarea:focus{border-color:#0866c6;box-shadow:0 0 0 3px #0866c618}</style>');
  }
  const applyRequestType = () => {
    const institutional = document.getElementById('requestType')?.value === 'institution';
    document.getElementById('institutionFields').style.display = institutional ? 'block' : 'none';
    if (courseField) courseField.style.display = institutional ? 'none' : '';
    if (courseSelect) courseSelect.disabled = institutional;
    if (certificateArea) certificateArea.style.display = institutional ? 'none' : certificateArea.style.display;
    if (summary) summary.style.display = institutional ? 'none' : '';
    if (paymentArea) paymentArea.style.display = institutional ? 'none' : '';
    document.getElementById('organization').required = institutional;
    document.getElementById('institutionRequest').required = institutional;
    if (regularTitle) regularTitle.innerHTML = institutional ? 'طلب برنامج تدريبي لمؤسسة<small>اترك تفاصيل احتياجكم وسيتواصل فريقنا معكم.</small>' : 'بيانات التسجيل<small>جميع الحقول المعلّمة مطلوبة.</small>';
    const button = document.getElementById('submitButton');
    if (institutional) button.textContent = 'إرسال طلب المؤسسة';
    else if (typeof updateSummary === 'function') updateSummary();
  };
  document.getElementById('requestType').value = requestType;
  document.getElementById('requestType').addEventListener('change', applyRequestType);
  applyRequestType();

  try {
    const response = await fetch(`${endpoint}/courses`);
    if (!response.ok) throw new Error('تعذر تحميل الدورات.');
    const courses = await response.json();
    if (!Array.isArray(courses) || !courses.length) throw new Error('لا توجد دورات متاحة الآن.');
    COURSES.splice(0, COURSES.length, ...courses);
    renderCourses();
  } catch (error) {
    console.warn('INEXC courses unavailable', error);
  }

  form.onsubmit = async event => {
    event.preventDefault();
    const institutional = document.getElementById('requestType')?.value === 'institution';
    if (!institutional && !selectedCourse) return alert('يرجى اختيار الدورة.');
    const file = document.getElementById('receipt').files[0];
    if (file && file.size > 5 * 1024 * 1024) return alert('حجم الوصل يجب ألا يتجاوز 5MB.');
    const total = selectedCourse.price + (selectedCertificate ? (selectedCourse.certificate?.price || 0) : 0);
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
            organization: document.getElementById('organization').value.trim(),
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
      alert(error.message || 'حدث خطأ أثناء إرسال الطلب.');
      button.disabled = false;
      institutional ? applyRequestType() : updateSummary();
    }
  };
});

/* إظهار بيانات التحويل التي أدخلتها الإدارة، وإخفاء الحقول الفارغة. */
function toggleBank() {
  const bank = selectedPayment === 'bank';
  document.getElementById('bankBox').classList.toggle('show', bank);
  document.getElementById('receipt').required = bank;
  if (!bank) return;
  const data = selectedCourse.bank || {};
  const box = document.getElementById('bankBox');
  let bankTitle = document.getElementById('bankTitleLine');
  if (!bankTitle) { bankTitle = document.createElement('p'); bankTitle.id = 'bankTitleLine'; box.querySelector('h3').after(bankTitle); }
  const set = (id, label, value) => {
    const element = document.getElementById(id);
    element.textContent = value ? `${label}: ${value}` : '';
    element.style.display = value ? 'block' : 'none';
  };
  set('bankTitleLine', 'اسم البنك', data.title);
  set('bankName', 'اسم صاحب الحساب', data.name);
  set('bankAccount', 'رقم الحساب', data.account);
  set('bankIban', 'IBAN', data.iban);
}
