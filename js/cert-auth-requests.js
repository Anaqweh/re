/**
 * INEXC — طلبات مصادقة الشهادات (الماجستير المهني)
 * مشترك بين admin.html و trainee-auth.js
 */
(function (global) {
  'use strict';

  const TABLE = 'certificate_authentication_requests';

  const PROGRESS_MIN = 90;
  const HOURS_MIN = 70;

  const STATUS = {
    new: { key: 'new', label: 'جديد', className: 'auth-status-new' },
    under_review: { key: 'under_review', label: 'قيد المراجعة', className: 'auth-status-review' },
    awaiting_payment: { key: 'awaiting_payment', label: 'بانتظار الدفع', className: 'auth-status-payment' },
    authenticated: { key: 'authenticated', label: 'تمت المصادقة', className: 'auth-status-done' },
    rejected: { key: 'rejected', label: 'مرفوض', className: 'auth-status-rejected' }
  };

  const PAYMENT_STATUS = {
    not_required: 'غير مطلوب',
    pending: 'بانتظار الدفع',
    paid: 'مدفوع',
    failed: 'فشل'
  };

  function statusMeta(key) {
    return STATUS[key] || STATUS.new;
  }

  function isEligible(progress, hours) {
    return Number(progress) >= PROGRESS_MIN && Number(hours) > HOURS_MIN;
  }

  function computeOffer(stats, professionalValue) {
    const progress = Number(stats?.progress) || 0;
    const hours = Number(professionalValue?.trainingHours) || 0;
    return {
      eligible: isEligible(progress, hours),
      progress,
      hours,
      progressMin: PROGRESS_MIN,
      hoursMin: HOURS_MIN
    };
  }

  function mapRow(row) {
    if (!row) return null;
    const st = statusMeta(row.status);
    return {
      id: row.id,
      trainee_id: row.trainee_id,
      full_name: row.full_name || '',
      email: row.email || '',
      phone: row.phone || '',
      total_hours: Number(row.total_hours) || 0,
      completion_percent: Number(row.completion_percent) || 0,
      certificates_count: Number(row.certificates_count) || 0,
      completed_courses: row.completed_courses || [],
      certificates: row.certificates || [],
      uploaded_files: row.uploaded_files || [],
      payment_history: row.payment_history || [],
      status: row.status || 'new',
      statusLabel: st.label,
      statusClass: st.className,
      payment_status: row.payment_status || 'not_required',
      payment_status_label: PAYMENT_STATUS[row.payment_status] || row.payment_status,
      payment_amount: Number(row.payment_amount) || 0,
      payment_link: row.payment_link || '',
      verification_code: row.verification_code || '',
      verification_url: row.verification_url || '',
      admin_notes: row.admin_notes || '',
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at
    };
  }

  function isOpenRequest(row) {
    return row && !['authenticated', 'rejected'].includes(row.status);
  }

  function generateVerificationCode() {
    return 'INEXC-MAJ-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6);
  }

  global.InexcCertAuth = {
    TABLE,
    PROGRESS_MIN,
    HOURS_MIN,
    STATUS,
    PAYMENT_STATUS,
    statusMeta,
    isEligible,
    computeOffer,
    mapRow,
    isOpenRequest,
    generateVerificationCode
  };
})(typeof window !== 'undefined' ? window : globalThis);
