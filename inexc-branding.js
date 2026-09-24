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
    const url = `${api.replace('/api', '')}${settings.logoUrl}`;
    if (preview) { preview.src = url; preview.style.visibility = 'visible'; }
    images.forEach(image => {
      image.src = url;
      image.hidden = false;
      image.style.display = 'block';
      image.onerror = () => { image.hidden = true; image.style.display = 'none'; };
    });
  } catch (_) { /* تستخدم الصفحة الشعار الافتراضي عند تعذر الاتصال. */ }
});
