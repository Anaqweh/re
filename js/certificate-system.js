/**
 * INEXC — نظام الشهادات الموحّد
 * كل دورة لها شهاداتها في course_certificates
 */
(function (global) {
  'use strict';

  function asBool(value, fallback) {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  function resolveTypeKey(type) {
    return type?.key || type?.type_key || type?.certificate_type || type?.code || '';
  }

  function resolveTypeName(type) {
    return type?.certificate_name || type?.name || type?.label || type?.title || type?.certificate_type || resolveTypeKey(type);
  }

  function normalizeCertificateType(row) {
    if (!row) return null;
    const key = resolveTypeKey(row);
    const active = row.is_active != null
      ? asBool(row.is_active, true)
      : (!row.status || row.status === 'active');
    return {
      id: row.id || null,
      key,
      certificate_name: resolveTypeName(row),
      name: resolveTypeName(row),
      issuer_name: row.issuer_name || '',
      description: row.description || row.short_description || '',
      price: Number(row.price ?? row.default_price ?? 0) || 0,
      is_active: active,
      status: active ? 'active' : 'inactive'
    };
  }

  function buildTypeCatalog(types) {
    const map = {};
    (types || []).forEach(row => {
      const t = normalizeCertificateType(row);
      if (!t?.key) return;
      map[t.key] = t;
      if (t.id) map[t.id] = t;
    });
    return map;
  }

  /** تطبيع صف course_certificates — الأعمدة الجديدة فقط */
  function normalizeCourseCertificate(row) {
    if (!row) return null;

    const rowId = row.id || null;
    const name = String(row.certificate_name || '').trim() || 'شهادة';
    const price = Number(row.price) || 0;

    return {
      id: rowId,
      course_id: row.course_id || null,
      key: rowId ? String(rowId) : '',
      certificate_name: name,
      name,
      issuer_name: String(row.issuer_name || '').trim(),
      description: String(row.description || '').trim(),
      price,
      is_enabled: asBool(row.is_enabled, false),
      show_to_student: asBool(row.show_to_student, true),
      included_in_course: asBool(row.included_in_course, false),
      is_optional_purchase: asBool(row.is_optional_purchase, false)
    };
  }

  function dedupeCourseCertificates(certs) {
    const seen = new Set();
    return (certs || []).filter(cert => {
      if (!cert) return false;
      const id = cert.id || cert.key;
      if (!id) return true;
      const token = String(id);
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
  }

  function isPaidCourse(course) {
    return !!(course && (course.paid === true || course.type === 'paid') && Number(course.price) > 0);
  }

  function isVisibleToStudent(cert) {
    return cert && cert.is_enabled && cert.show_to_student;
  }

  function isIncludedInCourse(cert) {
    return asBool(cert?.included_in_course, false);
  }

  function isOptionalPurchase(cert) {
    return asBool(cert?.is_optional_purchase, false);
  }

  function getVisibleForStudent(certs) {
    return dedupeCourseCertificates((certs || []).filter(isVisibleToStudent));
  }

  function getSelectableForFreeCourse(certs) {
    return getVisibleForStudent(certs).filter(isOptionalPurchase);
  }

  function getIncludedForPaidCourse(certs) {
    return getVisibleForStudent(certs).filter(isIncludedInCourse);
  }

  function buildIncludedRegistrationPayload(certs) {
    return getIncludedForPaidCourse(certs).map(c => ({
      key: String(c.id || ''),
      certificate_type_id: c.id || null,
      label: c.certificate_name || c.name,
      issuer_name: c.issuer_name,
      price: 0,
      included: true
    }));
  }

  function buildSelectedRegistrationPayload(selectedCerts) {
    return (selectedCerts || []).map(c => ({
      key: String(c.id || c.key || ''),
      certificate_type_id: c.id || null,
      label: c.label || c.certificate_name || c.name,
      issuer_name: c.issuer_name || '',
      price: Number(c.price) || 0,
      included: false
    }));
  }

  function getCertificatesTotalPrice(certs) {
    return (certs || []).reduce((sum, c) => sum + (Number(c.price) || 0), 0);
  }

  function calculateCheckoutAmount(course, selectedCerts) {
    const coursePrice = Number(course?.price) || 0;
    if (isPaidCourse(course)) return coursePrice;
    return getCertificatesTotalPrice(selectedCerts);
  }

  function requiresPayment(course, selectedCerts) {
    return calculateCheckoutAmount(course, selectedCerts) > 0;
  }

  global.InexcCertificateSystem = {
    normalizeCertificateType,
    normalizeCourseCertificate,
    buildTypeCatalog,
    dedupeCourseCertificates,
    isPaidCourse,
    isVisibleToStudent,
    isIncludedInCourse,
    isOptionalPurchase,
    getVisibleForStudent,
    getSelectableForFreeCourse,
    getIncludedForPaidCourse,
    buildIncludedRegistrationPayload,
    buildSelectedRegistrationPayload,
    getCertificatesTotalPrice,
    calculateCheckoutAmount,
    requiresPayment,
    resolveTypeKey,
    resolveTypeName
  };
})(typeof window !== 'undefined' ? window : globalThis);
