(function () {
  if (document.getElementById('inexcWhatsAppFloat')) return;

  const WA_PHONE = '971543475500';
  const WA_MESSAGE = 'مرحباً، أود الاستفسار عن دورات INEXC';
  const WA_URL = 'https://wa.me/' + WA_PHONE + '?text=' + encodeURIComponent(WA_MESSAGE);

  const style = document.createElement('style');
  style.textContent = `
    .inexc-wa-float {
      position: fixed;
      left: 22px;
      bottom: 22px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      font-family: 'Cairo', 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif;
    }
    .inexc-wa-tooltip {
      background: #1B2A4A;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 14px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(27, 42, 74, 0.22);
      opacity: 0;
      transform: translateY(8px);
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s ease;
      white-space: nowrap;
      border: 1px solid rgba(200, 169, 110, 0.35);
    }
    .inexc-wa-float:hover .inexc-wa-tooltip,
    .inexc-wa-float:focus-within .inexc-wa-tooltip {
      opacity: 1;
      transform: translateY(0);
    }
    .inexc-wa-btn {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: linear-gradient(145deg, #25D366 0%, #1ebe57 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 28px rgba(37, 211, 102, 0.45);
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      text-decoration: none;
      position: relative;
    }
    .inexc-wa-btn:hover {
      transform: translateY(-3px) scale(1.04);
      box-shadow: 0 12px 32px rgba(37, 211, 102, 0.55);
    }
    .inexc-wa-btn svg {
      width: 30px;
      height: 30px;
      fill: currentColor;
    }
    .inexc-wa-btn::before {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid rgba(37, 211, 102, 0.35);
      animation: inexcWaPulse 2.2s ease-out infinite;
    }
    @keyframes inexcWaPulse {
      0% { transform: scale(1); opacity: 0.7; }
      100% { transform: scale(1.35); opacity: 0; }
    }
    @media (max-width: 680px) {
      .inexc-wa-float {
        left: 16px;
        bottom: 16px;
      }
      .inexc-wa-btn {
        width: 54px;
        height: 54px;
      }
      .inexc-wa-tooltip {
        font-size: 12px;
        max-width: 180px;
        white-space: normal;
      }
    }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'inexcWhatsAppFloat';
  wrap.className = 'inexc-wa-float';
  wrap.innerHTML = `
    <span class="inexc-wa-tooltip">تواصل معنا عبر واتساب</span>
    <a href="${WA_URL}" class="inexc-wa-btn" target="_blank" rel="noopener noreferrer" aria-label="تواصل معنا عبر واتساب" title="تواصل معنا عبر واتساب">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    </a>
  `;
  document.body.appendChild(wrap);
})();
