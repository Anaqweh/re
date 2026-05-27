/**
 * INEXC — نظام الحضور والغياب الذكي (API مشترك)
 */
(function (global) {
  'use strict';

  const SESSIONS_TABLE = 'training_sessions';
  const RECORDS_TABLE = 'attendance_records';
  const QR_TTL_MS = 60000;
  const DEFAULT_MIN_ATTENDANCE = 75;

  const STATUS = {
    present: { key: 'present', label: 'حاضر', className: 'att-status-present', weight: 1, color: '#047857' },
    late: { key: 'late', label: 'متأخر', className: 'att-status-late', weight: 0.85, color: '#c2410c' },
    absent: { key: 'absent', label: 'غائب', className: 'att-status-absent', weight: 0, color: '#b91c1c' },
    excused: { key: 'excused', label: 'غائب بعذر', className: 'att-status-excused', weight: 1, color: '#2563eb' },
    partial: { key: 'partial', label: 'حضر جزئيًا', className: 'att-status-partial', weight: 0.5, color: '#7c3aed' },
    present_no_participation: { key: 'present_no_participation', label: 'حضر ولم يشارك', className: 'att-status-no-part', weight: 0.75, color: '#64748b' },
    present_engaged: { key: 'present_engaged', label: 'حاضر ومتفاعل', className: 'att-status-engaged', weight: 1, color: '#b89960' }
  };

  const STATUS_LIST = Object.values(STATUS);

  const SESSION_STATUS = {
    scheduled: 'مجدولة',
    active: 'جارية',
    completed: 'منتهية',
    cancelled: 'ملغاة'
  };

  let sessionsCache = [];
  let recordsCache = [];
  let tablesReady = null;

  function isTableMissingError(error) {
    const msg = String(error?.message || error || '').toLowerCase();
    return msg.includes('schema cache') ||
      msg.includes('could not find the table') ||
      msg.includes('relation') && msg.includes('does not exist');
  }

  function formatSetupError(error) {
    if (isTableMissingError(error)) {
      return 'جداول الحضور غير موجودة في Supabase. افتح SQL Editor ونفّذ ملف smart-attendance-setup.sql ثم حدّث الصفحة.';
    }
    return error?.message || String(error);
  }

  async function checkTablesReady() {
    const supabase = getClient();
    if (!supabase) {
      tablesReady = false;
      return false;
    }
    const { error } = await supabase.from(SESSIONS_TABLE).select('id').limit(1);
    if (error && isTableMissingError(error)) {
      tablesReady = false;
      return false;
    }
    tablesReady = !error;
    return tablesReady;
  }

  function statusMeta(key) {
    return STATUS[key] || STATUS.absent;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('ar-AE', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return String(v);
    }
  }

  function getClient() {
    return global.supabaseClient;
  }

  function generateToken() {
    if (global.crypto?.randomUUID) {
      return global.crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    }
    return 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function buildCheckInUrl(sessionId, token) {
    const base = (global.location?.origin || '').replace(/\/$/, '');
    return base + '/attendance-checkin.html?s=' + encodeURIComponent(sessionId) + '&t=' + encodeURIComponent(token);
  }

  function qrImageUrl(url) {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(url);
  }

  function mapSession(row) {
    if (!row) return null;
    return {
      id: row.id,
      course_id: row.course_id,
      course_name: row.course_name || '',
      trainer_name: row.trainer_name || '',
      title: row.title || '',
      session_date: row.session_date,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      late_after_minutes: Number(row.late_after_minutes) || 15,
      min_attendance_percent: Number(row.min_attendance_percent) || DEFAULT_MIN_ATTENDANCE,
      status: row.status || 'scheduled',
      statusLabel: SESSION_STATUS[row.status] || row.status,
      current_qr_token: row.current_qr_token || '',
      qr_token_expires_at: row.qr_token_expires_at,
      notes: row.notes || '',
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function mapRecord(row) {
    if (!row) return null;
    const st = statusMeta(row.status);
    return {
      id: row.id,
      session_id: row.session_id,
      registration_id: row.registration_id,
      trainee_profile_id: row.trainee_profile_id,
      course_id: row.course_id,
      course_name: row.course_name || '',
      trainee_name: row.trainee_name || '',
      trainee_email: row.trainee_email || '',
      trainee_phone: row.trainee_phone || '',
      check_in_at: row.check_in_at,
      check_out_at: row.check_out_at,
      partial_percent: row.partial_percent != null ? Number(row.partial_percent) : null,
      excuse_notes: row.excuse_notes || '',
      status: row.status || 'absent',
      statusLabel: st.label,
      statusClass: st.className,
      check_in_source: row.check_in_source || 'manual',
      notes: row.notes || '',
      created_at: row.created_at
    };
  }

  function recordWeight(rec) {
    if (!rec) return 0;
    if (rec.status === 'partial') {
      const pct = rec.partial_percent != null ? Number(rec.partial_percent) : 50;
      return Math.min(1, Math.max(0, pct / 100));
    }
    return statusMeta(rec.status).weight || 0;
  }

  function determineCheckInStatus(session, checkInAt) {
    const at = new Date(checkInAt || Date.now());
    const start = new Date(session.starts_at || session.session_date || Date.now());
    const lateMs = (Number(session.late_after_minutes) || 15) * 60 * 1000;
    if (at > new Date(start.getTime() + lateMs)) return 'late';
    return 'present';
  }

  /** مدة الجلسة بالميلي ثانية — للحساب التلقائي لنسبة الحضور */
  function getSessionDurationMs(session) {
    const start = new Date(session.starts_at || session.session_date || Date.now()).getTime();
    let end = session.ends_at ? new Date(session.ends_at).getTime() : start + 2 * 60 * 60 * 1000;
    if (!Number.isFinite(end) || end <= start) end = start + 2 * 60 * 60 * 1000;
    return end - start;
  }

  /** نسبة الحضور من أوقات الدخول/الخروج مقارنةً بمدة الجلسة */
  function computePartialPercentFromTimes(session, checkInAt, checkOutAt) {
    if (!checkInAt || !checkOutAt) return null;
    const sessionMs = getSessionDurationMs(session);
    if (!sessionMs) return null;
    const ci = new Date(checkInAt).getTime();
    const co = new Date(checkOutAt).getTime();
    if (!Number.isFinite(ci) || !Number.isFinite(co) || co <= ci) return null;
    const attendedMs = co - ci;
    const pct = Math.round((attendedMs / sessionMs) * 100);
    return Math.min(100, Math.max(0, pct));
  }

  /**
   * اشتقاق الحالة ونسبة الحضور تلقائيًا من الأوقات
   * — عدّل FULL_ATTENDANCE_THRESHOLD هنا لتغيير متى يُعتبر الحضور كاملًا
   */
  const FULL_ATTENDANCE_THRESHOLD = 95;

  function deriveAttendanceFromTimes(session, checkInAt, checkOutAt, opts) {
    opts = opts || {};
    const preserve = opts.preserveManualStatus &&
      ['excused', 'present_engaged', 'present_no_participation'].includes(opts.currentStatus);

    if (!checkInAt) {
      return { status: preserve ? opts.currentStatus : 'absent', partial_percent: null };
    }

    const onTimeStatus = determineCheckInStatus(session, checkInAt);

    if (!checkOutAt) {
      return {
        status: preserve ? opts.currentStatus : onTimeStatus,
        partial_percent: null
      };
    }

    const partialPct = computePartialPercentFromTimes(session, checkInAt, checkOutAt);

    if (partialPct == null) {
      return { status: preserve ? opts.currentStatus : onTimeStatus, partial_percent: null };
    }

    if (partialPct < FULL_ATTENDANCE_THRESHOLD) {
      return {
        status: preserve ? opts.currentStatus : 'partial',
        partial_percent: partialPct
      };
    }

    return {
      status: preserve ? opts.currentStatus : onTimeStatus,
      partial_percent: partialPct
    };
  }

  function computeSessionReport(sessionId, registrations, records) {
    const session = sessionsCache.find(s => s.id === sessionId);
    const recs = (records || recordsCache).filter(r => r.session_id === sessionId);
    const regs = registrations || [];

    const counts = {};
    STATUS_LIST.forEach(s => { counts[s.key] = 0; });

    let scoreSum = 0;
    const byStatus = {};
    STATUS_LIST.forEach(s => { byStatus[s.key] = []; });

    // يشمل مسجّلي الدورة + المضافين يدويًا/مستوردين من attendance_records
    const iterateList = recs.length
      ? recs.map(rec => ({
          name: rec.trainee_name || '—',
          email: rec.trainee_email || '',
          rec,
          status: rec.status || 'absent'
        }))
      : regs.map(reg => ({
          name: reg.full_name || '—',
          email: reg.email || '',
          rec: recs.find(r => String(r.registration_id) === String(reg.id)) || null,
          status: recs.find(r => String(r.registration_id) === String(reg.id))?.status || 'absent'
        }));

    iterateList.forEach(item => {
      const status = item.status || 'absent';
      counts[status] = (counts[status] || 0) + 1;
      const w = recordWeight(item.rec || { status: 'absent' });
      scoreSum += w;
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push({ name: item.name, email: item.email, record: item.rec });
    });

    const total = iterateList.length || 1;
    const overallPercent = Math.round((scoreSum / total) * 100);

    return {
      session,
      counts,
      overallPercent,
      total,
      present: counts.present || 0,
      late: counts.late || 0,
      absent: counts.absent || 0,
      excused: counts.excused || 0,
      partial: counts.partial || 0,
      present_no_participation: counts.present_no_participation || 0,
      present_engaged: counts.present_engaged || 0,
      byStatus
    };
  }

  function computeAttendancePercent(records, sessions, opts) {
    const courseId = opts?.courseId || null;
    const courseName = opts?.courseName || '';
    const registrationId = opts?.registrationId != null ? String(opts.registrationId) : null;
    const traineeEmail = (opts?.traineeEmail || '').toLowerCase().trim();

    const relevantSessions = (sessions || sessionsCache).filter(s => {
      if (s.status === 'cancelled') return false;
      if (courseId && s.course_id && String(s.course_id) === String(courseId)) return true;
      if (courseName && s.course_name === courseName) return true;
      return false;
    });

    const relevantRecords = (records || recordsCache).filter(r => {
      if (registrationId && String(r.registration_id) === registrationId) return true;
      if (traineeEmail && (r.trainee_email || '').toLowerCase() === traineeEmail) return true;
      return false;
    });

    if (!relevantSessions.length) {
      return { percent: 100, attended: 0, total: 0, minRequired: DEFAULT_MIN_ATTENDANCE, eligible: true };
    }

    const sessionIds = new Set(relevantSessions.map(s => s.id));
    const bySession = new Map();
    relevantRecords.forEach(r => {
      if (sessionIds.has(r.session_id)) bySession.set(r.session_id, r);
    });

    let score = 0;
    let minRequired = DEFAULT_MIN_ATTENDANCE;
    relevantSessions.forEach(s => {
      minRequired = Math.max(minRequired, Number(s.min_attendance_percent) || DEFAULT_MIN_ATTENDANCE);
      const rec = bySession.get(s.id);
      score += recordWeight(rec);
    });

    const percent = Math.round((score / relevantSessions.length) * 100);
    return {
      percent,
      attended: Math.round(score * 10) / 10,
      total: relevantSessions.length,
      minRequired,
      eligible: percent >= minRequired
    };
  }

  async function loadSessions() {
    const supabase = getClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .select('*')
      .order('starts_at', { ascending: false });
    if (error) {
      console.warn('loadSessions:', error.message);
      if (isTableMissingError(error)) tablesReady = false;
      sessionsCache = [];
      return [];
    }
    sessionsCache = (data || []).map(mapSession);
    return sessionsCache;
  }

  async function loadRecords() {
    const supabase = getClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from(RECORDS_TABLE)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('loadRecords:', error.message);
      recordsCache = [];
      return [];
    }
    recordsCache = (data || []).map(mapRecord);
    return recordsCache;
  }

  async function loadAll() {
    await Promise.all([loadSessions(), loadRecords()]);
    return { sessions: sessionsCache, records: recordsCache };
  }

  async function rotateQrToken(sessionId) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase غير متصل');

    const token = generateToken();
    const expires = new Date(Date.now() + QR_TTL_MS).toISOString();
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .update({
        current_qr_token: token,
        qr_token_expires_at: expires,
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (error) throw error;
    const mapped = mapSession(data);
    const idx = sessionsCache.findIndex(s => s.id === sessionId);
    if (idx >= 0) sessionsCache[idx] = mapped;
    return mapped;
  }

  async function validateToken(sessionId, token) {
    const supabase = getClient();
    let session = sessionsCache.find(s => s.id === sessionId);
    if (!session && supabase) {
      const { data } = await supabase.from(SESSIONS_TABLE).select('*').eq('id', sessionId).maybeSingle();
      session = mapSession(data);
    }

    if (!session) return { ok: false, error: 'الجلسة غير موجودة' };
    if (session.status === 'cancelled' || session.status === 'completed') {
      return { ok: false, error: 'الجلسة غير نشطة' };
    }
    if (!token || token !== session.current_qr_token) {
      return { ok: false, error: 'رمز QR غير صالح — امسح الرمز الحالي' };
    }
    if (session.qr_token_expires_at && new Date(session.qr_token_expires_at) < new Date()) {
      return { ok: false, error: 'انتهت صلاحية الرمز — امسح الرمز الجديد' };
    }
    return { ok: true, session };
  }

  function isSessionOpenForPortal(session) {
    if (!session || session.status === 'cancelled' || session.status === 'completed') return false;
    const now = Date.now();
    const start = new Date(session.starts_at || session.session_date || now).getTime() - 15 * 60 * 1000;
    const end = new Date(session.ends_at || start + 3 * 60 * 60 * 1000).getTime() + 30 * 60 * 1000;
    return now >= start && now <= end;
  }

  async function recordCheckIn(payload) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase غير متصل');

    const session = payload.session || sessionsCache.find(s => s.id === payload.session_id);
    if (!session) throw new Error('الجلسة غير موجودة');

    const checkInAt = payload.check_in_at || new Date().toISOString();
    const status = payload.status || determineCheckInStatus(session, checkInAt);

    const row = {
      session_id: session.id,
      registration_id: payload.registration_id || null,
      trainee_profile_id: payload.trainee_profile_id || null,
      course_id: session.course_id || payload.course_id || null,
      course_name: session.course_name || payload.course_name || '',
      trainee_name: payload.trainee_name || '',
      trainee_email: payload.trainee_email || '',
      trainee_phone: payload.trainee_phone || '',
      check_in_at: ['absent', 'excused'].includes(status) ? (payload.check_in_at || null) : checkInAt,
      check_out_at: payload.check_out_at || null,
      partial_percent: payload.partial_percent != null ? Number(payload.partial_percent) : null,
      excuse_notes: payload.excuse_notes || '',
      status,
      check_in_source: payload.check_in_source || 'qr',
      notes: payload.notes || '',
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from(RECORDS_TABLE)
      .upsert([row], { onConflict: 'session_id,registration_id' })
      .select('*')
      .single();

    if (error) throw error;
    const mapped = mapRecord(data);
    recordsCache = recordsCache.filter(r => !(r.session_id === mapped.session_id && String(r.registration_id) === String(mapped.registration_id)));
    recordsCache.unshift(mapped);
    if (status === 'present_engaged' && payload.trainee_profile_id) {
      await awardEngagementBadge(payload.trainee_profile_id, session);
    }
    return mapped;
  }

  async function awardEngagementBadge(traineeProfileId, session) {
    const supabase = getClient();
    if (!supabase || !traineeProfileId) return;
    try {
      await supabase.from('trainee_badges').upsert([{
        trainee_id: traineeProfileId,
        badge_key: 'attendance_engaged_' + (session.course_id || session.course_name || 'course').toString().slice(0, 36),
        badge_name: 'متدرب متفاعل — ' + (session.course_name || 'INEXC'),
        badge_icon: '⭐'
      }], { onConflict: 'trainee_id,badge_key' });
      await supabase.from('trainee_notifications').insert([{
        trainee_id: traineeProfileId,
        title: 'شارة تميز — متدرب متفاعل',
        body: 'تم منحك شارة التميز لالتزامك وتفاعلك في جلسة «' + (session.title || session.course_name) + '».',
        read: false
      }]);
    } catch (err) {
      console.warn('awardEngagementBadge:', err.message || err);
    }
  }

  function sessionRecordByEmail(sessionId, email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;
    return recordsCache.find(r =>
      r.session_id === sessionId &&
      String(r.trainee_email || '').trim().toLowerCase() === normalized
    ) || null;
  }

  /** تهيئة سجل حضور لكل متدرب مسجّل في الدورة (بدون استبدال السجلات الموجودة) */
  async function seedSessionRoster(session, registrations) {
    const list = registrations || [];
    let created = 0;
    for (const reg of list) {
      const exists = recordsCache.some(r =>
        r.session_id === session.id &&
        String(r.registration_id) === String(reg.id)
      );
      if (exists) continue;

      await saveRecord({
        session,
        registration_id: reg.id,
        trainee_profile_id: reg.trainee_profile_id || null,
        trainee_name: reg.full_name || reg.name || '',
        trainee_email: reg.email || '',
        trainee_phone: reg.phone || '',
        status: 'absent',
        check_in_source: 'roster',
        skipAbsentNotify: true
      });
      created += 1;
    }
    return { created };
  }

  /** تحويل نص حالة الحضور (عربي/إنجلizi) إلى مفتاح النظام */
  function normalizeStatusKey(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const byKey = STATUS_LIST.find(s => s.key === raw);
    if (byKey) return byKey.key;
    const byLabel = STATUS_LIST.find(s => s.label === String(value).trim() || s.label.toLowerCase() === raw);
    if (byLabel) return byLabel.key;
    const aliases = {
      present: 'present', late: 'late', absent: 'absent', excused: 'excused', partial: 'partial',
      present_no_participation: 'present_no_participation', present_engaged: 'present_engaged',
      'حاضر': 'present', 'متأخر': 'late', 'غائب': 'absent',
      'غائب بعذر': 'excused', 'حضر جزئيًا': 'partial', 'حضر جزئيا': 'partial',
      'حضر ولم يشارك': 'present_no_participation', 'حاضر ومتفاعل': 'present_engaged'
    };
    return aliases[raw] || aliases[String(value).trim()] || '';
  }

  /** إضافة متدرب يدويًا إلى جلسة — يمنع تكرار البريد في نفس الجلسة */
  async function addManualAttendanceRecord(sessionId, data) {
    const session = sessionsCache.find(s => s.id === sessionId);
    if (!session) throw new Error('الجلسة غير موجودة');

    const email = String(data.trainee_email || data.email || '').trim().toLowerCase();
    const name = String(data.trainee_name || data.full_name || '').trim();
    if (!name && !email) throw new Error('أدخل اسم المتدرب أو البريد الإلكتروني');

    if (email && sessionRecordByEmail(sessionId, email)) {
      throw new Error('البريد الإلكتروني مسجّل مسبقاً في هذه الجلسة');
    }

    const courseRegs = data.registrations || [];
    const matched = email
      ? courseRegs.find(r => String(r.email || '').trim().toLowerCase() === email)
      : null;

    return saveRecord({
      session,
      session_id: sessionId,
      registration_id: matched?.id || data.registration_id || null,
      trainee_profile_id: matched?.trainee_profile_id || data.trainee_profile_id || null,
      trainee_name: name || matched?.full_name || '',
      trainee_email: email,
      trainee_phone: data.trainee_phone || data.phone || matched?.phone || '',
      course_name: data.course_name || session.course_name || '',
      status: normalizeStatusKey(data.status) || 'absent',
      check_in_at: data.check_in_at || null,
      check_out_at: data.check_out_at || null,
      partial_percent: data.partial_percent != null && data.partial_percent !== '' ? Number(data.partial_percent) : null,
      excuse_notes: data.excuse_notes || '',
      notes: data.notes || '',
      check_in_source: 'manual',
      skipAbsentNotify: true
    });
  }

  /** تحديث حالة/بيانات سجل حضور موجود — للتعديل من جدول الجلسة */
  async function updateAttendanceStatus(recordId, payload) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase غير متصل');

    let existing = recordsCache.find(r => r.id === recordId);
    if (!existing) {
      const { data, error } = await supabase
        .from(RECORDS_TABLE)
        .select('*')
        .eq('id', recordId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('سجل الحضور غير موجود');
      existing = mapRecord(data);
      recordsCache.unshift(existing);
    }

    const session = sessionsCache.find(s => s.id === existing.session_id);
    if (!session) throw new Error('الجلسة غير موجودة');

    const email = payload.trainee_email != null
      ? String(payload.trainee_email).trim().toLowerCase()
      : String(existing.trainee_email || '').trim().toLowerCase();

    if (email) {
      const dup = recordsCache.find(r =>
        r.session_id === existing.session_id &&
        r.id !== recordId &&
        String(r.trainee_email || '').trim().toLowerCase() === email
      );
      if (dup) throw new Error('البريد الإلكتروني مستخدم لمتدرب آخر في هذه الجلسة');
    }

    return saveRecord({
      record_id: recordId,
      session,
      session_id: existing.session_id,
      registration_id: payload.registration_id !== undefined ? payload.registration_id : existing.registration_id,
      trainee_profile_id: payload.trainee_profile_id ?? existing.trainee_profile_id,
      trainee_name: payload.trainee_name ?? existing.trainee_name,
      trainee_email: email || existing.trainee_email,
      trainee_phone: payload.trainee_phone ?? existing.trainee_phone,
      status: payload.status != null ? (normalizeStatusKey(payload.status) || payload.status) : existing.status,
      check_in_at: payload.check_in_at !== undefined ? payload.check_in_at : existing.check_in_at,
      check_out_at: payload.check_out_at !== undefined ? payload.check_out_at : existing.check_out_at,
      partial_percent: payload.partial_percent !== undefined ? payload.partial_percent : existing.partial_percent,
      excuse_notes: payload.excuse_notes !== undefined ? payload.excuse_notes : existing.excuse_notes,
      notes: payload.notes !== undefined ? payload.notes : existing.notes,
      check_in_source: payload.check_in_source ?? existing.check_in_source,
      skipAbsentNotify: payload.skipAbsentNotify ?? true
    });
  }

  /** حذف سجل حضور من الجلسة */
  async function deleteAttendanceRecord(recordId) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase غير متصل');

    const existing = recordsCache.find(r => r.id === recordId);
    if (!existing) throw new Error('سجل الحضور غير موجود');

    const { error } = await supabase.from(RECORDS_TABLE).delete().eq('id', recordId);
    if (error) throw error;

    recordsCache = recordsCache.filter(r => r.id !== recordId);
    return { ok: true, id: recordId };
  }

  /** استيراد متدرب إلى الجلسة مع منع التكرار بالبريد */
  async function importTraineeToSession(session, row, registrations) {
    const email = String(row.email || row.trainee_email || row.Email || row['البريد'] || '').trim().toLowerCase();
    if (!email && !row.full_name && !row.trainee_name) return { ok: false, error: 'صف فارغ' };
    if (!email) return { ok: false, error: 'بريد فارغ' };

    if (sessionRecordByEmail(session.id, email)) {
      return { ok: false, skipped: true, error: 'البريد مسجّل مسبقاً في الجلسة' };
    }

    const courseRegs = registrations || [];
    const matched = courseRegs.find(r => String(r.email || '').trim().toLowerCase() === email);
    const statusKey = normalizeStatusKey(row.status) || 'absent';

    await saveRecord({
      session,
      registration_id: matched?.id || null,
      trainee_profile_id: matched?.trainee_profile_id || null,
      trainee_name: row.full_name || row.trainee_name || row.name || row['الاسم'] || matched?.full_name || '',
      trainee_email: email,
      trainee_phone: row.phone || row['الهاتف'] || matched?.phone || '',
      course_name: row.course_name || row['الدورة'] || session.course_name,
      status: statusKey,
      notes: row.notes || row['الملاحظات'] || '',
      check_in_source: 'import',
      skipAbsentNotify: true
    });
    return { ok: true };
  }

  async function saveRecord(payload) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase غير متصل');

    const session = payload.session || sessionsCache.find(s => s.id === payload.session_id);
    if (!session) throw new Error('الجلسة غير موجودة');

    const status = payload.status || 'absent';
    const now = new Date().toISOString();
    let checkInAt = payload.check_in_at;

    const autoCheckInStatuses = ['present', 'late', 'present_engaged', 'present_no_participation'];
    if (!checkInAt && autoCheckInStatuses.includes(status)) {
      checkInAt = now;
    }

    const row = {
      session_id: session.id,
      registration_id: payload.registration_id ?? null,
      trainee_profile_id: payload.trainee_profile_id || null,
      course_id: session.course_id || payload.course_id || null,
      course_name: session.course_name || payload.course_name || '',
      trainee_name: payload.trainee_name || '',
      trainee_email: payload.trainee_email || '',
      trainee_phone: payload.trainee_phone || '',
      check_in_at: checkInAt ?? null,
      check_out_at: payload.check_out_at !== undefined ? payload.check_out_at : null,
      partial_percent: payload.partial_percent != null && payload.partial_percent !== '' ? Number(payload.partial_percent) : null,
      excuse_notes: payload.excuse_notes || '',
      status,
      check_in_source: payload.check_in_source || 'admin',
      notes: payload.notes || '',
      updated_at: now
    };

    const recordId = payload.record_id || payload.id || null;
    let existing = null;

    if (recordId) {
      existing = recordsCache.find(r => r.id === recordId) || null;
    }
    if (!existing && payload.registration_id) {
      existing = recordsCache.find(r =>
        r.session_id === session.id &&
        String(r.registration_id) === String(payload.registration_id)
      );
    }
    if (!existing && payload.trainee_email) {
      existing = sessionRecordByEmail(session.id, payload.trainee_email);
    }

    let data;
    let error;

    // تحديث مباشر بالمعرّف — الأكثر موثوقية عند الحفظ من جدول الجلسة
    if (recordId) {
      ({ data, error } = await supabase
        .from(RECORDS_TABLE)
        .update(row)
        .eq('id', recordId)
        .select('*')
        .maybeSingle());

      if (error) throw error;
      if (!data) throw new Error('تعذّر تحديث السجل — تحقق من صلاحيات Supabase');
    } else if (existing?.id) {
      ({ data, error } = await supabase
        .from(RECORDS_TABLE)
        .update(row)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle());
      if (error) throw error;
      if (!data) throw new Error('تعذّر تحديث السجل');
    } else {
      ({ data, error } = await supabase
        .from(RECORDS_TABLE)
        .upsert([row], { onConflict: 'session_id,registration_id' })
        .select('*')
        .maybeSingle());
      if (error) throw error;
      if (!data) throw new Error('تعذّر حفظ السجل');
    }
    const mapped = mapRecord(data);
    recordsCache = recordsCache.filter(r => r.id !== mapped.id);
    recordsCache.unshift(mapped);

    if (status === 'absent' && !payload.skipAbsentNotify) await notifyAbsent(payload.trainee_profile_id, session);
    if (status === 'present_engaged' && payload.trainee_profile_id) {
      await awardEngagementBadge(payload.trainee_profile_id, session);
    }
    return mapped;
  }

  async function notifyAbsent(traineeProfileId, session) {
    if (!traineeProfileId) return;
    const supabase = getClient();
    if (!supabase) return;
    await supabase.from('trainee_notifications').insert([{
      trainee_id: traineeProfileId,
      title: 'تنبيه غياب — ' + (session.title || session.course_name),
      body: 'لم يُسجّل حضورك في الجلسة التدريبية. يرجى التواصل مع الإدارة إذا كان لديك عذر.',
      read: false
    }]);
  }

  async function finalizeSession(sessionId, registrations) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase غير متصل');

    const session = sessionsCache.find(s => s.id === sessionId);
    if (!session) throw new Error('الجلسة غير موجودة');

    const existing = recordsCache.filter(r => r.session_id === sessionId);
    const existingRegIds = new Set(existing.map(r => String(r.registration_id)));

    const toMarkAbsent = (registrations || []).filter(r => {
      const regId = String(r.id || r.registration_id);
      return regId && !existingRegIds.has(regId);
    });

    for (const reg of toMarkAbsent) {
      const row = {
        session_id: sessionId,
        registration_id: reg.id || reg.registration_id,
        trainee_profile_id: reg.trainee_profile_id || null,
        course_id: session.course_id || reg.course_id || null,
        course_name: session.course_name || reg.course_name || reg.course || '',
        trainee_name: reg.full_name || reg.name || '',
        trainee_email: reg.email || '',
        trainee_phone: reg.phone || '',
        status: 'absent',
        check_in_source: 'system',
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabase
        .from(RECORDS_TABLE)
        .upsert([row], { onConflict: 'session_id,registration_id' })
        .select('*')
        .single();
      if (!error && data) {
        recordsCache.unshift(mapRecord(data));
        await notifyAbsent(reg.trainee_profile_id, session);
      }
    }

    await supabase.from(SESSIONS_TABLE).update({
      status: 'completed',
      current_qr_token: '',
      qr_token_expires_at: null,
      updated_at: new Date().toISOString()
    }).eq('id', sessionId);

    const idx = sessionsCache.findIndex(s => s.id === sessionId);
    if (idx >= 0) sessionsCache[idx].status = 'completed';
    return { absentCount: toMarkAbsent.length };
  }

  async function canIssueCertificate(registrationId, courseId, courseName) {
    try { await loadAll(); } catch (_) {}
    const stats = computeAttendancePercent(recordsCache, sessionsCache, {
      registrationId,
      courseId,
      courseName
    });

    if (stats.total === 0) {
      return { ok: true, stats, message: '' };
    }

    if (!stats.eligible) {
      return {
        ok: false,
        stats,
        message: 'لا يمكن إصدار الشهادة — نسبة الحضور ' + stats.percent + '% أقل من المطلوب (' + stats.minRequired + '%)'
      };
    }

    return { ok: true, stats, message: '' };
  }

  function getSessions() { return sessionsCache.slice(); }
  function getRecords() { return recordsCache.slice(); }

  global.InexcAttendance = {
    SESSIONS_TABLE,
    RECORDS_TABLE,
    QR_TTL_MS,
    DEFAULT_MIN_ATTENDANCE,
    STATUS,
    STATUS_LIST,
    SESSION_STATUS,
    statusMeta,
    recordWeight,
    computeSessionReport,
    escapeHtml,
    fmtDate,
    generateToken,
    buildCheckInUrl,
    qrImageUrl,
    mapSession,
    mapRecord,
    determineCheckInStatus,
    getSessionDurationMs,
    computePartialPercentFromTimes,
    deriveAttendanceFromTimes,
    FULL_ATTENDANCE_THRESHOLD,
    computeAttendancePercent,
    loadSessions,
    loadRecords,
    loadAll,
    checkTablesReady,
    isTableMissingError,
    formatSetupError,
    rotateQrToken,
    validateToken,
    isSessionOpenForPortal,
    recordCheckIn,
    saveRecord,
    seedSessionRoster,
    importTraineeToSession,
    addManualAttendanceRecord,
    updateAttendanceStatus,
    deleteAttendanceRecord,
    normalizeStatusKey,
    sessionRecordByEmail,
    awardEngagementBadge,
    notifyAbsent,
    finalizeSession,
    canIssueCertificate,
    getSessions,
    getRecords,
    get tablesReady() { return tablesReady; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
