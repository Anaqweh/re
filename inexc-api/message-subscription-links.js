// Public, non-personal links. Source codes identify campaigns, never recipients.
export const subscriptionUrl = (source = '', share = false, origin = 'https://www.inexctraining.com') => {
  const url = new URL('/subscribe.html', origin);
  if (/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(source)) url.searchParams.set('source', source);
  if (share) url.searchParams.set('share', '1');
  return url.href;
};
export const subscriptionDefaults = {
  enabled: true, brandName: 'INEXC Training', eyebrow: 'معرفة تستحق أن تصلك',
  title: 'خطوة صغيرة، وآفاق أوسع.',
  description: 'رسائل عن التعلّم والتطوير المهني، وأفكار عملية وبرامج تدريبية من INEXC. اختر أن تبقى على اطلاع، ودع المعرفة تجد طريقها إليك.',
  formTitle: 'انضم إلى رسائل INEXC', nameLabel: 'الاسم (اختياري)', emailLabel: 'بريدك الإلكتروني',
  consentLabel: 'أوافق على استقبال رسائل INEXC عن المعرفة والبرامج التدريبية والتطوير المهني.',
  buttonLabel: 'اشترك في الرسائل', note: 'يمكنك إلغاء الاشتراك من أي رسالة تصلك.',
  shareTitle: 'المعرفة أجمل حين نشاركها.', shareText: 'تعرف شخصًا قد تهمّه رسائلنا؟ شاركه رابط الاشتراك.', shareLabel: 'شارك مع صديق',
  successTitle: 'شكرًا لاهتمامك', successText: 'تم استلام طلب الاشتراك. يسعدنا أن نبقى على تواصل.',
  emailSubject: 'خطوة واحدة لتأكيد اشتراكك في رسائل INEXC',
  confirmationTitle: 'أكد اشتراكك، ولنبدأ.', confirmationText: 'طلبت الاشتراك في رسائل INEXC. اضغط الزر أدناه لتأكيد ملكيتك للبريد واستقبال رسائلنا. إذا لم تطلب الاشتراك، يمكنك تجاهل هذه الرسالة.',
  confirmationButton: 'تأكيد اشتراكي', confirmedTitle: 'أهلًا بك في رسائل INEXC', confirmedText: 'تم تأكيد اشتراكك بنجاح. يسعدنا أن تكون جزءًا من مجتمع يتعلّم ويتطور.',
};
export const subscriptionFields = {
  brandName: ['اسم الجهة',100], eyebrow: ['العبارة العلوية',100], title: ['العنوان الرئيسي',160], description: ['وصف الرسائل',700],
  formTitle: ['عنوان نموذج الاشتراك',140], nameLabel: ['عنوان خانة الاسم',100], emailLabel: ['عنوان خانة البريد',100],
  consentLabel: ['نص الموافقة على الاشتراك',400], buttonLabel: ['نص زر الاشتراك',80], note: ['الملاحظة أسفل النموذج',350],
  shareTitle: ['عنوان المشاركة',160], shareText: ['عبارة الدعوة للمشاركة',350], shareLabel: ['نص زر المشاركة في الرسالة',80],
  successTitle: ['عنوان نجاح التسجيل',160], successText: ['رسالة نجاح التسجيل',500],
  emailSubject: ['عنوان بريد التأكيد',160], confirmationTitle: ['عنوان التأكيد',160], confirmationText: ['محتوى بريد التأكيد',700], confirmationButton: ['زر تأكيد الاشتراك',80],
  confirmedTitle: ['عنوان نجاح الاشتراك',160], confirmedText: ['رسالة نجاح الاشتراك',500],
};
export const legacyConfirmationFields = ['emailSubject','confirmationTitle','confirmationText','confirmationButton','confirmedTitle','confirmedText'];
export function subscriptionSettings(raw={}) {
  const result={enabled:raw.enabled!==false};
  for(const [key,[,max]] of Object.entries(subscriptionFields)) result[key]=String(raw[key]??subscriptionDefaults[key]).trim().slice(0,max) || subscriptionDefaults[key];
  return result;
}
