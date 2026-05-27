/**
 * INEXC — إعداد Supabase الموحّد
 */
(function () {
  var SUPABASE_URL = 'https://mhrrktcrbpvaxqltdtgo.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ocnJrdGNyYnB2YXhxbHRkdGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzUxNjYsImV4cCI6MjA5NTMxMTE2Nn0.v9KS8UEXiGBrLz-LOmtVaNa1DxrweVZM8OY4FP52x-s';

  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.TRACK_EMAIL_OPEN_URL = SUPABASE_URL + '/functions/v1/track-email-open';
  window.EMAILJS_PUBLIC_KEY = 'gc0MqAK4Mwebs_GOg';
  window.EMAILJS_SERVICE_ID = 'service_58hjcoc';
  window.EMAILJS_TEMPLATE_ID = 'template_fq8l9x8';
  window.EMAILJS_TEMPLATE_ID_FALLBACK = 'template_o9jfkzn';

  function tryInit() {
    if (window.supabaseClient) return;
    if (window.supabase && window.supabase.createClient) {
      try {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('Supabase client ready ✓');
      } catch (e) {
        console.error('Supabase init error:', e);
        setTimeout(tryInit, 200);
      }
    } else {
      setTimeout(tryInit, 100);
    }
  }

  tryInit();
})();
