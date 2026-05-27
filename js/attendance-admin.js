/**
 * INEXC — إدارة الحضور والغياب (لوحة التحكم)
 */
(function (global) {
  'use strict';

  const Att = global.InexcAttendance;
  if (!Att) {
    console.warn('InexcAttendance missing — load js/attendance-api.js first');
    return;
  }

  let coursesLocal = [];
  let registrationsLocal = [];
  let liveSessionId = null;
  let qrTimer = null;
  let qrCountdownTimer = null;
  let filterCourse = 'all';
  let filterStatus = 'all';
  let activeTab = 'sessions';

  function getClient() { return global.supabaseClient; }

  async function loadCoursesAndRegs() {
    const supabase = getClient();
    if (!supabase) return;
    const [{ data: courses }, { data: regs }] = await Promise.all([
      supabase.from('courses').select('id, name, status').order('name'),
      supabase.from('registrations').select('id, full_name, email, phone, course_id, course_name, trainee_profile_id, status, admin_hidden')
        .or('admin_hidden.is.null,admin_hidden.eq.false')
    ]);
    coursesLocal = courses || [];
    registrationsLocal = (regs || []).filter(r => r.status !== 'inactive');
  }

  function regsForCourse(session) {
    const cid = session.course_id;
    const cname = session.course_name;
    return registrationsLocal.filter(r => {
      if (cid && r.course_id && String(r.course_id) === String(cid)) return true;
      if (cname && r.course_name === cname) return true;
      return false;
    });
  }

  function computeStats() {
    const sessions = Att.getSessions();
    const records = Att.getRecords();
    const active = sessions.filter(s => s.status === 'active').length;
    const today = new Date().toDateString();
    const todayCheckins = records.filter(r => r.check_in_at && new Date(r.check_in_at).toDateString() === today).length;
    const absentToday = records.filter(r => r.status === 'absent' && r.created_at && new Date(r.created_at).toDateString() === today).length;

    let avgPercent = 0;
    let count = 0;
    registrationsLocal.forEach(r => {
      const st = Att.computeAttendancePercent(records, sessions, {
        registrationId: r.id,
        courseId: r.course_id,
        courseName: r.course_name
      });
      if (st.total > 0) {
        avgPercent += st.percent;
        count += 1;
      }
    });

    return {
      totalSessions: sessions.length,
      activeSessions: active,
      todayCheckins,
      absentToday,
      avgPercent: count ? Math.round(avgPercent / count) : 0
    };
  }

  function renderStats() {
    const s = computeStats();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('attStatSessions', s.totalSessions);
    set('attStatActive', s.activeSessions);
    set('attStatCheckins', s.todayCheckins);
    set('attStatAvg', s.avgPercent + '%');
  }

  function filteredSessions() {
    let rows = Att.getSessions();
    if (filterCourse !== 'all') {
      rows = rows.filter(s => String(s.course_id) === filterCourse || s.course_name === filterCourse);
    }
    if (filterStatus !== 'all') rows = rows.filter(s => s.status === filterStatus);
    return rows;
  }

  function renderSessionsTable() {
    const tbody = document.getElementById('attSessionsTableBody');
    const meta = document.getElementById('attSessionsMeta');
    if (!tbody) return;

    const rows = filteredSessions();
    if (meta) meta.textContent = rows.length + ' جلسة';

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">لا توجد جلسات — أنشئ جلسة جديدة</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(s => {
      const recs = Att.getRecords().filter(r => r.session_id === s.id);
      const present = recs.filter(r => !['absent', 'excused'].includes(r.status)).length;
      return `<tr>
        <td><strong>${Att.escapeHtml(s.title)}</strong><br><small>${Att.escapeHtml(s.course_name)}</small></td>
        <td>${Att.escapeHtml(s.trainer_name || '—')}</td>
        <td>${Att.fmtDate(s.starts_at)}</td>
        <td><span class="att-session-pill att-session-${s.status}">${Att.escapeHtml(s.statusLabel)}</span></td>
        <td>${present} / ${regsForCourse(s).length || recs.length}</td>
        <td>${s.min_attendance_percent}%</td>
        <td>${Att.fmtDate(s.created_at)}</td>
        <td class="actions-cell">
          ${s.status !== 'completed' && s.status !== 'cancelled' ? `<button type="button" class="btn btn-sm btn-gold att-live-btn" data-id="${s.id}">QR مباشر</button>` : ''}
          <button type="button" class="btn btn-sm btn-outline att-detail-btn" data-id="${s.id}">التفاصيل</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.att-live-btn').forEach(btn => {
      btn.addEventListener('click', () => openLiveQr(btn.dataset.id));
    });
    tbody.querySelectorAll('.att-detail-btn').forEach(btn => {
      btn.addEventListener('click', () => openSessionDetail(btn.dataset.id));
    });
  }

  function renderTraineeRates() {
    const tbody = document.getElementById('attRatesTableBody');
    if (!tbody) return;

    const sessions = Att.getSessions();
    const records = Att.getRecords();
    const rows = registrationsLocal.map(r => {
      const st = Att.computeAttendancePercent(records, sessions, {
        registrationId: r.id,
        courseId: r.course_id,
        courseName: r.course_name
      });
      return { reg: r, stats: st };
    }).filter(x => x.stats.total > 0);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">لا توجد بيانات حضور بعد</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(({ reg, stats }) => {
      const ok = stats.eligible;
      return `<tr>
        <td>${Att.escapeHtml(reg.full_name)}</td>
        <td dir="ltr">${Att.escapeHtml(reg.email)}</td>
        <td>${Att.escapeHtml(reg.course_name)}</td>
        <td><strong class="${ok ? 'att-rate-ok' : 'att-rate-bad'}">${stats.percent}%</strong></td>
        <td>${stats.attended} / ${stats.total}</td>
        <td>${stats.minRequired}%</td>
      </tr>`;
    }).join('');
  }

  function populateCourseFilters() {
    const sel = document.getElementById('attCourseFilter');
    const formSel = document.getElementById('attSessionCourse');
    if (!sel && !formSel) return;

    const options = coursesLocal.map(c =>
      `<option value="${Att.escapeHtml(c.id)}">${Att.escapeHtml(c.name)}</option>`
    ).join('');

    if (sel) {
      sel.innerHTML = '<option value="all">كل الدورات</option>' + options;
      sel.value = filterCourse;
    }
    if (formSel) {
      formSel.innerHTML = '<option value="">— اختر الدورة —</option>' + options;
    }
  }

  function renderSetupBanner(visible) {
    const banner = document.getElementById('attSetupBanner');
    if (banner) banner.classList.toggle('hidden', !visible);
  }

  async function ensureReady() {
    const ok = await Att.checkTablesReady();
    renderSetupBanner(!ok);
    return ok;
  }

  function showAttError(error) {
    global.showActionError?.(Att.formatSetupError(error));
  }

  function renderAttendancePage() {
    renderSetupBanner(global.InexcAttendance?.tablesReady === false);
    renderStats();
    populateCourseFilters();
    if (activeTab === 'sessions') renderSessionsTable();
    if (activeTab === 'rates') renderTraineeRates();
  }

  function stopQrTimers() {
    if (qrTimer) { clearInterval(qrTimer); qrTimer = null; }
    if (qrCountdownTimer) { clearInterval(qrCountdownTimer); qrCountdownTimer = null; }
    liveSessionId = null;
  }

  async function refreshLiveQr(sessionId) {
    const session = await Att.rotateQrToken(sessionId);
    liveSessionId = sessionId;
    const url = Att.buildCheckInUrl(session.id, session.current_qr_token);
    const img = document.getElementById('attQrImage');
    const urlEl = document.getElementById('attQrUrl');
    const titleEl = document.getElementById('attQrTitle');
    if (img) img.src = Att.qrImageUrl(url);
    if (urlEl) urlEl.textContent = url;
    if (titleEl) titleEl.textContent = session.title + ' — ' + session.course_name;

    let seconds = Math.floor(Att.QR_TTL_MS / 1000);
    const countdownEl = document.getElementById('attQrCountdown');
    if (countdownEl) countdownEl.textContent = String(seconds);

    if (qrCountdownTimer) clearInterval(qrCountdownTimer);
    qrCountdownTimer = setInterval(() => {
      seconds -= 1;
      if (countdownEl) countdownEl.textContent = String(Math.max(0, seconds));
      if (seconds <= 0 && liveSessionId === sessionId) refreshLiveQr(sessionId);
    }, 1000);
  }

  async function openLiveQr(sessionId) {
    const modal = document.getElementById('attLiveQrModal');
    if (!modal) return;
    stopQrTimers();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    await refreshLiveQr(sessionId);
    qrTimer = setInterval(() => {
      if (liveSessionId === sessionId) refreshLiveQr(sessionId);
    }, Att.QR_TTL_MS);
  }

  function closeLiveQr() {
    stopQrTimers();
    const modal = document.getElementById('attLiveQrModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  /** جلب متدربي دورة محددة من registrations */
  function getCourseRegistrations(courseId, courseName) {
    return registrationsLocal.filter(r => {
      if (courseId && r.course_id && String(r.course_id) === String(courseId)) return true;
      if (courseName && r.course_name === courseName) return true;
      return false;
    });
  }

  /** بناء قائمة حضور الجلسة: مسجلون + مستوردون */
  function buildRosterRows(session) {
    const regs = regsForCourse(session);
    const recs = Att.getRecords().filter(r => r.session_id === session.id);
    const rows = [];
    const seenEmails = new Set();

    regs.forEach(reg => {
      const email = String(reg.email || '').trim().toLowerCase();
      seenEmails.add(email);
      const rec = recs.find(r => String(r.registration_id) === String(reg.id));
      rows.push({ reg, rec, key: 'reg-' + reg.id });
    });

    recs.forEach(rec => {
      const email = String(rec.trainee_email || '').trim().toLowerCase();
      if (!email || seenEmails.has(email)) return;
      if (rec.registration_id && regs.some(r => String(r.id) === String(rec.registration_id))) return;
      seenEmails.add(email);
      rows.push({ reg: null, rec, key: 'rec-' + (rec.id || email) });
    });

    return rows;
  }

  function renderFormTraineePreview() {
    const courseId = document.getElementById('attSessionCourse')?.value;
    const preview = document.getElementById('attSessionTraineePreview');
    const listEl = document.getElementById('attPreviewList');
    const countEl = document.getElementById('attPreviewCount');
    if (!preview) return;

    if (!courseId) {
      preview.classList.add('hidden');
      return;
    }

    const course = coursesLocal.find(c => String(c.id) === String(courseId));
    const regs = getCourseRegistrations(courseId, course?.name);
    if (countEl) countEl.textContent = String(regs.length);

    if (!regs.length) {
      listEl.innerHTML = '<p class="att-preview-empty">لا يوجد متدربون مسجلون في هذه الدورة بعد</p>';
    } else {
      listEl.innerHTML = `<ul class="att-preview-names">${regs.map(r =>
        `<li><strong>${Att.escapeHtml(r.full_name)}</strong> <span dir="ltr">${Att.escapeHtml(r.email)}</span>${r.phone ? ' · ' + Att.escapeHtml(r.phone) : ''}</li>`
      ).join('')}</ul>`;
    }
    preview.classList.remove('hidden');
  }

  let currentDetailSessionId = null;

  /** تسميات مصدر تسجيل الحضور — للعرض في الجدول وExcel */
  const SOURCE_LABELS = {
    admin: 'لوحة التحكم',
    manual: 'إضافة يدوية',
    roster: 'قائمة الدورة',
    import: 'استيراد Excel',
    qr: 'QR',
    system: 'النظام'
  };

  function sourceLabel(key) {
    return SOURCE_LABELS[key] || key || '—';
  }

  /** خيارات نسبة الحضور الجزئي — عدّل القيم هنا مستقبلًا */
  const PARTIAL_PERCENT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  /** حالات يدوية لا يُعاد حسابها تلقائيًا عند الحفظ */
  const MANUAL_PRESERVE_STATUSES = ['excused', 'present_engaged', 'present_no_participation', 'partial'];

  function partialSelectOptionsHtml(selectedValue, className, id) {
    const num = selectedValue != null && selectedValue !== '' ? Number(selectedValue) : null;
    const idAttr = id ? ` id="${id}"` : '';
    let extra = '';
    if (num != null && !Number.isNaN(num) && !PARTIAL_PERCENT_OPTIONS.includes(num)) {
      extra = `<option value="${num}" selected>${num}%</option>`;
    }
    return `<select class="${className}"${idAttr}>
      <option value="">— اختر —</option>
      ${PARTIAL_PERCENT_OPTIONS.map(p =>
        `<option value="${p}" ${num === p ? 'selected' : ''}>${p}%</option>`
      ).join('')}
      ${extra}
    </select>`;
  }

  function readPartialValue(container) {
    if (!container) return null;
    const sel = container.querySelector?.('.att-row-partial-select') || container;
    if (sel.tagName === 'SELECT' || sel.classList?.contains('att-row-partial-select')) {
      const v = sel.value;
      return v !== '' && v != null ? Number(v) : null;
    }
    const v = container.value ?? container;
    return v !== '' && v != null ? Number(v) : null;
  }

  function statusOptionsHtml(selected) {
    return Att.STATUS_LIST.map(s =>
      `<option value="${s.key}" ${selected === s.key ? 'selected' : ''}>${s.label}</option>`
    ).join('');
  }

  /** صفوف جدول حضور الجلسة — مرتبة حسب الاسم */
  function getSessionTableRows(session) {
    const regs = regsForCourse(session);
    const recs = Att.getRecords()
      .filter(r => r.session_id === session.id)
      .slice()
      .sort((a, b) => (a.trainee_name || '').localeCompare(b.trainee_name || '', 'ar'));

    return recs.map((rec, idx) => {
      const reg = regs.find(r => String(r.id) === String(rec.registration_id));
      return {
        index: idx + 1,
        reg,
        rec,
        key: rec.id || ('rec-' + (rec.trainee_email || idx))
      };
    });
  }

  /** بناء صفوف Excel بترتيب الأعمدة الموحّد */
  function buildSessionExcelRows(sessionId) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return [];
    return getSessionTableRows(session).map(({ index, reg, rec }) => ({
      'رقم': index,
      'اسم المتدرب': reg?.full_name || rec?.trainee_name || '',
      'البريد': reg?.email || rec?.trainee_email || '',
      'الهاتف': reg?.phone || rec?.trainee_phone || '',
      'حالة الحضور': Att.statusMeta(rec?.status || 'absent').label,
      'وقت الدخول': rec?.check_in_at || '',
      'وقت الخروج': rec?.check_out_at || '',
      'نسبة الحضور': rec?.partial_percent ?? '',
      'سبب الغياب': rec?.excuse_notes || '',
      'المصدر': sourceLabel(rec?.check_in_source),
      'الملاحظات': rec?.notes || ''
    }));
  }

  /** صف متدرب — ترتيب الأعمدة: رقم، اسم، بريد، هاتف، حالة، أوقات، نسبة، عذر، مصدر، ملاحظات، إجراءات */
  function renderTimeCell(rec, field, btnLabel, btnClass) {
    const val = rec?.[field];
    const display = val ? Att.fmtDate(val) : '—';
    const inputVal = val ? toLocalInput(new Date(val)) : '';
    const inputClass = field === 'check_in_at' ? 'att-row-checkin' : 'att-row-checkout';
    const colClass = field === 'check_in_at' ? 'att-checkin-col' : 'att-checkout-col';
    return `<div class="att-time-col ${colClass}">
      <span class="att-time-display">${Att.escapeHtml(display)}</span>
      <input type="datetime-local" class="${inputClass} att-time-input hidden" value="${inputVal}">
      <button type="button" class="att-btn-mini btn-gold ${btnClass}">${btnLabel}</button>
      <button type="button" class="att-time-manual-btn" data-field="${field === 'check_in_at' ? 'checkin' : 'checkout'}">تعديل يدوي</button>
    </div>`;
  }

  function renderPartialCell(rec) {
    const pct = rec?.partial_percent;
    return `<div class="att-partial-wrap">
      ${partialSelectOptionsHtml(pct, 'att-row-partial-select att-row-partial', '')}
    </div>`;
  }

  function readRowTime(tr, field, recordId) {
    const col = tr.querySelector(field === 'check_in_at' ? '.att-checkin-col' : '.att-checkout-col');
    const input = col?.querySelector('.att-time-input');
    if (input?.value) return new Date(input.value).toISOString();
    const rec = Att.getRecords().find(r => r.id === recordId);
    return rec?.[field] || null;
  }

  async function recordCheckInNow(sessionId, tr) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    const recordId = tr?.dataset?.recordId;
    if (!session || !recordId) return;
    const now = new Date().toISOString();
    const checkOutAt = readRowTime(tr, 'check_out_at', recordId);
    const derived = Att.deriveAttendanceFromTimes(session, now, checkOutAt);
    try {
      await Att.updateAttendanceStatus(recordId, {
        check_in_at: now,
        check_out_at: checkOutAt,
        status: derived.status,
        partial_percent: derived.partial_percent,
        check_in_source: 'admin'
      });
      global.showActionSuccess?.('تم تسجيل الدخول — ' + Att.statusMeta(derived.status).label);
      await Att.loadRecords();
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      global.showActionError?.(Att.formatSetupError(err) || err.message);
    }
  }

  async function recordCheckOutNow(sessionId, tr) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    const recordId = tr?.dataset?.recordId;
    if (!session || !recordId) return;
    const checkInAt = readRowTime(tr, 'check_in_at', recordId);
    if (!checkInAt) {
      global.showActionError?.('سجّل الدخول أولاً');
      return;
    }
    const now = new Date().toISOString();
    const derived = Att.deriveAttendanceFromTimes(session, checkInAt, now);
    try {
      await Att.updateAttendanceStatus(recordId, {
        check_in_at: checkInAt,
        check_out_at: now,
        status: derived.status,
        partial_percent: derived.partial_percent,
        check_in_source: 'admin'
      });
      const msg = derived.partial_percent != null
        ? 'تم تسجيل الخروج — نسبة الحضور ' + derived.partial_percent + '%'
        : 'تم تسجيل الخروج — ' + Att.statusMeta(derived.status).label;
      global.showActionSuccess?.(msg);
      await Att.loadRecords();
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      global.showActionError?.(Att.formatSetupError(err) || err.message);
    }
  }

  function renderTraineeTableRow(row) {
    const reg = row.reg;
    const rec = row.rec;
    const recId = rec?.id || '';
    const name = reg?.full_name || rec?.trainee_name || '—';
    const email = reg?.email || rec?.trainee_email || '';
    const phone = reg?.phone || rec?.trainee_phone || '';
    const curStatus = rec?.status || 'absent';
    const st = Att.statusMeta(curStatus);
    const srcKey = rec?.check_in_source || 'manual';

    return `<tr class="att-trainee-row" data-record-id="${Att.escapeHtml(recId)}" data-row-key="${Att.escapeHtml(row.key)}">
      <td class="att-col-num">${row.index}</td>
      <td><strong class="att-row-name">${Att.escapeHtml(name)}</strong></td>
      <td dir="ltr">${Att.escapeHtml(email)}</td>
      <td dir="ltr">${Att.escapeHtml(phone || '—')}</td>
      <td class="att-col-status">
        <select class="att-status-select">
          ${statusOptionsHtml(curStatus)}
        </select>
        <span class="att-status-pill ${st.className}">${Att.escapeHtml(st.label)}</span>
      </td>
      <td>${renderTimeCell(rec, 'check_in_at', 'تسجيل الدخول الآن', 'att-checkin-now-btn')}</td>
      <td>${renderTimeCell(rec, 'check_out_at', 'تسجيل الخروج الآن', 'att-checkout-now-btn')}</td>
      <td>${renderPartialCell(rec)}</td>
      <td><input type="text" class="att-row-excuse" placeholder="سبب الغياب" value="${Att.escapeHtml(rec?.excuse_notes || '')}"></td>
      <td class="att-col-source"><span class="att-source-pill att-source-${Att.escapeHtml(srcKey)}">${Att.escapeHtml(sourceLabel(srcKey))}</span></td>
      <td><input type="text" class="att-row-notes" placeholder="ملاحظات" value="${Att.escapeHtml(rec?.notes || '')}"></td>
      <td class="att-col-actions">
        <button type="button" class="btn btn-sm btn-gold att-row-save">حفظ التعديل</button>
        <button type="button" class="btn btn-sm btn-outline att-row-delete">حذف من الجلسة</button>
        <button type="button" class="btn btn-sm btn-outline att-row-notes-btn">تعديل الملاحظات</button>
      </td>
    </tr>`;
  }

  function renderSessionReportHtml(sessionId, regs) {
    const report = Att.computeSessionReport(sessionId, regs, Att.getRecords());
    return `
      <div class="att-session-report">
        <h4>التقرير النهائي للجلسة</h4>
        <div class="att-report-stats">
          <div class="att-report-stat att-status-present"><span>حاضر</span><strong>${report.present}</strong></div>
          <div class="att-report-stat att-status-late"><span>متأخر</span><strong>${report.late}</strong></div>
          <div class="att-report-stat att-status-absent"><span>غائب</span><strong>${report.absent}</strong></div>
          <div class="att-report-stat att-status-excused"><span>غائب بعذر</span><strong>${report.excused}</strong></div>
          <div class="att-report-stat att-status-partial"><span>جزئي</span><strong>${report.partial}</strong></div>
          <div class="att-report-stat att-status-no-part"><span>لم يشارك</span><strong>${report.present_no_participation}</strong></div>
          <div class="att-report-stat att-status-engaged"><span>متفاعل</span><strong>${report.present_engaged}</strong></div>
          <div class="att-report-stat att-report-overall"><span>نسبة الحضور</span><strong>${report.overallPercent}%</strong></div>
        </div>
        <div class="att-report-groups">
          ${Att.STATUS_LIST.map(st => {
            const items = report.byStatus[st.key] || [];
            if (!items.length) return '';
            return `<div class="att-report-group">
              <h5><span class="att-status-pill ${st.className}">${st.label}</span> (${items.length})</h5>
              <ul>${items.map(i => `<li>${Att.escapeHtml(i.name)}</li>`).join('')}</ul>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  async function openSessionDetail(sessionId) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return;

    currentDetailSessionId = sessionId;
    const modal = document.getElementById('attSessionDetailModal');
    const body = document.getElementById('attSessionDetailBody');
    if (!modal || !body) return;

    const regs = regsForCourse(session);
    await Att.seedSessionRoster(session, regs);
    await Att.loadRecords();

    const tableRows = getSessionTableRows(session);

    body.innerHTML = `
      <div class="att-detail-head">
        <div>
          <h3>${Att.escapeHtml(session.title)}</h3>
          <p>${Att.escapeHtml(session.course_name)} · ${Att.escapeHtml(session.trainer_name || '—')} · ${tableRows.length} متدرب</p>
        </div>
        <span class="att-session-pill att-session-${session.status}">${Att.escapeHtml(session.statusLabel)}</span>
      </div>
      ${renderSessionReportHtml(sessionId, regs)}
      <div class="att-detail-actions-top att-excel-actions">
        ${session.status !== 'completed' ? `<button type="button" class="btn btn-sm btn-gold" id="attDetailLiveBtn">تشغيل QR</button>` : ''}
        ${session.status === 'active' ? `<button type="button" class="btn btn-sm" id="attDetailEndBtn">إنهاء الجلسة</button>` : ''}
        <button type="button" class="btn btn-sm btn-outline att-manual-add-btn" id="attManualAddBtn">إضافة متدرب يدويًا</button>
        <button type="button" class="btn btn-sm btn-outline" id="attDownloadTraineesExcelBtn">تحميل أسماء المتدربين Excel</button>
        <button type="button" class="btn btn-sm btn-outline" id="attImportTraineesExcelBtn">استيراد أسماء من Excel</button>
        <button type="button" class="btn btn-sm btn-outline" id="attExportExcelBtn">تصدير حضور Excel</button>
        <button type="button" class="btn btn-sm btn-outline" id="attExportPdfBtn">PDF</button>
      </div>
      <div class="table-wrap att-trainee-table-wrap">
        <table class="att-trainee-table att-full-table">
          <thead><tr>
            <th>رقم</th>
            <th>اسم المتدرب</th>
            <th>البريد الإلكتروني</th>
            <th>رقم الهاتف</th>
            <th>حالة الحضور</th>
            <th>وقت الدخول</th>
            <th>وقت الخروج</th>
            <th>نسبة الحضور الجزئي</th>
            <th>سبب الغياب</th>
            <th>المصدر</th>
            <th>ملاحظات</th>
            <th>إجراءات</th>
          </tr></thead>
          <tbody id="attDetailRecordsBody"></tbody>
        </table>
      </div>
      <div id="attDetailEmpty" class="att-detail-empty hidden"></div>`;

    const tbody = body.querySelector('#attDetailRecordsBody');
    const emptyEl = body.querySelector('#attDetailEmpty');

    if (!tableRows.length) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.innerHTML = `
        <p>لا يوجد متدربون مسجلون في هذه الدورة بعد</p>
        <div class="att-detail-empty-actions">
          <button type="button" class="btn btn-sm btn-gold" id="attManualAddEmptyBtn">إضافة متدرب يدويًا</button>
          <button type="button" class="btn btn-sm btn-outline" id="attImportTraineesEmptyBtn">استيراد أسماء من Excel</button>
        </div>`;
      emptyEl.querySelector('#attManualAddEmptyBtn')?.addEventListener('click', () => openManualTraineeModal(sessionId));
      emptyEl.querySelector('#attImportTraineesEmptyBtn')?.addEventListener('click', () => triggerImportExcel(sessionId));
    } else {
      emptyEl?.classList.add('hidden');
      tbody.innerHTML = tableRows.map(row => renderTraineeTableRow(row)).join('');
      bindDetailTableEvents(sessionId, body);
    }

    body.querySelector('#attDetailLiveBtn')?.addEventListener('click', () => {
      closeSessionDetail();
      openLiveQr(sessionId);
    });
    body.querySelector('#attDetailEndBtn')?.addEventListener('click', () => endSession(sessionId));
    body.querySelector('#attManualAddBtn')?.addEventListener('click', () => openManualTraineeModal(sessionId));
    body.querySelector('#attDownloadTraineesExcelBtn')?.addEventListener('click', () => downloadCourseTraineesExcel(sessionId));
    body.querySelector('#attImportTraineesExcelBtn')?.addEventListener('click', () => triggerImportExcel(sessionId));
    body.querySelector('#attExportExcelBtn')?.addEventListener('click', () => exportSessionExcel(sessionId));
    body.querySelector('#attExportPdfBtn')?.addEventListener('click', () => exportSessionPdf(sessionId));

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  /** فتح نافذة إضافة متدرب يدويًا — تُملأ الدورة من الجلسة الحالية */
  function openManualTraineeModal(sessionId) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    const modal = document.getElementById('attManualTraineeModal');
    if (!session || !modal) return;

    currentDetailSessionId = sessionId;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };

    setVal('attManualName', '');
    setVal('attManualEmail', '');
    setVal('attManualPhone', '');
    setVal('attManualCourseName', session.course_name || '');
    setVal('attManualStatus', 'absent');
    setVal('attManualCheckIn', '');
    setVal('attManualCheckOut', '');
    setVal('attManualPartial', '');
    setVal('attManualExcuse', '');
    setVal('attManualNotes', '');
    syncManualTimeDisplays();

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  /** تحديث عرض أوقات نموذج الإضافة اليدوية */
  function syncManualTimeDisplays() {
    const ci = document.getElementById('attManualCheckIn')?.value;
    const co = document.getElementById('attManualCheckOut')?.value;
    const ciDisp = document.getElementById('attManualCheckInDisplay');
    const coDisp = document.getElementById('attManualCheckOutDisplay');
    if (ciDisp) ciDisp.textContent = ci ? Att.fmtDate(new Date(ci).toISOString()) : '—';
    if (coDisp) coDisp.textContent = co ? Att.fmtDate(new Date(co).toISOString()) : '—';
  }

  /** تطبيق الحالة والنسبة المحسوبة على نموذج الإضافة اليدوية */
  function applyDerivedToManualForm() {
    const sessionId = currentDetailSessionId;
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return;

    syncManualTimeDisplays();
    const checkInVal = document.getElementById('attManualCheckIn')?.value;
    const checkOutVal = document.getElementById('attManualCheckOut')?.value;
    const checkInAt = checkInVal ? new Date(checkInVal).toISOString() : null;
    const checkOutAt = checkOutVal ? new Date(checkOutVal).toISOString() : null;
    const manualStatus = document.getElementById('attManualStatus')?.value || 'absent';
    const preserveManual = MANUAL_PRESERVE_STATUSES.includes(manualStatus);
    const derived = Att.deriveAttendanceFromTimes(session, checkInAt, checkOutAt, { currentStatus: manualStatus });

    if (!preserveManual) {
      const statusEl = document.getElementById('attManualStatus');
      if (statusEl) statusEl.value = derived.status;
    }
    const partialEl = document.getElementById('attManualPartial');
    if (partialEl) {
      const pct = derived.partial_percent;
      if (pct != null && partialEl.querySelector(`option[value="${pct}"]`)) {
        partialEl.value = String(pct);
      } else if (pct != null && !preserveManual) {
        partialEl.value = String(PARTIAL_PERCENT_OPTIONS.reduce((best, p) =>
          Math.abs(p - pct) < Math.abs(best - pct) ? p : best, PARTIAL_PERCENT_OPTIONS[0]));
      } else if (!preserveManual) {
        partialEl.value = '';
      }
    }
  }

  function manualCheckInNow() {
    const sessionId = currentDetailSessionId;
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return;
    const now = new Date();
    const el = document.getElementById('attManualCheckIn');
    if (el) el.value = toLocalInput(now);
    applyDerivedToManualForm();
  }

  function manualCheckOutNow() {
    const checkIn = document.getElementById('attManualCheckIn')?.value;
    if (!checkIn) {
      global.showActionError?.('سجّل الدخول أولاً');
      return;
    }
    const el = document.getElementById('attManualCheckOut');
    if (el) el.value = toLocalInput(new Date());
    applyDerivedToManualForm();
  }

  function toggleManualFormTime(field) {
    const isIn = field === 'checkin';
    document.getElementById(isIn ? 'attManualCheckInDisplay' : 'attManualCheckOutDisplay')?.classList.toggle('hidden');
    document.getElementById(isIn ? 'attManualCheckIn' : 'attManualCheckOut')?.classList.toggle('hidden');
  }

  function closeManualTraineeModal() {
    const modal = document.getElementById('attManualTraineeModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  /** حفظ متدرب مضاف يدويًا عبر attendance-api.addManualAttendanceRecord */
  async function saveManualTrainee(e) {
    e?.preventDefault();
    const sessionId = currentDetailSessionId;
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return;

    const name = document.getElementById('attManualName')?.value?.trim() || '';
    const email = document.getElementById('attManualEmail')?.value?.trim() || '';
    const phone = document.getElementById('attManualPhone')?.value?.trim() || '';
    const courseName = document.getElementById('attManualCourseName')?.value?.trim() || session.course_name || '';
    const checkInVal = document.getElementById('attManualCheckIn')?.value;
    const checkOutVal = document.getElementById('attManualCheckOut')?.value;
    const checkInAt = checkInVal ? new Date(checkInVal).toISOString() : null;
    const checkOutAt = checkOutVal ? new Date(checkOutVal).toISOString() : null;
    const manualStatus = document.getElementById('attManualStatus')?.value || 'absent';
    const preserveManual = MANUAL_PRESERVE_STATUSES.includes(manualStatus);
    const derived = Att.deriveAttendanceFromTimes(session, checkInAt, checkOutAt, { currentStatus: manualStatus });
    const status = preserveManual ? manualStatus : derived.status;
    const partialPercent = readPartialValue(document.getElementById('attManualPartial'))
      ?? (preserveManual ? null : derived.partial_percent);
    const excuseVal = document.getElementById('attManualExcuse')?.value?.trim() || '';
    const notesVal = document.getElementById('attManualNotes')?.value?.trim() || '';

    if (!name && !email) {
      global.showActionError?.('أدخل اسم المتدرب أو البريد الإلكتروني');
      return;
    }

    const submitBtn = e?.target?.querySelector?.('button[type="submit"]') ||
      document.querySelector('#attManualTraineeForm button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري الحفظ...';
    }

    try {
      await Att.addManualAttendanceRecord(sessionId, {
        trainee_name: name,
        trainee_email: email,
        trainee_phone: phone,
        course_name: courseName,
        status,
        check_in_at: checkInAt,
        check_out_at: checkOutAt,
        partial_percent: partialPercent,
        excuse_notes: excuseVal,
        notes: notesVal,
        registrations: regsForCourse(session)
      });
      closeManualTraineeModal();
      global.showActionSuccess?.('تمت إضافة المتدرب إلى الجلسة');
      await Att.loadRecords();
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      global.showActionError?.(Att.formatSetupError(err) || err.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'حفظ المتدرب';
      }
    }
  }

  function triggerImportExcel(sessionId) {
    currentDetailSessionId = sessionId;
    const input = document.getElementById('attImportExcelInput');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  /** ربط أحداث جدول حضور الجلسة — حفظ، حذف، تعديل ملاحظات */
  function bindDetailTableEvents(sessionId, bodyEl) {
    const tbody = bodyEl.querySelector('#attDetailRecordsBody');
    if (!tbody) return;

    tbody.querySelectorAll('.att-status-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const pill = sel.parentElement.querySelector('.att-status-pill');
        const meta = Att.statusMeta(sel.value);
        if (pill) {
          pill.className = 'att-status-pill ' + meta.className;
          pill.textContent = meta.label;
        }
      });
    });

    tbody.querySelectorAll('.att-row-partial-select').forEach(sel => {
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        const tr = sel.closest('tr');
        const statusSel = tr?.querySelector('.att-status-select');
        if (statusSel && statusSel.value !== 'partial') {
          statusSel.value = 'partial';
          statusSel.dispatchEvent(new Event('change'));
        }
      });
    });

    tbody.querySelectorAll('.att-row-save').forEach(btn => {
      btn.addEventListener('click', () => saveTraineeRow(sessionId, btn.closest('tr')));
    });

    tbody.querySelectorAll('.att-row-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteTraineeRow(sessionId, btn.closest('tr')));
    });

    tbody.querySelectorAll('.att-row-notes-btn').forEach(btn => {
      btn.addEventListener('click', () => editTraineeNotes(btn.closest('tr')));
    });

    tbody.querySelectorAll('.att-checkin-now-btn').forEach(btn => {
      btn.addEventListener('click', () => recordCheckInNow(sessionId, btn.closest('tr')));
    });

    tbody.querySelectorAll('.att-checkout-now-btn').forEach(btn => {
      btn.addEventListener('click', () => recordCheckOutNow(sessionId, btn.closest('tr')));
    });

    tbody.querySelectorAll('.att-time-manual-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleManualTimeEdit(btn.closest('tr'), btn.dataset.field));
    });
  }

  /** إظهار/إخفاء حقل الوقت اليدوي */
  function toggleManualTimeEdit(tr, field) {
    const col = tr?.querySelector(field === 'checkin' ? '.att-checkin-col' : '.att-checkout-col');
    if (!col) return;
    col.querySelector('.att-time-display')?.classList.toggle('hidden');
    col.querySelector('.att-time-input')?.classList.toggle('hidden');
  }

  function showDetailFeedback(type, message) {
    const body = document.getElementById('attSessionDetailBody');
    if (!body) {
      if (type === 'error') global.showActionError?.(message);
      else global.showActionSuccess?.(message);
      return;
    }
    let el = body.querySelector('.att-detail-feedback');
    if (!el) {
      el = document.createElement('div');
      el.className = 'att-detail-feedback';
      body.insertBefore(el, body.firstChild);
    }
    el.className = 'att-detail-feedback att-detail-feedback-' + type;
    el.textContent = message;
    if (type === 'success') {
      setTimeout(() => { if (el.parentNode) el.remove(); }, 3500);
    }
  }

  function readRowPayload(tr, session) {
    const recordId = tr.dataset.recordId;
    const checkInAt = readRowTime(tr, 'check_in_at', recordId);
    const checkOutAt = readRowTime(tr, 'check_out_at', recordId);
    const manualStatus = tr.querySelector('.att-status-select')?.value || 'absent';
    const preserveManual = MANUAL_PRESERVE_STATUSES.includes(manualStatus);

    let status = manualStatus;
    let partialPercent = readPartialValue(tr.querySelector('.att-partial-wrap') || tr.querySelector('.att-row-partial-select'));

    // إعادة الحساب التلقائي فقط للحالات العادية (حاضر/متأخر/غائب)
    if (session && !preserveManual) {
      const derived = Att.deriveAttendanceFromTimes(session, checkInAt, checkOutAt);
      status = derived.status;
      if (derived.partial_percent != null) partialPercent = derived.partial_percent;
      else if (!checkInAt) partialPercent = null;
    } else if (manualStatus === 'partial' && partialPercent == null && checkInAt && checkOutAt && session) {
      const derived = Att.deriveAttendanceFromTimes(session, checkInAt, checkOutAt);
      if (derived.partial_percent != null) partialPercent = derived.partial_percent;
    }

    return {
      status,
      check_in_at: checkInAt,
      check_out_at: checkOutAt,
      partial_percent: partialPercent,
      excuse_notes: tr.querySelector('.att-row-excuse')?.value?.trim() || '',
      notes: tr.querySelector('.att-row-notes')?.value?.trim() || '',
      check_in_source: 'admin'
    };
  }

  async function saveTraineeRow(sessionId, tr) {
    if (!tr) return;
    const recordId = tr.dataset.recordId;
    const session = Att.getSessions().find(s => s.id === sessionId);
    const saveBtn = tr.querySelector('.att-row-save');

    if (!recordId) {
      global.showActionError?.('سجل الحضور غير موجود');
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'جاري الحفظ...';
    }

    try {
      const payload = readRowPayload(tr, session);
      await Att.updateAttendanceStatus(recordId, payload);
      showDetailFeedback('success', 'تم حفظ التعديل بنجاح');
      global.showActionSuccess?.('تم حفظ التعديل');
      await Att.loadRecords();
      await Att.loadSessions();
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      const msg = Att.formatSetupError(err) || err.message || 'فشل الحفظ';
      showDetailFeedback('error', msg);
      global.showActionError?.(msg);
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'حفظ التعديل';
      }
    }
  }

  async function deleteTraineeRow(sessionId, tr) {
    if (!tr) return;
    const recordId = tr.dataset.recordId;
    const name = tr.querySelector('.att-row-name')?.textContent || 'المتدرب';
    if (!recordId) return;
    if (!confirm('حذف «' + name + '» من جلسة الحضور؟')) return;

    try {
      await Att.deleteAttendanceRecord(recordId);
      global.showActionSuccess?.('تم حذف المتدرب من الجلسة');
      await Att.loadRecords();
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      global.showActionError?.(Att.formatSetupError(err) || err.message);
    }
  }

  /** تعديل الملاحظات بنافذة سريعة ثم حفظ اختياري */
  function editTraineeNotes(tr) {
    if (!tr) return;
    const input = tr.querySelector('.att-row-notes');
    const current = input?.value || '';
    const updated = global.prompt('تعديل الملاحظات:', current);
    if (updated === null) return;
    if (input) input.value = updated;
  }

  async function saveTraineeStatus(sessionId, registrationId, status, regs, extras) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    const reg = (regs || registrationsLocal).find(r => String(r.id) === String(registrationId));
    if (!session || !reg) return;

    try {
      await Att.saveRecord({
        session_id: sessionId,
        session,
        registration_id: reg.id,
        trainee_profile_id: reg.trainee_profile_id || null,
        trainee_name: reg.full_name,
        trainee_email: reg.email,
        trainee_phone: reg.phone || '',
        status,
        check_in_source: 'admin',
        ...extras
      });
      global.showActionSuccess?.('تم حفظ حالة الحضور');
      await Att.loadRecords();
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      global.showActionError?.(Att.formatSetupError(err) || err.message);
    }
  }

  /** توحيد أعمدة ملف الاستيراد — أعمدة فارغة لا توقف العملية */
  function normalizeImportRow(raw) {
    const keys = Object.keys(raw || {});
    const pick = (...names) => {
      for (const name of names) {
        if (raw[name] !== undefined && String(raw[name]).trim() !== '') return String(raw[name]).trim();
        const match = keys.find(k => k.toLowerCase().replace(/\s+/g, '_') === name.toLowerCase());
        if (match && String(raw[match]).trim() !== '') return String(raw[match]).trim();
      }
      return '';
    };
    return {
      full_name: pick('full_name', 'trainee_name', 'الاسم', 'name', 'Name'),
      email: pick('email', 'trainee_email', 'البريد', 'Email'),
      phone: pick('phone', 'الهاتف', 'Phone'),
      course_name: pick('course_name', 'الدورة', 'Course'),
      status: pick('status', 'حالة الحضور', 'Status'),
      notes: pick('notes', 'الملاحظات', 'Notes')
    };
  }

  /** تحميل Excel — نفس ترتيب أعمدة جدول الحضور */
  function downloadCourseTraineesExcel(sessionId) {
    if (!global.XLSX) {
      global.showActionError?.('مكتبة Excel غير محمّلة');
      return;
    }
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return;

    const rows = buildSessionExcelRows(sessionId);
    const ws = global.XLSX.utils.json_to_sheet(rows);
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, ws, 'المتدربون');
    const safeName = (session.course_name || session.title || 'course').slice(0, 40).replace(/[^\w\u0600-\u06FF-]+/g, '_');
    global.XLSX.writeFile(wb, 'trainees-' + safeName + '.xlsx');
  }

  /** استيراد متدربين من Excel إلى جلسة الحضور (منع التكرار بالبريد) */
  async function importTraineesFromExcel(file) {
    if (!file) return;
    if (!global.XLSX) {
      global.showActionError?.('مكتبة Excel غير محمّلة');
      return;
    }

    const sessionId = currentDetailSessionId;
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) {
      global.showActionError?.('افتح تفاصيل الجلسة أولاً');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = global.XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = global.XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const regs = regsForCourse(session);

      let added = 0;
      let skipped = 0;
      let failed = 0;

      for (const raw of jsonRows) {
        const row = normalizeImportRow(raw);
        if (!row.email && !row.full_name) continue;

        const result = await Att.importTraineeToSession(session, row, regs);
        if (result.ok) added += 1;
        else if (result.skipped) skipped += 1;
        else failed += 1;
      }

      await Att.loadRecords();
      global.showActionSuccess?.('استيراد: ' + added + ' جديد، ' + skipped + ' مكرر، ' + failed + ' فشل');
      openSessionDetail(sessionId);
      renderAttendancePage();
    } catch (err) {
      global.showActionError?.(err.message || 'فشل قراءة ملف Excel');
    }
  }

  function closeSessionDetail() {
    const modal = document.getElementById('attSessionDetailModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  async function updateRecordStatus(sessionId, registrationId, status, regs) {
    await saveTraineeStatus(sessionId, registrationId, status, regs, {});
  }

  async function endSession(sessionId) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    if (!session) return;
    if (!confirm('إنهاء الجلسة وتسجيل الغائبين وإرسال التنبيهات؟')) return;

    try {
      const regs = regsForCourse(session);
      const result = await Att.finalizeSession(sessionId, regs);
      closeLiveQr();
      global.showActionSuccess?.('تم إنهاء الجلسة — غائبون: ' + result.absentCount);
      await refresh();
      openSessionDetail(sessionId);
    } catch (err) {
      global.showActionError?.(err.message || 'فشل إنهاء الجلسة');
    }
  }

  function openSessionForm() {
    const modal = document.getElementById('attSessionFormModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
    populateCourseFilters();
    const now = new Date();
    const start = document.getElementById('attSessionStart');
    const end = document.getElementById('attSessionEnd');
    const date = document.getElementById('attSessionDate');
    if (start) start.value = toLocalInput(now);
    if (end) end.value = toLocalInput(new Date(now.getTime() + 2 * 60 * 60 * 1000));
    if (date) date.value = now.toISOString().slice(0, 10);
    renderFormTraineePreview();
  }

  function closeSessionForm() {
    const modal = document.getElementById('attSessionFormModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function toLocalInput(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  async function saveSession(e) {
    e?.preventDefault();
    const supabase = getClient();
    if (!supabase) return;

    const courseId = document.getElementById('attSessionCourse')?.value;
    const course = coursesLocal.find(c => String(c.id) === String(courseId));
    const payload = {
      course_id: courseId || null,
      course_name: course?.name || '',
      trainer_name: document.getElementById('attSessionTrainer')?.value?.trim() || '',
      title: document.getElementById('attSessionTitle')?.value?.trim() || '',
      session_date: document.getElementById('attSessionDate')?.value || null,
      starts_at: document.getElementById('attSessionStart')?.value ? new Date(document.getElementById('attSessionStart').value).toISOString() : null,
      ends_at: document.getElementById('attSessionEnd')?.value ? new Date(document.getElementById('attSessionEnd').value).toISOString() : null,
      late_after_minutes: Number(document.getElementById('attSessionLate')?.value) || 15,
      min_attendance_percent: Number(document.getElementById('attSessionMinPct')?.value) || 75,
      status: 'scheduled',
      notes: document.getElementById('attSessionNotes')?.value?.trim() || ''
    };

    if (!payload.title || !courseId) {
      global.showActionError?.('أدخل عنوان الجلسة واختر الدورة');
      return;
    }

    const { data: inserted, error } = await supabase
      .from(Att.SESSIONS_TABLE)
      .insert([payload])
      .select('*')
      .single();
    if (error) {
      showAttError(error);
      return;
    }

    const session = Att.mapSession(inserted);
    const regs = getCourseRegistrations(session.course_id, session.course_name);
    if (regs.length) {
      await Att.seedSessionRoster(session, regs);
    }

    closeSessionForm();
    global.showActionSuccess?.('تم إنشاء الجلسة' + (regs.length ? ' مع ' + regs.length + ' متدرب' : ''));
    await refresh();
  }

  function exportSessionExcel(sessionId) {
    if (!global.XLSX) {
      global.showActionError?.('مكتبة Excel غير محمّلة');
      return;
    }
    const session = Att.getSessions().find(s => s.id === sessionId);
    const rows = buildSessionExcelRows(sessionId);
    const ws = global.XLSX.utils.json_to_sheet(rows);
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, ws, 'الحضور');
    global.XLSX.writeFile(wb, 'attendance-' + (session?.title || sessionId).slice(0, 30) + '.xlsx');
  }

  function exportSessionPdf(sessionId) {
    const session = Att.getSessions().find(s => s.id === sessionId);
    const recs = Att.getRecords().filter(r => r.session_id === sessionId);
    const regs = session ? regsForCourse(session) : [];
    const report = Att.computeSessionReport(sessionId, regs, recs);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
      <title>تقرير حضور — ${Att.escapeHtml(session?.title || '')}</title>
      <style>
        body{font-family:Tajawal,sans-serif;padding:32px;color:#1B2A4A}
        h1{margin:0 0 8px;font-size:1.4rem}
        p{color:#64748b;margin:0 0 16px}
        .stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px}
        .stat{padding:10px 14px;border-radius:10px;background:#f1f5f9;font-size:0.85rem}
        .stat strong{display:block;font-size:1.2rem;margin-top:4px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th,td{border:1px solid #e2e8f0;padding:10px;text-align:right;font-size:0.9rem}
        th{background:#1B2A4A;color:#fff}
      </style></head><body>
      <h1>التقرير النهائي — INEXC</h1>
      <p>${Att.escapeHtml(session?.title || '')} · ${Att.escapeHtml(session?.course_name || '')} · ${Att.fmtDate(session?.starts_at)}</p>
      <div class="stats">
        <div class="stat">حاضر<strong>${report.present}</strong></div>
        <div class="stat">متأخر<strong>${report.late}</strong></div>
        <div class="stat">غائب<strong>${report.absent}</strong></div>
        <div class="stat">بعذر<strong>${report.excused}</strong></div>
        <div class="stat">نسبة الحضور<strong>${report.overallPercent}%</strong></div>
      </div>
      <table><thead><tr><th>المتدرب</th><th>البريد</th><th>الحالة</th><th>دخول</th><th>خروج</th><th>نسبة</th></tr></thead><tbody>
      ${recs.map(r => `<tr><td>${Att.escapeHtml(r.trainee_name)}</td><td dir="ltr">${Att.escapeHtml(r.trainee_email)}</td><td>${Att.escapeHtml(r.statusLabel)}</td><td>${Att.fmtDate(r.check_in_at)}</td><td>${Att.fmtDate(r.check_out_at)}</td><td>${r.partial_percent ?? '—'}</td></tr>`).join('')}
      </tbody></table></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  function exportAllExcel() {
    if (!global.XLSX) return;
    const sessions = Att.getSessions();
    const records = Att.getRecords();
    const rows = records.map(r => {
      const s = sessions.find(x => x.id === r.session_id);
      return {
        'الجلسة': s?.title || '',
        'الدورة': r.course_name,
        'المتدرب': r.trainee_name,
        'البريد': r.trainee_email,
        'الحالة': r.statusLabel,
        'وقت الدخول': r.check_in_at || ''
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كل السجلات');
    XLSX.writeFile(wb, 'inexc-attendance-report.xlsx');
  }

  async function refresh() {
    await Att.loadAll();
    await ensureReady();
    await loadCoursesAndRegs();
    renderAttendancePage();
  }

  function bindEvents() {
    document.getElementById('attNewSessionBtn')?.addEventListener('click', openSessionForm);
    document.getElementById('attSessionFormClose')?.addEventListener('click', closeSessionForm);
    document.getElementById('attSessionForm')?.addEventListener('submit', saveSession);
    document.getElementById('attLiveQrClose')?.addEventListener('click', closeLiveQr);
    document.getElementById('attSessionDetailClose')?.addEventListener('click', closeSessionDetail);
    document.getElementById('attRefreshBtn')?.addEventListener('click', () => refresh());

    document.getElementById('attCourseFilter')?.addEventListener('change', e => {
      filterCourse = e.target.value || 'all';
      renderSessionsTable();
    });
    document.getElementById('attStatusFilter')?.addEventListener('change', e => {
      filterStatus = e.target.value || 'all';
      renderSessionsTable();
    });

    document.querySelectorAll('[data-att-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.attTab || 'sessions';
        document.querySelectorAll('[data-att-tab]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.att-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.attPanel === activeTab));
        renderAttendancePage();
      });
    });

    document.getElementById('attExportAllBtn')?.addEventListener('click', exportAllExcel);

    document.getElementById('attSessionCourse')?.addEventListener('change', renderFormTraineePreview);

    document.getElementById('attImportExcelInput')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) importTraineesFromExcel(file);
    });

    document.getElementById('attManualTraineeClose')?.addEventListener('click', closeManualTraineeModal);
    document.getElementById('attManualTraineeCancel')?.addEventListener('click', closeManualTraineeModal);
    document.getElementById('attManualTraineeForm')?.addEventListener('submit', saveManualTrainee);
    document.getElementById('attManualCheckInNow')?.addEventListener('click', manualCheckInNow);
    document.getElementById('attManualCheckOutNow')?.addEventListener('click', manualCheckOutNow);
    document.getElementById('attManualCheckInManual')?.addEventListener('click', () => toggleManualFormTime('checkin'));
    document.getElementById('attManualCheckOutManual')?.addEventListener('click', () => toggleManualFormTime('checkout'));
    document.getElementById('attManualCheckIn')?.addEventListener('change', applyDerivedToManualForm);
    document.getElementById('attManualCheckOut')?.addEventListener('change', applyDerivedToManualForm);

    // تعبئة قائمة حالات الحضور في نافذة الإضافة اليدوية — مرة واحدة
    const manualStatusSel = document.getElementById('attManualStatus');
    if (manualStatusSel && !manualStatusSel.dataset.ready) {
      manualStatusSel.innerHTML = Att.STATUS_LIST.map(s =>
        `<option value="${s.key}">${s.label}</option>`
      ).join('');
      manualStatusSel.dataset.ready = '1';
    }

    const manualPartialSel = document.getElementById('attManualPartial');
    if (manualPartialSel && !manualPartialSel.dataset.ready) {
      manualPartialSel.innerHTML = '<option value="">— اختر —</option>' +
        PARTIAL_PERCENT_OPTIONS.map(p => `<option value="${p}">${p}%</option>`).join('');
      manualPartialSel.dataset.ready = '1';
    }

    manualPartialSel?.addEventListener('change', () => {
      if (!manualPartialSel.value) return;
      const statusEl = document.getElementById('attManualStatus');
      if (statusEl) statusEl.value = 'partial';
    });

    ['attLiveQrModal', 'attSessionDetailModal', 'attSessionFormModal', 'attManualTraineeModal'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', e => {
        if (e.target.id === id) {
          if (id === 'attLiveQrModal') closeLiveQr();
          else if (id === 'attSessionDetailModal') closeSessionDetail();
          else if (id === 'attManualTraineeModal') closeManualTraineeModal();
          else closeSessionForm();
        }
      });
    });
  }

  global.InexcAttendanceAdmin = {
    loadCoursesAndRegs,
    refresh,
    renderAttendancePage,
    bindEvents,
    ensureReady,
    exportAllExcel
  };
})(window);
