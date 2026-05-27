/**
 * INEXC — إدارة طلبات مصادقة الشهادات (admin)
 */
(function (global) {
  'use strict';

  const Auth = global.InexcCertAuth;
  if (!Auth) {
    console.warn('InexcCertAuth module missing — load js/cert-auth-requests.js first');
    return;
  }

  let requestsCache = [];
  let eligibleCount = 0;
  let filterQuery = '';
  let filterStatus = 'all';
  let selectedRequestId = null;

  function fmtDate(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleDateString('ar-AE', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return String(v);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getClient() {
    return global.supabaseClient;
  }

  function filteredRequests() {
    let rows = requestsCache.slice();
    if (filterStatus !== 'all') rows = rows.filter(r => r.status === filterStatus);
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.full_name || '').toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(q)
      );
    }
    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function computeStats() {
    const newCount = requestsCache.filter(r => r.status === 'new').length;
    const approvedCount = requestsCache.filter(r => r.status === 'authenticated').length;
    const revenue = requestsCache
      .filter(r => r.payment_status === 'paid')
      .reduce((sum, r) => sum + (Number(r.payment_amount) || 0), 0);
    return { newCount, approvedCount, revenue, eligibleCount };
  }

  async function loadCertAuthRequests() {
    const supabase = getClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from(Auth.TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('loadCertAuthRequests:', error.message);
      requestsCache = [];
      return [];
    }

    requestsCache = (data || []).map(Auth.mapRow);
    return requestsCache;
  }

  async function loadEligibleTraineesCount() {
    const supabase = getClient();
    if (!supabase) {
      eligibleCount = 0;
      return 0;
    }

    try {
      const { data: enrollments } = await supabase
        .from('trainee_enrollments')
        .select('trainee_id, progress_percent, status, course_name');

      if (!enrollments?.length) {
        eligibleCount = 0;
        return 0;
      }

      const byTrainee = {};
      enrollments.forEach(e => {
        const id = e.trainee_id;
        if (!id) return;
        if (!byTrainee[id]) byTrainee[id] = { progressSum: 0, count: 0, hours: 0 };
        const pct = e.status === 'completed' ? 100 : (Number(e.progress_percent) || 0);
        byTrainee[id].progressSum += pct;
        byTrainee[id].count += 1;
        byTrainee[id].hours += Math.round(20 * pct / 100);
      });

      const openTraineeIds = new Set(
        requestsCache.filter(Auth.isOpenRequest).map(r => r.trainee_id).filter(Boolean)
      );

      let count = 0;
      Object.entries(byTrainee).forEach(([id, stats]) => {
        const avgProgress = stats.count ? stats.progressSum / stats.count : 0;
        if (Auth.isEligible(avgProgress, stats.hours) && !openTraineeIds.has(id)) count += 1;
      });

      eligibleCount = count;
      return count;
    } catch (err) {
      console.warn('loadEligibleTraineesCount:', err);
      eligibleCount = 0;
      return 0;
    }
  }

  async function enrichRequestFromDb(request) {
    const supabase = getClient();
    if (!supabase || !request) return request;

    const email = (request.email || '').trim().toLowerCase();
    const [certsRes, regsRes, paysRes] = await Promise.all([
      email ? supabase.from('certificates').select('*').ilike('trainee_email', email) : Promise.resolve({ data: [] }),
      email ? supabase.from('registrations').select('*').ilike('email', email) : Promise.resolve({ data: [] }),
      email ? supabase.from('payments').select('*').ilike('trainee_email', email).order('created_at', { ascending: false }) : Promise.resolve({ data: [] })
    ]);

    const certificates = certsRes.data || request.certificates || [];
    const registrations = regsRes.data || [];
    const payments = paysRes.data || [];

    const completedCourses = (registrations.length ? registrations : request.completed_courses || [])
      .filter(r => r.status === 'completed' || r.progress_percent >= 100 || r.course_name)
      .map(r => ({
        course_name: r.course_name || r.name || '—',
        status: r.status || '—',
        progress_percent: r.progress_percent ?? '—',
        created_at: r.created_at
      }));

    return {
      ...request,
      certificates,
      completed_courses: completedCourses.length ? completedCourses : (request.completed_courses || []),
      payment_history: payments.length ? payments : (request.payment_history || [])
    };
  }

  function renderStats() {
    const stats = computeStats();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('certAuthStatNew', stats.newCount);
    set('certAuthStatApproved', stats.approvedCount);
    set('certAuthStatRevenue', stats.revenue.toLocaleString('ar-AE') + ' AED');
    set('certAuthStatEligible', stats.eligibleCount);
  }

  function renderTable() {
    const tbody = document.getElementById('certAuthTableBody');
    const meta = document.getElementById('certAuthTableMeta');
    if (!tbody) return;

    const rows = filteredRequests();
    if (meta) meta.textContent = rows.length + ' طلب';

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">لا توجد طلبات مصادقة بعد</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr data-auth-id="${escapeHtml(r.id)}">
        <td><strong>${escapeHtml(r.full_name || '—')}</strong></td>
        <td dir="ltr">${escapeHtml(r.email || '—')}</td>
        <td dir="ltr">${escapeHtml(r.phone || '—')}</td>
        <td>${r.total_hours}</td>
        <td>${Math.round(r.completion_percent)}%</td>
        <td>${Array.isArray(r.completed_courses) ? r.completed_courses.length : 0}</td>
        <td>${r.certificates_count || (Array.isArray(r.certificates) ? r.certificates.length : 0)}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td><span class="auth-status-pill ${r.statusClass}">${escapeHtml(r.statusLabel)}</span></td>
        <td>
          <button type="button" class="btn btn-sm btn-outline cert-auth-open-btn" data-id="${escapeHtml(r.id)}">عرض</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.cert-auth-open-btn').forEach(btn => {
      btn.addEventListener('click', () => openDetailModal(btn.dataset.id));
    });
  }

  function renderDetailModal(request) {
    const modal = document.getElementById('certAuthDetailModal');
    const body = document.getElementById('certAuthDetailBody');
    if (!modal || !body || !request) return;

    const certs = request.certificates || [];
    const courses = request.completed_courses || [];
    const files = request.uploaded_files || [];
    const payments = request.payment_history || [];

    body.innerHTML = `
      <div class="cert-auth-detail-header">
        <div>
          <h3>${escapeHtml(request.full_name || '—')}</h3>
          <p class="cert-auth-detail-sub">${escapeHtml(request.email || '')} · ${escapeHtml(request.phone || '—')}</p>
        </div>
        <span class="auth-status-pill ${request.statusClass}">${escapeHtml(request.statusLabel)}</span>
      </div>

      <div class="cert-auth-detail-stats">
        <div class="cert-auth-mini-stat"><span>الساعات</span><strong>${request.total_hours}</strong></div>
        <div class="cert-auth-mini-stat"><span>الإنجاز</span><strong>${Math.round(request.completion_percent)}%</strong></div>
        <div class="cert-auth-mini-stat"><span>الشهادات</span><strong>${request.certificates_count || certs.length}</strong></div>
        <div class="cert-auth-mini-stat"><span>الدفع</span><strong>${escapeHtml(request.payment_status_label)}</strong></div>
      </div>

      <div class="cert-auth-detail-grid">
        <section class="cert-auth-panel">
          <h4>الشهادات المرتبطة</h4>
          ${certs.length ? `<ul class="cert-auth-list">${certs.map(c => `
            <li>
              <strong>${escapeHtml(c.course_name || '—')}</strong>
              <span>${escapeHtml(c.certificate_number || c.certificate_type || '')}</span>
            </li>`).join('')}</ul>` : '<p class="muted">لا توجد شهادات مسجّلة</p>'}
        </section>

        <section class="cert-auth-panel">
          <h4>الدورات المكتملة</h4>
          ${courses.length ? `<ul class="cert-auth-list">${courses.map(c => `
            <li>
              <strong>${escapeHtml(c.course_name || c.name || '—')}</strong>
              <span>${c.progress_percent != null ? c.progress_percent + '%' : escapeHtml(c.status || '')}</span>
            </li>`).join('')}</ul>` : '<p class="muted">لا توجد دورات مكتملة</p>'}
        </section>

        <section class="cert-auth-panel">
          <h4>الملفات المرفوعة</h4>
          ${files.length ? `<ul class="cert-auth-list">${files.map(f => `
            <li><a href="${escapeHtml(f.url || '#')}" target="_blank" rel="noopener">${escapeHtml(f.name || 'ملف')}</a></li>`).join('')}</ul>` : '<p class="muted">لم يُرفع ملف بعد</p>'}
        </section>

        <section class="cert-auth-panel">
          <h4>سجل المدفوعات</h4>
          ${payments.length ? `<ul class="cert-auth-list">${payments.map(p => `
            <li>
              <strong>${Number(p.amount || 0).toLocaleString('ar-AE')} ${escapeHtml(p.currency || 'AED')}</strong>
              <span>${escapeHtml(p.status || p.payment_status || '—')} · ${fmtDate(p.created_at)}</span>
            </li>`).join('')}</ul>` : '<p class="muted">لا توجد مدفوعات مرتبطة</p>'}
        </section>
      </div>

      ${request.verification_code ? `
        <div class="cert-auth-verification-box">
          <strong>رمز التحقق:</strong> ${escapeHtml(request.verification_code)}
          ${request.verification_url ? `<a href="${escapeHtml(request.verification_url)}" target="_blank" rel="noopener">فتح صفحة التحقق</a>` : ''}
        </div>` : ''}

      ${request.payment_link ? `
        <div class="cert-auth-payment-link-box">
          <label>رابط الدفع</label>
          <div class="cert-auth-link-row">
            <input type="text" readonly value="${escapeHtml(request.payment_link)}" id="certAuthPaymentLinkField">
            <button type="button" class="btn btn-sm" id="certAuthCopyLinkBtn">نسخ</button>
          </div>
        </div>` : ''}

      <div class="cert-auth-admin-notes">
        <label for="certAuthAdminNotes">ملاحظات الإدارة</label>
        <textarea id="certAuthAdminNotes" rows="3" placeholder="ملاحظات داخلية...">${escapeHtml(request.admin_notes || '')}</textarea>
      </div>

      <div class="cert-auth-detail-actions">
        <div class="cert-auth-action-group">
          <label for="certAuthStatusSelect">تحديث الحالة</label>
          <select id="certAuthStatusSelect">
            ${Object.values(Auth.STATUS).map(s => `
              <option value="${s.key}" ${request.status === s.key ? 'selected' : ''}>${s.label}</option>
            `).join('')}
          </select>
          <button type="button" class="btn btn-sm btn-outline" id="certAuthSaveStatusBtn">حفظ الحالة</button>
        </div>

        <div class="cert-auth-action-group">
          <label for="certAuthPaymentAmount">مبلغ المصادقة (AED)</label>
          <input type="number" id="certAuthPaymentAmount" min="1" step="1" value="${request.payment_amount || 1500}" placeholder="1500">
          <button type="button" class="btn btn-sm btn-gold" id="certAuthSendPaymentBtn">إرسال رابط الدفع</button>
        </div>

        <div class="cert-auth-action-group cert-auth-action-primary">
          <button type="button" class="btn btn-sm" id="certAuthApproveBtn" ${request.status === 'authenticated' ? 'disabled' : ''}>اعتماد المصادقة</button>
          <button type="button" class="btn btn-sm btn-danger-outline" id="certAuthRejectBtn" ${request.status === 'rejected' ? 'disabled' : ''}>رفض الطلب</button>
        </div>
      </div>
    `;

    document.getElementById('certAuthCopyLinkBtn')?.addEventListener('click', () => {
      const field = document.getElementById('certAuthPaymentLinkField');
      if (field) {
        field.select();
        navigator.clipboard?.writeText(field.value);
        global.showActionSuccess?.('تم نسخ رابط الدفع');
      }
    });

    document.getElementById('certAuthSaveStatusBtn')?.addEventListener('click', () =>
      updateRequestStatus(request.id, document.getElementById('certAuthStatusSelect')?.value, document.getElementById('certAuthAdminNotes')?.value)
    );

    document.getElementById('certAuthSendPaymentBtn')?.addEventListener('click', () =>
      sendPaymentLink(request.id)
    );

    document.getElementById('certAuthApproveBtn')?.addEventListener('click', () =>
      approveAuthentication(request.id)
    );

    document.getElementById('certAuthRejectBtn')?.addEventListener('click', () =>
      updateRequestStatus(request.id, 'rejected', document.getElementById('certAuthAdminNotes')?.value)
    );

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  async function openDetailModal(id) {
    selectedRequestId = id;
    let request = requestsCache.find(r => String(r.id) === String(id));
    if (!request) return;
    request = await enrichRequestFromDb(request);
    renderDetailModal(request);
  }

  function closeDetailModal() {
    const modal = document.getElementById('certAuthDetailModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
    selectedRequestId = null;
  }

  async function updateRequestStatus(id, status, adminNotes) {
    const supabase = getClient();
    if (!supabase) return;

    const payload = {
      status: status || 'new',
      admin_notes: adminNotes ?? '',
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from(Auth.TABLE).update(payload).eq('id', id);
    if (error) {
      global.showActionError?.('تعذّر تحديث الحالة: ' + error.message);
      return;
    }

    global.showActionSuccess?.('تم تحديث حالة الطلب');
    await refresh();
    if (selectedRequestId) await openDetailModal(selectedRequestId);
  }

  async function sendPaymentLink(id) {
    const request = requestsCache.find(r => String(r.id) === String(id));
    const amount = Number(document.getElementById('certAuthPaymentAmount')?.value) || 0;
    const adminNotes = document.getElementById('certAuthAdminNotes')?.value || '';

    if (!request || amount <= 0) {
      global.showActionError?.('أدخل مبلغاً صحيحاً');
      return;
    }

    const supabaseUrl = global.SUPABASE_URL;
    const supabaseKey = global.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      global.showActionError?.('إعدادات Supabase غير متوفرة');
      return;
    }

    try {
      const res = await fetch(supabaseUrl + '/functions/v1/swift-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + supabaseKey
        },
        body: JSON.stringify({
          full_name: request.full_name,
          email: request.email,
          phone: request.phone,
          course_name: 'مصادقة الشهادات — الماجستير المهني',
          amount,
          currency: 'aed',
          origin: location.origin,
          success_url: location.origin + '/success.html?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: location.origin + '/register.html?payment=cancelled'
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'تعذّر إنشاء رابط الدفع');
      }

      const supabase = getClient();
      const { error } = await supabase.from(Auth.TABLE).update({
        status: 'awaiting_payment',
        payment_status: 'pending',
        payment_amount: amount,
        payment_link: data.url,
        admin_notes: adminNotes,
        updated_at: new Date().toISOString()
      }).eq('id', id);

      if (error) throw error;

      if (request.trainee_id) {
        await supabase.from('trainee_notifications').insert([{
          trainee_id: request.trainee_id,
          title: 'رابط دفع مصادقة الشهادات',
          body: 'تم إرسال رابط الدفع لمسار الماجستير المهني. يرجى إتمام الدفع لاستكمال المصادقة.',
          read: false
        }]);
      }

      global.showActionSuccess?.('تم إنشاء رابط الدفع وتحديث الطلب');
      await refresh();
      await openDetailModal(id);
    } catch (err) {
      global.showActionError?.(err.message || 'فشل إرسال رابط الدفع');
    }
  }

  async function approveAuthentication(id) {
    const request = requestsCache.find(r => String(r.id) === String(id));
    if (!request) return;

    const supabase = getClient();
    if (!supabase) return;

    const adminNotes = document.getElementById('certAuthAdminNotes')?.value || '';
    const verificationCode = Auth.generateVerificationCode();
    const verificationUrl = location.origin + '/certificate.html?code=' + encodeURIComponent(verificationCode);

    const { error: certError } = await supabase.from('certificates').insert([{
      trainee_name: request.full_name,
      trainee_email: request.email,
      course_name: 'الماجستير المهني — مصادقة شهادات موحّدة',
      certificate_number: verificationCode,
      certificate_type: 'مصادقة مهنية موحّدة — INEXC',
      verification_url: verificationUrl,
      status: 'authenticated'
    }]);

    if (certError) {
      global.showActionError?.('فشل إصدار الشهادة الموحّدة: ' + certError.message);
      return;
    }

    const { error } = await supabase.from(Auth.TABLE).update({
      status: 'authenticated',
      payment_status: request.payment_status === 'pending' ? 'paid' : (request.payment_status || 'not_required'),
      verification_code: verificationCode,
      verification_url: verificationUrl,
      admin_notes: adminNotes,
      updated_at: new Date().toISOString()
    }).eq('id', id);

    if (error) {
      global.showActionError?.('تعذّر اعتماد الطلب: ' + error.message);
      return;
    }

    if (request.trainee_id) {
      await supabase.from('trainee_notifications').insert([{
        trainee_id: request.trainee_id,
        title: 'تمت مصادقة شهاداتك',
        body: 'تهانينا! تم اعتماد مصادقة شهاداتك ضمن مسار الماجستير المهني. رمز التحقق: ' + verificationCode,
        read: false
      }]);
    }

    global.showActionSuccess?.('تم اعتماد المصادقة وإصدار الشهادة الموحّدة');
    await refresh();
    closeDetailModal();
  }

  async function refresh() {
    await loadCertAuthRequests();
    await loadEligibleTraineesCount();
    renderStats();
    renderTable();
    updateSidebarBadge();
  }

  function updateSidebarBadge() {
    const badge = document.getElementById('certAuthBadge');
    if (!badge) return;
    const count = requestsCache.filter(r => r.status === 'new').length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  function renderCertAuthPage() {
    renderStats();
    renderTable();
    updateSidebarBadge();
  }

  function bindEvents() {
    document.getElementById('certAuthSearchInput')?.addEventListener('input', e => {
      filterQuery = e.target.value || '';
      renderTable();
    });

    document.getElementById('certAuthStatusFilter')?.addEventListener('change', e => {
      filterStatus = e.target.value || 'all';
      renderTable();
    });

    document.getElementById('certAuthRefreshBtn')?.addEventListener('click', () => refresh());

    document.getElementById('certAuthDetailClose')?.addEventListener('click', closeDetailModal);
    document.getElementById('certAuthDetailModal')?.addEventListener('click', e => {
      if (e.target.id === 'certAuthDetailModal') closeDetailModal();
    });
  }

  global.InexcCertAuthAdmin = {
    loadCertAuthRequests,
    loadEligibleTraineesCount,
    renderCertAuthPage,
    refresh,
    bindEvents
  };
})(window);
