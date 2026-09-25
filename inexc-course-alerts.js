(() => {
  const API = 'https://api.inexctraining.com/api';
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('courseAlertForm');
    if (!form) return;
    const email = document.getElementById('courseAlertEmail');
    const message = document.getElementById('courseAlertMessage');
    const button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = String(email.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        message.textContent = 'اكتب بريدًا إلكترونيًا صحيحًا.';
        message.className = 'course-alert-message error';
        email.focus();
        return;
      }
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'جارٍ الحفظ…';
      message.textContent = '';
      try {
        const response = await fetch(`${API}/course-alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: value })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'تعذر حفظ البريد الآن. حاول مرة أخرى.');
        if (data.alreadyUnsubscribed) {
          message.textContent = 'تم إلغاء اشتراك هذا البريد سابقًا، لذلك لن يُضاف إلى التنبيهات.';
          message.className = 'course-alert-message error';
        } else {
          message.textContent = data.alreadySubscribed ? 'هذا البريد مشترك بالفعل في تنبيهات الدورات.' : 'تم الاشتراك بنجاح. ستصلك رسالة عند نشر أي دورة جديدة.';
          message.className = 'course-alert-message';
          if (!data.alreadySubscribed) form.reset();
        }
      } catch (error) {
        message.textContent = error.message || 'تعذر حفظ البريد الآن. حاول مرة أخرى.';
        message.className = 'course-alert-message error';
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
})();