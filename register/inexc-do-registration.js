/* اتصال نموذج التسجيل بواجهة INEXC الخاصة على DigitalOcean. */
window.addEventListener('DOMContentLoaded', async () => {
  const endpoint = window.INEXC_REGISTRATION_ENDPOINT || '';
  const form = document.getElementById('registrationForm');
  if (!endpoint || !form) return;

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
    if (!selectedCourse) return alert('يرجى اختيار الدورة.');
    const file = document.getElementById('receipt').files[0];
    if (file && file.size > 5 * 1024 * 1024) return alert('حجم الوصل يجب ألا يتجاوز 5MB.');
    const total = selectedCourse.price + (selectedCertificate ? (selectedCourse.certificate?.price || 0) : 0);
    const button = document.getElementById('submitButton');
    button.disabled = true;
    button.textContent = 'جارٍ إرسال الطلب...';

    try {
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
      updateSummary();
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
