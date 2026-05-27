(function (global) {
  'use strict';

  const { escapeHtml, initials, tierFromPoints } = global.TraineeAuth;

  const LOGO = 'assets/images/inexc-logo-white.png';
  const LOGO_FB = 'assets/inexc-logo-white.png';
  const LOGO_ONERR = 'onerror="if(!this.dataset.fallbackTried&&this.dataset.fallback){this.dataset.fallbackTried=\'1\';this.src=this.dataset.fallback}else{this.style.display=\'none\'}"';

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function overallProgress(enrollments) {
    if (!enrollments.length) return 0;
    const sum = enrollments.reduce((a, e) => a + (Number(e.progress_percent) || 0), 0);
    return Math.round(sum / enrollments.length);
  }

  function setSection(name) {
    document.querySelectorAll('.portal-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav button, .mobile-nav button').forEach(b => {
      b.classList.toggle('active', b.dataset.section === name);
    });
    const el = document.getElementById('section-' + name);
    if (el) el.classList.add('active');
  }

  function renderPortal(data) {
    const p = data.profile;
    const tier = tierFromPoints(p.loyalty_points);
    const stats = data.stats || {
      progress: overallProgress(data.enrollments),
      completed: data.enrollments.filter(e => e.status === 'completed').length,
      active: data.enrollments.filter(e => e.status === 'active').length,
      certCount: data.certificates.length
    };
    const progress = stats.progress;
    const completed = stats.completed;
    const active = stats.active;
    const certCount = stats.certCount ?? data.certificates.length;
    const unread = (data.notifications || []).filter(n => !n.read).length;

    document.getElementById('portalRoot').innerHTML = `
      <header class="portal-header">
        <div class="portal-header-inner">
          <a href="index.html"><img src="${LOGO}" data-fallback="${LOGO_FB}" alt="INEXC — Innovative Excellence" class="inexc-logo logo-img" ${LOGO_ONERR}></a>
          <div class="header-actions">
            <button type="button" class="notif-btn" id="notifBtn" title="الإشعارات">
              🔔
              ${unread ? `<span class="notif-badge">${unread}</span>` : ''}
            </button>
            <button type="button" class="btn-logout" id="logoutBtn">تسجيل الخروج</button>
          </div>
        </div>
      </header>

      <div class="portal-shell">
        <aside class="portal-sidebar">
          <div class="profile-card">
            <div class="profile-avatar">
              ${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}" alt="">` : initials(p.full_name || p.email)}
            </div>
            <h2>${escapeHtml(p.full_name || 'متدرب INEXC')}</h2>
            <p class="email">${escapeHtml(p.email)}</p>
            <span class="tier-badge ${tier.key}">${tier.icon} ${tier.label} · ${p.loyalty_points || 0} نقطة</span>
          </div>
          <nav class="sidebar-nav">
            <button type="button" class="active" data-section="overview">🏠 نظرة عامة</button>
            <button type="button" data-section="profile">👤 الملف الشخصي</button>
            <button type="button" data-section="courses">📚 دوراتي</button>
            <button type="button" data-section="certificates">🏅 الشهادات</button>
            <button type="button" data-section="attendance">📋 الحضور</button>
            <button type="button" data-section="rewards">⭐ المكافآت</button>
            <button type="button" data-section="offers">🎁 العروض والكوبونات</button>
          </nav>
          <div class="sidebar-stats">
            <div class="mini-stat"><div class="val">${completed}</div><div class="lbl">مكتملة</div></div>
            <div class="mini-stat"><div class="val">${data.certificates.length}</div><div class="lbl">شهادات</div></div>
          </div>
        </aside>

        <main class="portal-main">
          ${renderOverview(data, progress, completed, active, certCount)}
          ${renderProfileSection(p, progress, completed, certCount, data.professionalValue, data)}
          ${renderCoursesSection(data)}
          ${renderCertificatesSection(data)}
          ${renderAttendanceSection(data)}
          ${renderRewardsSection(data, tier)}
          ${renderOffersSection(data)}
        </main>
      </div>

      <nav class="mobile-nav">
        <div class="mobile-nav-inner">
          <button type="button" class="active" data-section="overview"><span>🏠</span>الرئيسية</button>
          <button type="button" data-section="courses"><span>📚</span>دوراتي</button>
          <button type="button" data-section="certificates"><span>🏅</span>شهادات</button>
          <button type="button" data-section="rewards"><span>⭐</span>مكافآت</button>
          <button type="button" data-section="offers"><span>🎁</span>عروض</button>
        </div>
      </nav>
    `;

    bindPortalEvents(data);
    bindProfileSave(data);
    bindDigitalIdEvents(data);
    bindCertUpgradeEvents(data);
    bindAttendanceEvents(data);
  }

  async function refreshPortalData(keepSection) {
    const session = await global.TraineeAuth.getSession();
    if (!session?.user) {
      location.href = 'login.html';
      return null;
    }
    const profile = await global.TraineeAuth.ensureProfile(session.user);
    const data = await global.TraineeAuth.loadDashboardData(profile);
    global.TraineePortal.renderPortal(data);
    if (keepSection) setSection(keepSection);
    return data;
  }

  function bindProfileSave(data) {
    const form = document.getElementById('profileForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('profileSaveBtn');
      const msg = document.getElementById('profileSaveMsg');
      const payload = {
        full_name: form.full_name.value.trim(),
        phone: form.phone.value.trim(),
        country: form.country.value.trim(),
        specialty: form.specialty.value.trim(),
        avatar_url: form.avatar_url.value.trim()
      };

      btn.disabled = true;
      btn.textContent = 'جاري الحفظ...';
      msg.hidden = true;

      try {
        await global.TraineeAuth.updateProfile(data.profile.id, payload);
        await refreshPortalData('profile');
        const nextMsg = document.getElementById('profileSaveMsg');
        if (nextMsg) {
          nextMsg.textContent = 'تم حفظ التغييرات بنجاح';
          nextMsg.className = 'profile-save-msg success';
          nextMsg.hidden = false;
        }
      } catch (err) {
        msg.textContent = err.message || 'تعذّر حفظ البيانات';
        msg.className = 'profile-save-msg error';
        msg.hidden = false;
        btn.disabled = false;
        btn.textContent = 'حفظ التغييرات';
      }
    });
  }

  function renderProfessionalValue(pv) {
    if (!pv) return '';
    const skillsPreview = (pv.skills || []).slice(0, 6);
    const domainsHtml = (pv.qualifiedDomains || []).length
      ? pv.qualifiedDomains.map(d => `
          <span class="pv-domain-tag">
            ${escapeHtml(d.name)}
            <em>${d.readiness}%</em>
          </span>
        `).join('')
      : '<p class="pv-empty-note">أكمل دورة واحدة على الأقل لظهور المجالات المؤهّل لها</p>';

    const careersHtml = (pv.careers || []).map(c => `
      <div class="pv-career-row">
        <div class="pv-career-head">
          <span>${c.icon || '💼'} ${escapeHtml(c.title)}</span>
          <strong>${c.readiness}%</strong>
        </div>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${c.readiness}%"></div></div>
      </div>
    `).join('');

    return `
      <div class="card pv-card">
        <div class="card-head pv-card-head">
          <div>
            <h3>📈 مؤشر القيمة المهنية</h3>
            <p class="pv-subtitle">تحليل ذكي لجاهزيتك في سوق العمل بناءً على دوراتك وشهاداتك</p>
          </div>
        </div>
        <div class="pv-headline">${escapeHtml(pv.headline)}</div>
        <div class="pv-metrics">
          <div class="pv-metric">
            <div class="pv-metric-val">${pv.skillsCount || 0}</div>
            <div class="pv-metric-lbl">مهارة مكتسبة</div>
          </div>
          <div class="pv-metric">
            <div class="pv-metric-val">${pv.trainingHours || 0}</div>
            <div class="pv-metric-lbl">ساعة تدريب</div>
          </div>
          <div class="pv-metric">
            <div class="pv-metric-val">${pv.overallReadiness || 0}%</div>
            <div class="pv-metric-lbl">الجاهزية المهنية</div>
          </div>
          <div class="pv-metric highlight">
            <div class="pv-metric-val">${pv.topCareer?.readiness || 0}%</div>
            <div class="pv-metric-lbl">${escapeHtml(pv.topCareer?.title || 'مسار مهني')}</div>
          </div>
        </div>
        <div class="pv-section">
          <h4>المجالات التي أصبحت مؤهّلاً لها</h4>
          <div class="pv-domains">${domainsHtml}</div>
        </div>
        ${skillsPreview.length ? `
          <div class="pv-section">
            <h4>أبرز المهارات المكتسبة</h4>
            <div class="pv-skills">${skillsPreview.map(s => `<span class="badge-pill">${escapeHtml(s)}</span>`).join('')}</div>
          </div>` : ''}
        <div class="pv-section">
          <h4>مسارات مهنية — نسبة الجاهزية</h4>
          <div class="pv-careers">${careersHtml || '<p class="pv-empty-note">سجّل في دورة لبدء قياس مساراتك المهنية</p>'}</div>
        </div>
      </div>`;
  }

  function renderDigitalIdCard(data, tier) {
    const p = data.profile;
    const d = data.digitalId;
    if (!d) return '';

    const avatarHtml = p.avatar_url
      ? `<img src="${escapeHtml(p.avatar_url)}" alt="">`
      : escapeHtml(initials(p.full_name || p.email));

    const certsHtml = (d.certificates || []).length
      ? d.certificates.map(c => `
          <li>
            <span>${escapeHtml(c.course_name || 'دورة INEXC')}</span>
            <em>${escapeHtml(c.certificate_number || '')}</em>
          </li>
        `).join('')
      : '<li class="did-empty">لا توجد شهادات معروضة بعد</li>';

    return `
      <div class="card did-wrap">
        <div class="card-head did-card-head">
          <div>
            <h3>🪪 البطاقة الرقمية للمتدرب</h3>
            <p class="did-subtitle">Digital ID — للتحقق والمشاركة المهنية</p>
          </div>
          <div class="did-actions-top">
            <button type="button" class="btn-sm outline copy-digital-id-btn">نسخ الرابط</button>
            <a href="${escapeHtml(d.linkedInUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sm linkedin-btn">LinkedIn</a>
          </div>
        </div>

        <div class="digital-id-card digital-id-card-preview">
          <div class="did-visual">
            <div class="did-top">
              <img src="${LOGO}" data-fallback="${LOGO_FB}" alt="INEXC — Innovative Excellence" class="inexc-logo did-logo" ${LOGO_ONERR}>
              <span class="did-badge">Digital ID</span>
            </div>
            <div class="did-body">
              <div class="did-photo">${avatarHtml}</div>
              <div class="did-info">
                <div class="did-id-no">${escapeHtml(d.idNumber)}</div>
                <h4>${escapeHtml(p.full_name || 'متدرب INEXC')}</h4>
                <p class="did-specialty">${escapeHtml(p.specialty || p.country || 'INEXC Trainee')}</p>
                <span class="tier-badge ${d.tierKey} did-tier">${d.tierIcon} ${escapeHtml(d.tierLabel)}</span>
                <div class="did-stats">
                  <div><strong>${d.certCount}</strong><span>شهادة</span></div>
                  <div><strong>${d.trainingHours}</strong><span>ساعة تدريب</span></div>
                  <div><strong>${data.professionalValue?.overallReadiness || 0}%</strong><span>جاهزية</span></div>
                </div>
              </div>
              <div class="did-qr">
                <img src="${escapeHtml(d.qrUrl)}" alt="QR Code" width="108" height="108">
                <span>امسح للتحقق</span>
              </div>
            </div>
            <div class="did-certs">
              <h5>الشهادات المعتمدة</h5>
              <ul>${certsHtml}</ul>
            </div>
            <div class="did-footer">
              <span>verify.inexc · ${escapeHtml(d.verifyUrl.replace(/^https?:\/\//, '').slice(0, 42))}...</span>
            </div>
          </div>
        </div>

        <div class="did-actions">
          <a href="${escapeHtml(d.verifyUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sm">فتح الصفحة العامة</a>
          <button type="button" class="btn-sm outline print-digital-id-btn">طباعة / PDF</button>
          <a href="${escapeHtml(d.linkedInUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sm linkedin-btn">مشاركة على LinkedIn</a>
        </div>
        <p class="digital-id-msg profile-save-msg" hidden></p>
      </div>`;
  }

  function bindDigitalIdEvents(data) {
    const url = data.digitalId?.verifyUrl;
    const shareText = data.digitalId?.shareText || url;

    document.querySelectorAll('.copy-digital-id-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!url) return;
        const wrap = btn.closest('.did-wrap');
        const msg = wrap?.querySelector('.digital-id-msg');
        try {
          await navigator.clipboard.writeText(shareText);
          if (msg) {
            msg.textContent = 'تم نسخ رابط البطاقة الرقمية';
            msg.className = 'digital-id-msg profile-save-msg success';
            msg.hidden = false;
          }
        } catch {
          if (msg) {
            msg.textContent = url;
            msg.className = 'digital-id-msg profile-save-msg success';
            msg.hidden = false;
          }
        }
      });
    });

    document.querySelectorAll('.print-digital-id-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.did-wrap')?.querySelector('.digital-id-card');
        if (card) {
          card.id = 'digitalIdPrintTarget';
        }
        document.body.classList.add('printing-digital-id');
        window.print();
        setTimeout(() => {
          document.body.classList.remove('printing-digital-id');
          if (card) card.removeAttribute('id');
        }, 500);
      });
    });
  }

  function renderCertUpgradeCard(offer) {
    if (!offer?.eligible) return '';

    const statusBlock = offer.hasOpenRequest && offer.existingRequest
      ? `<div class="cert-upgrade-status-box">
          <strong>حالة طلبك: ${escapeHtml(offer.existingRequest.statusLabel || '—')}</strong>
          <p>تم استلام طلبك وسيتواصل معك فريق INEXC قريباً.</p>
        </div>`
      : `<button type="button" class="btn-sm cert-upgrade-btn cert-upgrade-submit-btn">
          قدّم طلب مصادقة شهاداتي
        </button>
        <p class="cert-upgrade-msg cert-upgrade-feedback" hidden></p>`;

    return `
      <div class="cert-upgrade-card is-unlocked">
        <div class="cert-upgrade-glow" aria-hidden="true"></div>
        <div class="cert-upgrade-inner">
          <div class="cert-upgrade-lock-badge cert-upgrade-lock" title="تم فتح المستوى المتقدم">
            <span class="lock-icon lock-closed">🔒</span>
            <span class="lock-icon lock-open">🔓</span>
          </div>
          <div class="cert-upgrade-badge">Premium · الماجستير المهني</div>
          <h3 class="cert-upgrade-title">أنت مؤهل للتقديم على مصادقة الشهادات</h3>
          <p class="cert-upgrade-lead">
            لقد أتممت أكثر من <strong>${offer.progress}%</strong> من مسارك التدريبي،
            وتجاوزت <strong>${offer.hours}</strong> ساعة تدريبية، وهذا يؤهلك للتقديم على خدمة
            <strong>مصادقة الشهادات</strong> ضمن مسار الماجستير المهني.
          </p>
          <p class="cert-upgrade-sub">من خلال هذه الخدمة يمكنك:</p>
          <ul class="cert-upgrade-list">
            <li>توثيق إنجازاتك التدريبية.</li>
            <li>جمع شهاداتك في ملف مهني واحد.</li>
            <li>تعزيز قيمة شهاداتك أمام المؤسسات.</li>
            <li>التقدم لمسار مهني أكثر قوة واعتمادًا.</li>
          </ul>
          ${statusBlock}
          <p class="cert-upgrade-footnote">
            هذه المرحلة مخصصة للمتدربين الذين أظهروا التزامًا عاليًا واستمرارية حقيقية في التطور المهني.
          </p>
        </div>
      </div>`;
  }

  function bindCertUpgradeEvents(data) {
    document.querySelectorAll('.cert-upgrade-submit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wrap = btn.closest('.cert-upgrade-inner');
        const msg = wrap?.querySelector('.cert-upgrade-feedback');
        btn.disabled = true;
        btn.textContent = 'جاري إرسال الطلب...';
        if (msg) msg.hidden = true;

        try {
          await global.TraineeAuth.submitCertUpgradeRequest(
            data.profile,
            data.stats,
            data.professionalValue,
            data.enrollments,
            data.certificates
          );
          document.querySelectorAll('.cert-upgrade-submit-btn').forEach(b => {
            b.disabled = true;
            b.textContent = 'تم إرسال الطلب ✓';
          });
          document.querySelectorAll('.cert-upgrade-status-box').forEach(box => {
            box.innerHTML = '<strong>حالة طلبك: جديد</strong><p>تم استلام طلبك وسيتواصل معك فريق INEXC قريباً.</p>';
          });
          document.querySelectorAll('.cert-upgrade-feedback').forEach(m => {
            m.textContent = 'تم إرسال طلبك بنجاح — سيتواصل معك فريق INEXC قريباً';
            m.className = 'cert-upgrade-msg cert-upgrade-feedback success';
            m.hidden = false;
          });
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'قدّم طلب مصادقة شهاداتي';
          if (msg) {
            msg.textContent = err.message || 'تعذّر إرسال الطلب — حاول مجدداً';
            msg.className = 'cert-upgrade-msg cert-upgrade-feedback error';
            msg.hidden = false;
          }
        }
      });
    });

    document.querySelectorAll('.cert-upgrade-lock').forEach(lock => {
      setTimeout(() => lock.classList.add('unlocked'), 600);
    });
  }

  function renderOverview(data, progress, completed, active, certCount) {
    const tier = tierFromPoints(data.profile.loyalty_points);
    const rec = data.recommendations[0];
    let recHtml = '';
    if (rec?.course) {
      recHtml = `
        <div class="ai-rec-box">
          <h3>🤖 توصية ذكية — أكمل تعلمك</h3>
          <p>${escapeHtml(rec.reason)}: <strong>${escapeHtml(rec.course.name)}</strong></p>
          <p style="font-size:0.85rem;opacity:0.75;margin-bottom:12px;">${escapeHtml(rec.course.description || '').slice(0, 120)}...</p>
          <a href="register.html?course=${encodeURIComponent(rec.course.name)}" class="btn-sm gold">اشترك في الدورة التالية</a>
        </div>`;
    }

    return `
      <section class="portal-section active" id="section-overview">
        <div class="stats-grid">
          <div class="stat-card"><div class="icon">📊</div><div class="val">${progress}%</div><div class="lbl">التقدم العام</div></div>
          <div class="stat-card"><div class="icon">✅</div><div class="val">${completed}</div><div class="lbl">دورات مكتملة</div></div>
          <div class="stat-card"><div class="icon">📖</div><div class="val">${active}</div><div class="lbl">دورات حالية</div></div>
          <div class="stat-card"><div class="icon">🏅</div><div class="val">${certCount}</div><div class="lbl">شهادات</div></div>
        </div>
        ${renderCertUpgradeCard(data.certUpgradeOffer)}
        ${renderProfessionalValue(data.professionalValue)}
        ${renderDigitalIdCard(data, tier)}
        ${recHtml}
        <div class="card">
          <div class="card-head"><h3>آخر النشاطات</h3></div>
          ${renderActivityList(data.enrollments.slice(0, 4))}
        </div>
        <div class="card">
          <div class="card-head"><h3>مسارات تعليمية مقترحة</h3></div>
          ${renderPaths(data.paths, data.enrollments)}
        </div>
      </section>`;
  }

  function renderProfileSection(p, progress, completed, certCount, professionalValue, data) {
    const tier = tierFromPoints(p.loyalty_points);
    return `
      <section class="portal-section" id="section-profile">
        ${renderDigitalIdCard(data, tier)}
        ${renderProfessionalValue(professionalValue)}
        <div class="card">
          <div class="card-head"><h3>تعديل البيانات الشخصية</h3></div>
          <form id="profileForm" class="profile-form">
            <div class="form-group">
              <label for="profileFullName">الاسم الكامل</label>
              <input type="text" id="profileFullName" name="full_name" value="${escapeHtml(p.full_name || '')}" placeholder="أدخل اسمك الكامل" autocomplete="name">
            </div>
            <div class="form-group">
              <label for="profileEmail">البريد الإلكتروني</label>
              <input type="email" id="profileEmail" value="${escapeHtml(p.email)}" disabled dir="ltr">
            </div>
            <div class="form-group">
              <label for="profilePhone">رقم الهاتف</label>
              <input type="tel" id="profilePhone" name="phone" value="${escapeHtml(p.phone || '')}" placeholder="+971..." dir="ltr" autocomplete="tel">
            </div>
            <div class="form-group">
              <label for="profileCountry">الدولة</label>
              <input type="text" id="profileCountry" name="country" value="${escapeHtml(p.country || '')}" placeholder="الإمارات، السعودية..." autocomplete="country-name">
            </div>
            <div class="form-group">
              <label for="profileSpecialty">التخصص</label>
              <input type="text" id="profileSpecialty" name="specialty" value="${escapeHtml(p.specialty || '')}" placeholder="مثال: تعليم، تقنية، إدارة">
            </div>
            <div class="form-group">
              <label for="profileAvatar">رابط الصورة الشخصية</label>
              <input type="url" id="profileAvatar" name="avatar_url" value="${escapeHtml(p.avatar_url || '')}" placeholder="https://..." dir="ltr">
              <p style="font-size:0.78rem;color:var(--muted);margin-top:6px">تظهر في البطاقة الرقمية وملفك العام</p>
            </div>
            <p id="profileSaveMsg" class="profile-save-msg" hidden></p>
            <div class="profile-form-actions">
              <button type="submit" class="btn-sm" id="profileSaveBtn">حفظ التغييرات</button>
            </div>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h3>إحصائيات حسابك</h3></div>
          <div class="detail-grid">
            <div class="detail-row"><span>مستوى العضوية</span><strong>${escapeHtml(tierFromPoints(p.loyalty_points).label)}</strong></div>
            <div class="detail-row"><span>نقاط الولاء</span><strong>${p.loyalty_points || 0}</strong></div>
            <div class="detail-row"><span>الدورات المكتملة</span><strong>${completed}</strong></div>
            <div class="detail-row"><span>الشهادات</span><strong>${certCount}</strong></div>
            <div class="detail-row"><span>نسبة التقدم</span><strong>${progress}%</strong></div>
          </div>
          <div class="progress-ring-wrap" style="margin-top:20px">
            <span style="font-size:0.85rem;color:var(--muted)">التقدم العام</span>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
            <strong>${progress}%</strong>
          </div>
        </div>
      </section>`;
  }

  function renderCoursesSection(data) {
    const active = data.enrollments.filter(e => e.status === 'active');
    const done = data.enrollments.filter(e => e.status === 'completed');
    const suggested = data.recommendations.filter(r => r.course);
    const map = data.courseMap || {};

    return `
      <section class="portal-section" id="section-courses">
        <div class="card">
          <div class="card-head"><h3>الدورات الحالية (${active.length})</h3></div>
          ${active.length ? renderCourseList(active, map, data.regCounts) : '<div class="empty-state"><div class="icon">📚</div><p>لا توجد دورات نشطة — ابدأ رحلة تعلم جديدة</p><a href="index.html#courses" class="btn-sm">تصفح الدورات</a></div>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>الدورات المكتملة (${done.length})</h3></div>
          ${done.length ? renderCourseList(done, map, data.regCounts, true) : '<p class="empty-state">لم تكمل أي دورة بعد</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>مقترحة لك 🤖</h3></div>
          <div class="course-grid">
            ${suggested.map(r => renderCourseItem(r.course, 0, r.reason, data.regCounts[r.course.name])).join('')}
          </div>
        </div>
      </section>`;
  }

  function renderCourseList(list, courseMap, regCounts, done) {
    return `<div class="course-grid">${list.map(e => {
      const course = courseMap[e.course_name] || { name: e.course_name, description: '', price: 0 };
      return renderCourseItem(course, e.progress_percent, e.last_activity_label, regCounts[e.course_name], done);
    }).join('')}</div>`;
  }

  function renderCourseItem(course, progress, activity, regCount, done) {
    const pct = done ? 100 : (Number(progress) || 0);
    const priceLabel = Number(course.price) > 0 ? course.price + ' د.إ' : 'مجانية';
    return `
      <div class="course-item">
        <div>
          <h4>${escapeHtml(course.name)}</h4>
          <div class="meta">${regCount ? regCount + ' متدرب مسجل — ' : ''}${priceLabel}</div>
          <div class="progress-bar" style="margin-top:10px"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
          <div class="activity">${escapeHtml(activity || '')} · ${pct}%</div>
        </div>
        <a href="register.html?course=${encodeURIComponent(course.name)}" class="btn-sm">${done ? 'مراجعة' : 'متابعة التعلم'}</a>
      </div>`;
  }

  function renderCertificatesSection(data) {
    const upgradeCard = renderCertUpgradeCard(data.certUpgradeOffer);

    if (!data.certificates.length) {
      return `<section class="portal-section" id="section-certificates">
        ${upgradeCard}
        <div class="empty-state"><div class="icon">🏅</div><p>لم تحصل على شهادات بعد — أكمل دورتك للحصول على شهادة معتمدة</p></div>
      </section>`;
    }

    return `
      <section class="portal-section" id="section-certificates">
        ${upgradeCard}
        <div class="cert-grid">
          ${data.certificates.map(c => {
            const verifyUrl = location.origin + location.pathname.replace(/[^/]+$/, '') + 'certificate.html?code=' + encodeURIComponent(c.certificate_number);
            const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(verifyUrl);
            return `
              <div class="cert-card">
                <div class="cert-visual">
                  <img src="${LOGO}" data-fallback="${LOGO_FB}" alt="" class="inexc-logo cert-logo" ${LOGO_ONERR}>
                  <h4>${escapeHtml(c.course_name)}</h4>
                  <p>${escapeHtml(c.certificate_type || 'شهادة INEXC')}</p>
                </div>
                <div class="cert-body">
                  <div class="code">رقم التحقق: ${escapeHtml(c.certificate_number)}</div>
                  <div style="margin-top:12px;text-align:center"><img src="${qrUrl}" alt="QR" width="100" height="100"></div>
                  <div class="cert-actions">
                    <a href="certificate.html?code=${encodeURIComponent(c.certificate_number)}" target="_blank" class="btn-sm">عرض الشهادة</a>
                    <button type="button" class="btn-sm outline" onclick="window.print()">تحميل PDF</button>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </section>`;
  }

  function renderAttendanceSection(data) {
    const Att = global.InexcAttendance;
    const sessions = (Att?.getSessions() || []).filter(s => Att.isSessionOpenForPortal(s));
    const regs = data.registrations || [];
    const mySessions = sessions.filter(s =>
      regs.some(r =>
        (s.course_id && r.course_id && String(s.course_id) === String(r.course_id)) ||
        (s.course_name && r.course_name === s.course_name)
      )
    );

    const records = Att?.getRecords() || [];
    const cards = (data.registrations || []).map(reg => {
      const st = Att?.computeAttendancePercent(records, Att.getSessions(), {
        registrationId: reg.id,
        courseId: reg.course_id,
        courseName: reg.course_name
      }) || { percent: 100, total: 0, minRequired: 75, eligible: true };
      return `<div class="detail-row"><span>${escapeHtml(reg.course_name)}</span><strong>${st.total ? st.percent + '%' : '—'}</strong></div>`;
    }).join('');

    const liveHtml = mySessions.length ? mySessions.map(s => `
      <div class="course-item att-live-item">
        <div>
          <h4>${escapeHtml(s.title)}</h4>
          <p>${escapeHtml(s.course_name)} · ${Att.fmtDate(s.starts_at)}</p>
        </div>
        <button type="button" class="btn-sm att-portal-checkin" data-session="${s.id}">تسجيل حضور</button>
      </div>`).join('') : '<p class="empty-state">لا توجد جلسات نشطة الآن — استخدم QR في القاعة</p>';

    return `
      <section class="portal-section" id="section-attendance">
        <div class="card">
          <div class="card-head"><h3>جلسات نشطة — سجّل حضورك</h3></div>
          ${liveHtml}
        </div>
        <div class="card">
          <div class="card-head"><h3>نسب حضورك</h3></div>
          <div class="detail-grid">${cards || '<p class="empty-state">لا توجد بيانات حضور بعد</p>'}</div>
        </div>
      </section>`;
  }

  function bindAttendanceEvents(data) {
    document.querySelectorAll('.att-portal-checkin').forEach(btn => {
      btn.addEventListener('click', async () => {
        const Att = global.InexcAttendance;
        if (!Att) return;
        const sessionId = btn.dataset.session;
        const session = Att.getSessions().find(s => s.id === sessionId);
        const reg = (data.registrations || []).find(r =>
          (session.course_id && r.course_id && String(r.course_id) === String(session.course_id)) ||
          r.course_name === session.course_name
        );
        if (!reg) {
          alert('لم يُعثر على تسجيلك في هذه الدورة');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'جاري التسجيل...';
        try {
          const record = await Att.recordCheckIn({
            session,
            registration_id: reg.id,
            trainee_profile_id: data.profile.id,
            trainee_name: data.profile.full_name,
            trainee_email: data.profile.email,
            check_in_source: 'portal'
          });
          btn.textContent = 'تم ✓ ' + (Att.STATUS[record.status]?.label || record.status);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'تسجيل حضور';
          alert(err.message || 'تعذّر تسجيل الحضور');
        }
      });
    });
  }

  function renderRewardsSection(data, tier) {
    const next = global.TraineeAuth.TIER_THRESHOLDS.find(t => t.min > (data.profile.loyalty_points || 0));
    const toNext = next ? next.min - (data.profile.loyalty_points || 0) : 0;

    return `
      <section class="portal-section" id="section-rewards">
        <div class="card">
          <div class="card-head"><h3>مستوى العضوية</h3></div>
          <p style="margin-bottom:16px">أنت حالياً في مستوى <strong>${tier.icon} ${tier.label}</strong>
          ${next ? ` — تحتاج <strong>${toNext}</strong> نقطة للوصول إلى ${next.label}` : ' — أعلى مستوى!'}</p>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.min(100, ((data.profile.loyalty_points||0) / (next?.min || 4000)) * 100)}%"></div></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>الشارات والإنجازات</h3></div>
          <div class="badges-row">
            ${(data.badges.length ? data.badges : [{ badge_icon: '🔒', badge_name: 'أكمل دورتك الأولى لتحصل على شارة' }]).map(b =>
              `<span class="badge-pill">${b.badge_icon} ${escapeHtml(b.badge_name)}</span>`
            ).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>مزايا مستواك</h3></div>
          <ul style="padding-right:20px;color:var(--muted);font-size:0.9rem">
            <li>كوبونات خصم جزئية (5–12%) — وليس مجانية</li>
            <li>أولوية في العروض المحدودة</li>
            <li>اقتراحات مسارات تعليمية مخصصة</li>
            ${tierRank(data.profile.membership_tier) >= 3 ? '<li>وصول VIP لعروض حصرية</li>' : ''}
          </ul>
        </div>
      </section>`;
  }

  function tierRank(key) {
    return global.TraineeAuth.tierRank(key);
  }

  function renderOffersSection(data) {
    return `
      <section class="portal-section" id="section-offers">
        <div class="card">
          <div class="card-head"><h3>كوبوناتك المتاحة</h3></div>
          ${data.coupons.length ? data.coupons.map(c => `
            <div class="offer-card">
              <div>
                <div class="discount">${c.discount_percent}%</div>
                <strong>${escapeHtml(c.title || c.code)}</strong>
                <p style="font-size:0.82rem;color:var(--muted);margin-top:4px">
                  حد أدنى ${c.min_purchase || 0} د.إ · ينتهي ${c.expires_at ? formatDate(c.expires_at) : '—'}
                </p>
              </div>
              <div>
                <div class="code-box">${escapeHtml(c.code)}</div>
                <a href="register.html?coupon=${encodeURIComponent(c.code)}" class="btn-sm" style="margin-top:8px;display:inline-block">استخدم عند التسجيل</a>
              </div>
            </div>
          `).join('') : '<p class="empty-state">لا توجد كوبونات متاحة حالياً — تقدّم في مستواك لفتح عروض جديدة</p>'}
        </div>
        ${renderPaths(data.paths, data.enrollments, true)}
      </section>`;
  }

  function renderPaths(paths, enrollments, asOffers) {
    if (!paths?.length) return '';
    const enrolled = new Set((enrollments || []).map(e => e.course_name));
    return paths.map(path => {
      const names = path.course_names || [];
      const done = names.filter(n => enrolled.has(n)).length;
      const pct = names.length ? Math.round((done / names.length) * 100) : 0;
      return `
        <div class="path-card">
          <strong>${escapeHtml(path.name)}</strong>
          <p style="font-size:0.85rem;color:var(--muted);margin:6px 0">${escapeHtml(path.description)}</p>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
          <p style="font-size:0.82rem;margin-top:8px">Bundle خصم ${path.bundle_discount_percent}% · ${done}/${names.length} دورات</p>
          ${asOffers ? `<a href="register.html" class="btn-sm outline" style="margin-top:10px;display:inline-block">أكمل المسار</a>` : ''}
        </div>`;
    }).join('');
  }

  function renderActivityList(enrollments) {
    if (!enrollments.length) return '<p class="empty-state">لا يوجد نشاط بعد</p>';
    return enrollments.map(e => `
      <div class="course-item" style="margin-bottom:10px">
        <div>
          <h4>${escapeHtml(e.course_name)}</h4>
          <div class="activity">${escapeHtml(e.last_activity_label || '—')} · ${formatDate(e.last_activity_at)}</div>
        </div>
      </div>
    `).join('');
  }

  function bindPortalEvents(data) {
    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', () => setSection(btn.dataset.section));
    });
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await global.TraineeAuth.signOut();
      location.href = 'login.html';
    });
    document.getElementById('notifBtn')?.addEventListener('click', () => {
      const msgs = (data.notifications || []).slice(0, 5);
      alert(msgs.length ? msgs.map(n => n.title + ': ' + n.body).join('\n\n') : 'لا توجد إشعارات جديدة');
    });
  }

  global.TraineePortal = { renderPortal, setSection, refreshPortalData };
})(window);
