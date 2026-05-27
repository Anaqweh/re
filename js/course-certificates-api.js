/**
 * INEXC — خيارات الشهادات النصية المرتبطة بالدورة (بدون ملفات)
 */
(function (global) {
  'use strict';

  const CERT_COLUMNS = '*';

  function asBool(value, fallback) {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function resolveTypeKey(type) {
    return type?.key || type?.type_key || type?.certificate_type || type?.code || '';
  }

  function resolveTypeName(type) {
    return type?.certificate_name || type?.name || type?.label || type?.title || type?.certificate_type || resolveTypeKey(type);
  }

  function normalizeCourseCertificateRow(row, certificateType) {
    if (!row) return null;
    const rowId = row.id || null;
    const typeKey = resolveTypeKey(certificateType);
    const name = String(row.certificate_name || row.name || row.label || resolveTypeName(certificateType) || row.certificate_type || '').trim();
    const priceSource = hasValue(row.price)
      ? row.price
      : (hasValue(row.certificate_price)
        ? row.certificate_price
        : (hasValue(row.price_override)
          ? row.price_override
          : (certificateType?.price ?? certificateType?.default_price)));
    return {
      id: rowId,
      course_id: row.course_id || null,
      key: rowId ? String(rowId) : '',
      certificate_type_id: row.certificate_type_id || certificateType?.id || null,
      certificate_type: row.certificate_type || typeKey || '',
      certificate_name: name,
      name,
      issuer_name: String(row.issuer_name || certificateType?.issuer_name || '').trim(),
      description: String(row.description || row.short_description || certificateType?.description || certificateType?.short_description || '').trim(),
      price: Number(priceSource) || 0,
      is_enabled: row.is_enabled != null
        ? asBool(row.is_enabled, false)
        : (!row.status || row.status === 'active'),
      show_to_student: asBool(row.show_to_student, true),
      included_in_course: asBool(row.included_in_course ?? row.included_in_paid_course, false),
      is_optional_purchase: asBool(row.is_optional_purchase ?? row.allow_purchase_in_free_course, true)
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

  function buildCourseCertRecord(cert, courseId, courseName) {
    const name = String(cert.certificate_name || cert.name || cert.label || '').trim();
    const type = cert.certificate_type || cert.key || name || 'certificate';
    const price = Number(cert.price ?? cert.certificate_price) || 0;
    return {
      course_id: courseId,
      course_name: String(courseName || cert.course_name || '').trim(),
      certificate_type_id: cert.certificate_type_id || null,
      certificate_type: type,
      certificate_name: name,
      issuer_name: String(cert.issuer_name || '').trim(),
      description: String(cert.description || '').trim(),
      price,
      certificate_price: price,
      price_override: price > 0 ? price : null,
      is_enabled: !!cert.is_enabled,
      show_to_student: !!cert.show_to_student,
      included_in_course: !!cert.included_in_course,
      included_in_paid_course: !!cert.included_in_course,
      is_optional_purchase: !!cert.is_optional_purchase,
      allow_purchase_in_free_course: !!cert.is_optional_purchase,
      status: cert.is_enabled === false ? 'inactive' : 'active'
    };
  }

  function getMissingColumn(error) {
    const msg = error?.message || '';
    const match = msg.match(/Could not find the '([^']+)' column/i);
    if (match) return match[1];
    const lower = msg.toLowerCase();
    return [
      'certificate_type_id',
      'certificate_type',
      'course_id',
      'course_name',
      'certificate_name',
      'issuer_name',
      'description',
      'price',
      'certificate_price',
      'price_override',
      'is_enabled',
      'show_to_student',
      'included_in_course',
      'included_in_paid_course',
      'is_optional_purchase',
      'allow_purchase_in_free_course',
      'status'
    ].find(col => lower.includes(col) && (lower.includes('column') || lower.includes('schema cache'))) || null;
  }

  function mapTypesByKey(types) {
    const map = {};
    (types || []).forEach(type => {
      if (!type) return;
      if (type.id) map[String(type.id)] = type;
      const key = resolveTypeKey(type);
      if (key) map[String(key)] = type;
      const name = resolveTypeName(type);
      if (name) map[String(name).trim()] = type;
    });
    return map;
  }

  async function loadCertificateTypesForRows(client, rows) {
    const needsTypes = (rows || []).some(row => row?.certificate_type_id || row?.certificate_type);
    if (!needsTypes) return {};

    try {
      const ids = [...new Set((rows || []).map(row => row?.certificate_type_id).filter(Boolean).map(String))];
      const hasKeyOnlyRows = (rows || []).some(row => row?.certificate_type && !row?.certificate_type_id);
      let query = client.from('certificate_types').select('*');
      if (ids.length && !hasKeyOnlyRows) query = query.in('id', ids);
      const { data, error } = await query;
      if (error) {
        console.warn('certificate_types lookup failed:', error.message || error);
        return {};
      }
      return mapTypesByKey(data || []);
    } catch (err) {
      console.warn('certificate_types lookup exception:', err);
      return {};
    }
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

      const typeMap = await loadCertificateTypesForRows(client, data || []);
      const mapped = (data || []).map(row => {
        const type = typeMap[String(row.certificate_type_id || '')]
          || typeMap[String(row.certificate_type || '')]
          || null;
        return normalizeCourseCertificateRow(row, type);
      }).filter(Boolean);
      return { data: dedupeCourseCertificates(mapped), error: null };
    } catch (err) {
      console.error('fetchCourseCertificates exception:', err);
      return { data: [], error: err };
    }
  }

  async function saveCourseCertificateRecord(client, record, certId) {
    if (!client) throw new Error('supabaseClient missing');

    let payload = { ...record };
    const maxAttempts = Object.keys(payload).length + 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let result;
      if (certId) {
        result = await client
          .from('course_certificates')
          .update(payload)
          .eq('id', certId)
          .select('id')
          .single();
      } else {
        result = await client
          .from('course_certificates')
          .insert([payload])
          .select('id')
          .single();
      }

      if (!result.error) return result.data?.id || certId || null;

      const missingColumn = getMissingColumn(result.error);
      if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
        delete payload[missingColumn];
        continue;
      }

      throw result.error;
    }

    throw new Error('تعذّر حفظ شهادة الدورة — تحقق من أعمدة جدول course_certificates');
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
