(function (global) {
  'use strict';

  /*
   * قالب EmailJS "Contact Us" — الإعداد في dashboard.emailjs.com:
   * To Email: {{to_email}}
   * From Name: {{name}}
   * Reply To: {{email}}
   * Subject: {{title}}
   * Content: HTML كامل في لوحة EmailJS (يستخدم {{to_name}} {{course_name}} {{registration_type}} {{phone}})
   * Template: template_fq8l9x8 (Contact Us)
   * https://dashboard.emailjs.com/admin/templates/fq8l9x8
   */

  function buildContactUsParams(params) {
    const email = String(params.email || '').trim();
    const toName = params.to_name || params.full_name || '';

    return {
      to_email: email,
      reply_to: email,
      email,
      name: toName,
      title: 'تم تسجيلك بنجاح — INEXC | قطاع التدريب والتطوير',
      to_name: toName,
      full_name: toName,
      course_name: params.course_name || '',
      registration_type: params.registration_type || '',
      phone: params.phone || ''
    };
  }

  function buildWelcomeEmailParams(params) {
    const email = String(params.email || '').trim();
    const toName = params.to_name || params.full_name || '';
    const base = {
      to_email: email,
      reply_to: email,
      email,
      name: toName,
      title: 'تم تسجيلك بنجاح — INEXC | قطاع التدريب والتطوير',
      subject: 'تم تسجيلك بنجاح — INEXC | قطاع التدريب والتطوير',
      to_name: toName,
      full_name: toName,
      course_name: params.course_name || '',
      registration_type: params.registration_type || '',
      phone: params.phone || ''
    };
    const html = getRawTemplate() ? buildHtml(base) : buildCompactHtml(base);
    return Object.assign(base, {
      message: html,
      message_html: html
    });
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getRawTemplate() {
    return global.INEXC_REGISTRATION_EMAIL_TEMPLATE || '';
  }

  function fillTemplate(template, params) {
    const map = {
      to_name: escapeHtml(params.to_name || ''),
      course_name: escapeHtml(params.course_name || ''),
      registration_type: escapeHtml(params.registration_type || ''),
      phone: escapeHtml(params.phone || '')
    };
    return template.replace(/\{\{(to_name|course_name|registration_type|phone)\}\}/g, (_, key) => map[key] || '');
  }

  function buildHtml(params) {
    return fillTemplate(getRawTemplate(), params);
  }

  function buildCompactHtml(params) {
    const name = escapeHtml(params.to_name || '');
    const course = escapeHtml(params.course_name || '');
    const regType = escapeHtml(params.registration_type || '');
    const phone = escapeHtml(params.phone || '');

    return (
      '<div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#fff;border:1px solid #dde3ec;border-radius:12px;overflow:hidden">' +
      '<div style="background:#1B2A4A;color:#C8A96E;padding:24px;text-align:center;font-weight:800;font-size:22px;letter-spacing:4px">INEXC</div>' +
      '<div style="padding:28px 24px;color:#1B2A4A">' +
      '<h2 style="margin:0 0 12px;font-size:20px">تم تسجيلك بنجاح!</h2>' +
      '<p style="margin:0 0 16px;color:#555;line-height:1.8">عزيزي/عزيزتي <strong>' + name + '</strong>،</p>' +
      '<p style="margin:0 0 16px;color:#555;line-height:1.8">تم استلام طلب تسجيلك في قطاع التدريب والتطوير — INEXC.</p>' +
      '<div style="background:#f7faff;border:1px solid #dce8f5;border-right:3px solid #C8A96E;border-radius:8px;padding:16px;margin-bottom:16px">' +
      '<p style="margin:0 0 8px"><strong>الدورة:</strong> ' + course + '</p>' +
      '<p style="margin:0 0 8px"><strong>نوع التسجيل:</strong> ' + regType + '</p>' +
      '<p style="margin:0"><strong>الجوال:</strong> ' + phone + '</p>' +
      '</div>' +
      '<p style="margin:0;color:#555;line-height:1.8">سيتواصل معك فريقنا قريباً. شكراً لثقتك بنا.</p>' +
      '</div></div>'
    );
  }

  function buildPayload(params, html) {
    const email = String(params.email || '').trim();
    const subject = 'تم تسجيلك بنجاح — INEXC | قطاع التدريب والتطوير';

    return {
      to_name: params.to_name || '',
      email,
      to_email: email,
      full_name: params.to_name || '',
      course_name: params.course_name || '',
      registration_type: params.registration_type || '',
      phone: params.phone || '',
      subject,
      message_html: html
    };
  }

  function getEmailParams(params) {
    return buildPayload(params, buildHtml(params));
  }

  function getCompactEmailParams(params) {
    return buildPayload(params, buildCompactHtml(params));
  }

  global.InexcRegistrationEmail = {
    fillTemplate,
    buildHtml,
    buildCompactHtml,
    buildContactUsParams,
    buildWelcomeEmailParams,
    getEmailParams,
    getCompactEmailParams,
    getContactUsTemplateParams: buildContactUsParams
  };
})(window);
