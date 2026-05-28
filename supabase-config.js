/**
 * INEXC — إعداد Supabase الموحّد
 * anon public key فقط — لا تستخدم service_role في ملفات HTML
 */
(function () {
  if (!window.supabase) {
    console.error('يجب تحميل @supabase/supabase-js قبل supabase-config.js');
    return;
  }

  const SUPABASE_URL = 'https://mhrrktcrbpvaxqltdtgo.supabase.co';
  const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ocnJrdGNyYnB2YXhxbHRkdGdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzUxNjYsImV4cCI6MjA5NTMxMTE2Nn0.v9KS8UEXiGBrLz-LOmtVaNa1DxrweVZM8OY4FP52x-s';

  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.TRACK_EMAIL_OPEN_URL = SUPABASE_URL + '/functions/v1/track-email-open';
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
