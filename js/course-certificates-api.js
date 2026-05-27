/**
 * INEXC — خيارات الشهادات النصية المرتبطة بالدورة (بدون ملفات)
 */
(function (global) {
  'use strict';

  const CERT_COLUMNS =
    'id, course_id, certificate_name, issuer_name, description, price, is_enabled, show_to_student, included_in_course, is_optional_purchase';

  function asBool(value, fallback) {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  function normalizeCourseCertificateRow(row) {
    if (!row) return null;
    const rowId = row.id || null;
    return {
      id: rowId,
      course_id: row.course_id || null,
      key: rowId ? String(rowId) : '',
      certificate_name: String(row.certificate_name || '').trim(),
      name: String(row.certificate_name || '').trim(),
      issuer_name: String(row.issuer_name || '').trim(),
      description: String(row.description || '').trim(),
      price: Number(row.price) || 0,
      is_enabled: asBool(row.is_enabled, false),
      show_to_student: asBool(row.show_to_student, true),
      included_in_course: asBool(row.included_in_course, false),
      is_optional_purchase: asBool(row.is_optional_purchase, false)
    };
  }

  function dedupeCourseCertificates(certs) {
    const seen = new Set();
    return (certs || []).filter(cert => {
      if (!cert?.id) return !!cert;
      const token = String(cert.id);
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
  }

  function filterVisibleCourseCertificates(certs) {
    return dedupeCourseCertificates((certs || []).map(normalizeCourseCertificateRow).filter(Boolean))
      .filter(c => c.is_enabled && c.show_to_student);
  }

  function buildCourseCertRecord(cert, courseId) {
    return {
      course_id: courseId,
      certificate_name: String(cert.certificate_name || '').trim(),
      issuer_name: String(cert.issuer_name || '').trim(),
      description: String(cert.description || '').trim(),
      price: Number(cert.price) || 0,
      is_enabled: !!cert.is_enabled,
      show_to_student: !!cert.show_to_student,
      included_in_course: !!cert.included_in_course,
      is_optional_purchase: !!cert.is_optional_purchase
    };
  }

  async function fetchCourseCertificates(client, options) {
    if (!client) {
      console.error('fetchCourseCertificates: supabaseClient missing');
      return { data: [], error: new Error('supabaseClient missing') };
    }

    const opts = options || {};
    try {
      let query = client.from('course_certificates').select(CERT_COLUMNS);
      if (opts.courseId) query = query.eq('course_id', opts.courseId);
      query = query.order('id', { ascending: true });

      const { data, error } = await query;
      if (error) {
        console.error('course_certificates select failed:', error.message || error);
        return { data: [], error };
      }

      const mapped = (data || []).map(normalizeCourseCertificateRow).filter(Boolean);
      return { data: dedupeCourseCertificates(mapped), error: null };
    } catch (err) {
      console.error('fetchCourseCertificates exception:', err);
      return { data: [], error: err };
    }
  }

  async function saveCourseCertificateRecord(client, record, certId) {
    if (!client) throw new Error('supabaseClient missing');

    if (certId) {
      const { data, error } = await client
        .from('course_certificates')
        .update(record)
        .eq('id', certId)
        .select('id')
        .single();
      if (error) throw error;
      return data?.id || certId;
    }

    const { data, error } = await client
      .from('course_certificates')
      .insert([record])
      .select('id')
      .single();
    if (error) throw error;
    return data?.id || null;
  }

  global.InexcCourseCertificatesApi = {
    CERT_COLUMNS,
    normalizeCourseCertificateRow,
    dedupeCourseCertificates,
    filterVisibleCourseCertificates,
    buildCourseCertRecord,
    fetchCourseCertificates,
    saveCourseCertificateRecord
  };
})(typeof window !== 'undefined' ? window : globalThis);
