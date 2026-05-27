/**
 * INEXC — أنواع الشهادات المعتمدة (الأسعار تُحدَّد من لوحة التحكم فقط)
 */
(function () {
  const CERTIFICATE_TYPES = [
    { key: 'attendance', label: 'شهادة حضور' },
    { key: 'uae_university', label: 'شهادة صادرة من إحدى الجامعات الإماراتية' },
    { key: 'american_board', label: 'شهادة من البورد الأمريكي' },
    { key: 'inexc', label: 'شهادة من شركة التميز الابتكاري' },
    { key: 'ediola', label: 'شهادة من منصة إديولا' },
    { key: 'trainer_card', label: 'بطاقة مدرب معتمد' }
  ];

  const LABELS = {};
  CERTIFICATE_TYPES.forEach(t => { LABELS[t.key] = t.label; });

  window.INEXC_CERTIFICATE_TYPES = CERTIFICATE_TYPES;
  window.getCertificateLabel = function (typeKey) {
    return LABELS[typeKey] || typeKey || '';
  };
})();
