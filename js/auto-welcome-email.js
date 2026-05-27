(function (global) {
  'use strict';

  /*
   * رسالة ترحيب تلقائية للمتدرب بعد التسجيل — عبر EmailJS إلى بريد المتدرب.
   * لا تُرسل إلى بريد الإدارة.
   */
  const STORAGE_PREFIX = 'inexc_welcome_email_';
  const EMAIL_TIMEOUT_MS = 8000;

  function getConfig() {
    const templateIds = [
      global.EMAILJS_TEMPLATE_ID || 'template_fq8l9x8',
      global.EMAILJS_TEMPLATE_ID_FALLBACK || 'template_o9jfkzn'
    ].filter(function (id, index, list) {
      return id && list.indexOf(id) === index;
    });

    return {
      publicKey: global.EMAILJS_PUBLIC_KEY || 'gc0MqAK4Mwebs_GOg',
      serviceId: global.EMAILJS_SERVICE_ID || 'service_58hjcoc',
      templateIds: templateIds
    };
  }

  function welcomeStorageKey(registrationId) {
    return STORAGE_PREFIX + registrationId;
  }

  function wasWelcomeSent(registrationId) {
    if (!registrationId) return false;
    try {
      return !!sessionStorage.getItem(welcomeStorageKey(registrationId));
    } catch (_) {
      return false;
    }
  }

  function markWelcomeSent(registrationId) {
    if (!registrationId) return;
    try {
      sessionStorage.setItem(welcomeStorageKey(registrationId), '1');
    } catch (_) {}
  }

  function buildBaseParams(params) {
    return {
      to_name: params.to_name || params.full_name || '',
      full_name: params.to_name || params.full_name || '',
      email: String(params.email || '').trim(),
      course_name: params.course_name || '',
      registration_type: params.registration_type || '',
      phone: params.phone || ''
    };
  }

  async function sendViaEmailJS(baseParams, config) {
    if (typeof global.emailjs === 'undefined') {
      throw new Error('مكتبة EmailJS غير محمّلة');
    }
    if (typeof global.InexcRegistrationEmail === 'undefined') {
      throw new Error('ملف js/registration-email.js غير محمّل');
    }

    const emailPayload = global.InexcRegistrationEmail.buildWelcomeEmailParams(baseParams);

    if (typeof global.emailjs.init === 'function' && config.publicKey) {
      try { global.emailjs.init(config.publicKey); } catch (_) {}
    }

    let lastError = null;

    for (let i = 0; i < config.templateIds.length; i += 1) {
      const templateId = config.templateIds[i];
      try {
        await global.emailjs.send(config.serviceId, templateId, emailPayload);
        return;
      } catch (err) {
        lastError = err;
        const msg = String((err && (err.text || err.message)) || '').toLowerCase();
        console.error('EmailJS send failed (service_58hjcoc / ' + templateId + '):', err);
        if (!msg.includes('template') && !msg.includes('not found')) break;
      }
    }

    throw lastError || new Error('تعذر إرسال رسالة الترحيب');
  }

  async function sendWelcomeEmail(params) {
    const baseParams = buildBaseParams(params || {});
    if (!baseParams.email) {
      console.error('Welcome email skipped: missing trainee email');
      return { sent: false, skipped: true };
    }

    const registrationId = params && params.registration_id;
    if (wasWelcomeSent(registrationId)) {
      return { sent: true, skipped: true };
    }

    const config = getConfig();

    try {
      await Promise.race([
        sendViaEmailJS(baseParams, config),
        new Promise(function (_, reject) {
          setTimeout(function () {
            reject(new Error('EmailJS timeout'));
          }, EMAIL_TIMEOUT_MS);
        })
      ]);
      markWelcomeSent(registrationId);
      return { sent: true, skipped: false };
    } catch (err) {
      console.error('Welcome email failed (service_58hjcoc):', err);
      return { sent: false, skipped: false, error: err };
    }
  }

  global.InexcAutoWelcomeEmail = {
    sendWelcomeEmail: sendWelcomeEmail,
    wasWelcomeSent: wasWelcomeSent,
    markWelcomeSent: markWelcomeSent,
    welcomeStorageKey: welcomeStorageKey
  };
})(window);
