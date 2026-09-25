/* زر التواصل عبر واتساب في الصفحات العامة لـ INEXC. */
(() => {
  if (document.getElementById('inexcWhatsApp')) return;
  const phone = '971543475500';
  const message = encodeURIComponent('مرحبًا، أرغب بالاستفسار عن دورات INEXC Training.');
  const style = document.createElement('style');
  style.textContent = `
    #inexcWhatsApp{position:fixed;left:22px;bottom:22px;z-index:9999;display:inline-flex;align-items:center;gap:9px;background:#128c7e;color:#fff;text-decoration:none;border:1px solid #ffffff55;border-radius:999px;padding:10px 15px 10px 11px;font:700 12px Arial,sans-serif;box-shadow:0 12px 28px #075c543d;transition:transform .18s ease,box-shadow .18s ease}
    #inexcWhatsApp:hover{transform:translateY(-2px);box-shadow:0 16px 32px #075c5452}
    #inexcWhatsApp .wa-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#128c7e}
    #inexcWhatsApp svg{width:17px;height:17px;fill:currentColor}
    @media(max-width:600px){#inexcWhatsApp{left:14px;bottom:14px;width:56px;height:56px;padding:0;justify-content:center;border-radius:50%}#inexcWhatsApp .wa-label{display:none}#inexcWhatsApp .wa-icon{width:34px;height:34px}}
  `;
  document.head.appendChild(style);
  const link = document.createElement('a');
  link.id = 'inexcWhatsApp';
  link.href = `https://wa.me/${phone}?text=${message}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'تواصل عبر واتساب');
  link.innerHTML = '<span class="wa-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.48 0 .13 5.34.13 11.91c0 2.1.55 4.15 1.59 5.96L0 24l6.3-1.65a11.9 11.9 0 0 0 5.74 1.46h.01c6.56 0 11.9-5.34 11.9-11.91 0-3.18-1.24-6.16-3.43-8.42ZM12.05 21.8c-1.77 0-3.5-.48-5-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.82 9.82 0 0 1-1.55-5.26c0-5.43 4.42-9.85 9.87-9.85 2.63 0 5.1 1.02 6.96 2.89a9.77 9.77 0 0 1 2.88 6.97c0 5.43-4.42 9.85-9.82 9.88Zm5.41-7.39c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.23-.65.08a8.11 8.11 0 0 1-2.39-1.47 8.99 8.99 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.08-.8.38-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.21 5.09 4.5.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35Z"/></svg></span><span class="wa-label">تواصل عبر واتساب</span>';
  document.body.appendChild(link);
})();
