/* هوية بصرية وخط عربي رسمي موحّد. */
const inexcFont = document.createElement('style');
inexcFont.textContent = "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&display=swap');body,button,input,select,textarea{font-family:'Noto Sans Arabic',Arial,sans-serif!important}";
document.head.appendChild(inexcFont);

/* إضافة اسم البنك كحقل مستقل في لوحة الإدارة، مع حفظه وعرضه للمتدرب. */
const inexcFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const url = String(input);
  if (url.includes('/admin/courses') && options.body && typeof options.body === 'string') {
    try {
      const data = JSON.parse(options.body);
      const bankTitle = document.getElementById('bankTitle')?.value.trim();
      if (bankTitle && data.bank) data.bank.name = `اسم البنك: ${bankTitle} | صاحب الحساب: ${data.bank.name || '—'}`;
      options = { ...options, body: JSON.stringify(data) };
    } catch (_) {}
  }
  return inexcFetch(input, options);
};
window.addEventListener('DOMContentLoaded', () => {
  const owner = document.getElementById('bankName');
  // هذا الحقل مخصص للوحة الإدارة فقط؛ لا نضيفه إلى صفحة التسجيل العامة.
  if (!document.getElementById('courseForm') || !owner || document.getElementById('bankTitle')) return;
  const title = document.createElement('input');
  title.id = 'bankTitle'; title.placeholder = 'اسم البنك';
  owner.before(title);
  document.addEventListener('click', event => {
    if (!event.target.closest('button') || event.target.textContent.trim() !== 'تعديل') return;
    setTimeout(() => {
      const saved = owner.value || '';
      const matched = saved.match(/^اسم البنك:\s*(.*?)\s*\|\s*صاحب الحساب:\s*(.*)$/);
      if (matched) { title.value = matched[1]; owner.value = matched[2] === '—' ? '' : matched[2]; }
      else title.value = '';
    }, 0);
  });
});

/* تحميل شعار الموقع المحفوظ من لوحة إدارة INEXC. */
window.addEventListener('DOMContentLoaded', async () => {
  const api = window.INEXC_REGISTRATION_ENDPOINT;
  if (!api) return;
  const images = [...document.querySelectorAll('[data-brand-logo]')];
  const preview = document.getElementById('logoPreview');
  if (preview?.getAttribute('src')?.includes('assets/')) {
    preview.style.visibility = 'hidden';
    new MutationObserver(() => {
      if (preview.getAttribute('src')?.includes('/uploads/')) preview.style.visibility = 'visible';
    }).observe(preview, { attributes: true, attributeFilter: ['src'] });
  }
  images.forEach(image => {
    image.hidden = true;
    image.style.display = 'none';
    new MutationObserver(() => {
      if (image.getAttribute('src')?.includes('/uploads/')) {
        image.hidden = false;
        image.style.display = 'block';
      }
    }).observe(image, { attributes: true, attributeFilter: ['src'] });
  });
  try {
    const response = await fetch(`${api}/settings`);
    const settings = await response.json();
    if (!response.ok || !settings.logoUrl) return;
    const url = new URL(settings.logoUrl, new URL(api).origin).href;
    const favicon = document.querySelector('link[rel~="icon"]') || document.createElement('link');
    favicon.rel = 'icon'; favicon.type = 'image/png'; favicon.href = url;
    if (!favicon.parentNode) document.head.appendChild(favicon);
    if (preview) { preview.src = url; preview.style.visibility = 'visible'; }
    images.forEach(image => {
      image.src = url;
      image.hidden = false;
      image.style.display = 'block';
      image.onerror = () => { image.hidden = true; image.style.display = 'none'; };
    });
  } catch (_) { /* تستخدم الصفحة الشعار الافتراضي عند تعذر الاتصال. */ }
});
