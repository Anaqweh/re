(function (global) {
  'use strict';

  const TIER_THRESHOLDS = [
    { key: 'vip', label: 'VIP', min: 4000, icon: '👑' },
    { key: 'gold', label: 'Gold', min: 1500, icon: '🥇' },
    { key: 'silver', label: 'Silver', min: 500, icon: '🥈' },
    { key: 'bronze', label: 'Bronze', min: 0, icon: '🥉' }
  ];

  const careerMap = global.InexcCareerMap || {};
  const COURSE_PATHS = careerMap.COURSE_PATHS || {};
  const getCourseMeta = careerMap.getCourseMeta || function (name) {
    return { hours: 20, skills: ['مهارات ' + name], domains: ['التطوير المهني'] };
  };
  const computeCareerReadiness = careerMap.computeCareerReadiness || function () { return []; };

  function computeProfessionalValue(enrollments, certificates, courseMap) {
    const certCourses = new Set((certificates || []).map(c => c.course_name).filter(Boolean));
    const courseProgress = {};

    (enrollments || []).forEach(e => {
      const pct = e.status === 'completed' ? 100 : (Number(e.progress_percent) || 0);
      courseProgress[e.course_name] = Math.max(courseProgress[e.course_name] || 0, pct);
    });
    certCourses.forEach(name => { courseProgress[name] = 100; });

    const skillsAcquired = new Set();
    const domainMap = {};
    let trainingHours = 0;
    let weightedProgress = 0;
    let progressWeight = 0;

    Object.entries(courseProgress).forEach(([courseName, progress]) => {
      if (progress <= 0) return;
      const meta = getCourseMeta(courseName, courseMap?.[courseName]);
      const hours = meta.hours;
      trainingHours += Math.round(hours * progress / 100);
      weightedProgress += progress;
      progressWeight += 1;

      (meta.skills || []).forEach(skill => {
        if (progress >= 50) skillsAcquired.add(skill);
      });

      (meta.domains || []).forEach(domain => {
        if (!domainMap[domain]) domainMap[domain] = { total: 0, count: 0, qualified: false };
        domainMap[domain].total += progress;
        domainMap[domain].count += 1;
        if (progress >= 65 || certCourses.has(courseName)) domainMap[domain].qualified = true;
      });
    });

    const careers = computeCareerReadiness(courseProgress, courseMap);

    const topCareer = careers[0] || { title: 'متخصص تعليم ذكي', readiness: 0, icon: '⭐' };
    const overallReadiness = progressWeight
      ? Math.round(weightedProgress / progressWeight)
      : 0;

    const qualifiedDomains = Object.entries(domainMap)
      .map(([name, data]) => ({
        name,
        readiness: Math.round(data.total / data.count),
        qualified: data.qualified || (data.total / data.count) >= 60
      }))
      .filter(d => d.qualified)
      .sort((a, b) => b.readiness - a.readiness);

    const headline = topCareer.readiness >= 25
      ? `جاهز بنسبة ${topCareer.readiness}% للعمل ك${topCareer.title}`
      : (skillsAcquired.size
        ? 'أنت تبني أساساً مهنياً قوياً — أكمل دورة إضافية لرفع جاهزيتك'
        : 'ابدأ دورتك الأولى لبناء مؤشر قيمتك المهنية');

    return {
      skillsCount: skillsAcquired.size,
      skills: [...skillsAcquired],
      trainingHours,
      overallReadiness,
      topCareer,
      careers: careers.slice(0, 4),
      qualifiedDomains,
      headline,
      courseProgress
    };
  }

  function getPortalBaseUrl() {
    if (typeof location === 'undefined') return '';
    return location.origin + location.pathname.replace(/[^/]+$/, '');
  }

  function buildDigitalId(profile, tier, certificates, professionalValue, baseUrl) {
    const root = (baseUrl || getPortalBaseUrl()).replace(/\/$/, '');
    const verifyUrl = root + '/digital-id.html?id=' + encodeURIComponent(profile.id);
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(verifyUrl);
    const idNumber = 'INEXC-' + String(profile.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
    const certCount = (certificates || []).length;
    const trainingHours = professionalValue?.trainingHours || 0;
    const shareText = [
      'بطاقتي الرقمية المعتمدة من INEXC Innovative Excellence',
      profile.full_name || 'متدرب INEXC',
      tier.icon + ' ' + tier.label,
      certCount + ' شهادة · ' + trainingHours + ' ساعة تدريب',
      verifyUrl
    ].join('\n');

    return {
      idNumber,
      verifyUrl,
      qrUrl,
      trainingHours,
      certCount,
      tierLabel: tier.label,
      tierKey: tier.key,
      tierIcon: tier.icon,
      certificates: (certificates || []).slice(0, 6).map(c => ({
        course_name: c.course_name,
        certificate_number: c.certificate_number,
        certificate_type: c.certificate_type
      })),
      linkedInUrl: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(verifyUrl),
      shareText
    };
  }

  async function loadPublicDigitalId(profileId) {
    if (!profileId) return null;
    const { data: profile, error } = await supabaseClient
      .from('trainee_profiles')
      .select('*')
      .eq('id', profileId)
      .maybeSingle();
    if (error || !profile) return null;

    const registrations = await loadRegistrationsByEmail(profile.email);
    const certificates = await loadCertificatesForTrainee(profile.email, registrations);
    const [
      { data: enrollments },
      { data: courses }
    ] = await Promise.all([
      supabaseClient.from('trainee_enrollments').select('*').eq('trainee_id', profile.id),
      supabaseClient.from('courses').select('*')
    ]);

    const courseMap = {};
    (courses || []).forEach(c => { courseMap[c.name] = c; });
    const professionalValue = computeProfessionalValue(enrollments || [], certificates, courseMap);
    const tier = tierFromPoints(profile.loyalty_points || 0);
    const digitalId = buildDigitalId(profile, tier, certificates, professionalValue);

    return {
      profile,
      tier,
      digitalId,
      professionalValue,
      certificates,
      enrollments: enrollments || []
    };
  }

  function tierFromPoints(points) {
    const p = Number(points) || 0;
    for (const t of TIER_THRESHOLDS) {
      if (p >= t.min) return t;
    }
    return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
  }

  function tierRank(key) {
    const order = { bronze: 1, silver: 2, gold: 3, vip: 4 };
    return order[String(key || 'bronze').toLowerCase()] || 1;
  }

  function calcPoints(completedCourses, certCount) {
    return (completedCourses * 120) + (certCount * 80);
  }

  function initials(name) {
    const parts = String(name || 'IN').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || 'IN').slice(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(label || 'انتهت مهلة الاتصال')), ms);
      })
    ]);
  }

  function getLocalTrainee() {
    try {
      const raw = localStorage.getItem('trainee');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearLocalTrainee() {
    localStorage.removeItem('trainee');
  }

  function buildLocalDashboardData(user) {
    const profile = {
      id: 'local-demo',
      email: user?.email || '',
      full_name: user?.name || user?.email || 'متدرب INEXC',
      phone: '',
      country: '',
      specialty: '',
      loyalty_points: 0,
      membership_tier: 'bronze',
      avatar_url: ''
    };
    const enrollments = [];
    const certificates = [];
    const stats = computeStats(enrollments, [], certificates);
    const professionalValue = computeProfessionalValue(enrollments, certificates, {});
    const tier = tierFromPoints(0);
    const digitalId = buildDigitalId(profile, tier, certificates, professionalValue);

    return {
      profile,
      enrollments,
      certificates,
      courses: [],
      coupons: [],
      paths: [],
      badges: [],
      notifications: [{
        id: 'local-welcome',
        title: 'مرحباً بك في INEXC',
        body: 'تم تسجيل الدخول. لعرض دوراتك وشهاداتك من قاعدة البيانات، استخدم بريداً مسجلاً في المنصة.',
        read: false
      }],
      registrations: [],
      courseMap: {},
      regCounts: {},
      loyalty: null,
      stats,
      professionalValue,
      digitalId,
      certUpgradeOffer: computeCertUpgradeOffer(stats, professionalValue),
      recommendations: [],
      isLocalSession: true
    };
  }

  async function getSession() {
    if (!global.supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await ensureProfile(data.user);
    return data;
  }

  async function signUp({ email, password, fullName, phone, country }) {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, country }
      }
    });
    if (error) throw error;
    if (data.user) {
      const profile = await upsertProfile({
        auth_user_id: data.user.id,
        email,
        full_name: fullName || '',
        phone: phone || '',
        country: country || ''
      });
      await syncRegistrationsByEmail(email, data.user.id, profile?.id);
    }
    return data;
  }

  async function resetPassword(email) {
    const redirectTo = location.origin + location.pathname.replace(/[^/]+$/, 'login.html') + '?mode=reset';
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function signOut() {
    clearLocalTrainee();
    try {
      await supabaseClient.auth.signOut();
    } catch (err) {
      console.warn('signOut:', err.message);
    }
  }

  async function upsertProfile(row) {
    const { data: existing } = await supabaseClient
      .from('trainee_profiles')
      .select('id')
      .eq('email', row.email)
      .maybeSingle();

    if (existing?.id) {
      const payload = { ...row, updated_at: new Date().toISOString() };
      const { data, error } = await supabaseClient
        .from('trainee_profiles')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error && String(error.message).includes('auth_user_id')) {
        delete payload.auth_user_id;
        const retry = await supabaseClient
          .from('trainee_profiles')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single();
        if (retry.error) throw retry.error;
        return retry.data;
      }
      if (error) throw error;
      return data;
    }

    const insertRow = { ...row, last_login_at: new Date().toISOString() };
    let { data, error } = await supabaseClient
      .from('trainee_profiles')
      .insert([insertRow])
      .select()
      .single();

    if (error && insertRow.auth_user_id && String(error.message).includes('auth_user_id')) {
      const withoutAuth = { ...insertRow };
      delete withoutAuth.auth_user_id;
      const retry = await supabaseClient.from('trainee_profiles').insert([withoutAuth]).select().single();
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    return data;
  }

  async function ensureProfile(user) {
    if (!user?.email) return null;
    const meta = user.user_metadata || {};
    let profile = await loadProfileByAuth(user.id);
    if (!profile) profile = await loadProfileByEmail(user.email);

    if (!profile) {
      profile = await upsertProfile({
        auth_user_id: user.id,
        email: user.email,
        full_name: meta.full_name || '',
        phone: meta.phone || '',
        country: meta.country || ''
      });
    } else {
      const updatePayload = { last_login_at: new Date().toISOString(), auth_user_id: user.id };
      const { error } = await supabaseClient
        .from('trainee_profiles')
        .update(updatePayload)
        .eq('id', profile.id);
      if (error && String(error.message).includes('auth_user_id')) {
        await supabaseClient
          .from('trainee_profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', profile.id);
      } else if (error) {
        console.warn('profile update:', error.message);
      }
    }
    const registrations = await loadRegistrationsByEmail(user.email);
    const certificates = await loadCertificatesForTrainee(user.email, registrations);
    profile = await enrichProfileFromRegistrations(profile, registrations, meta);
    await syncRegistrationsByEmail(user.email, user.id, profile.id, certificates);

    const { data: fresh } = await supabaseClient
      .from('trainee_profiles')
      .select('*')
      .eq('id', profile.id)
      .maybeSingle();
    return fresh || profile;
  }

  async function loadProfileByAuth(authUserId) {
    const { data, error } = await supabaseClient
      .from('trainee_profiles')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) {
      if (String(error.message).includes('auth_user_id')) return null;
      throw error;
    }
    return data;
  }

  async function loadProfileByEmail(email) {
    if (!global.supabaseClient) return null;
    const { data, error } = await supabaseClient
      .from('trainee_profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  function buildCertIndex(certificates) {
    const byCourse = new Set();
    const byRegId = new Set();
    (certificates || []).forEach(c => {
      if (c.course_name) byCourse.add(c.course_name);
      if (c.registration_id != null) byRegId.add(String(c.registration_id));
    });
    return { byCourse, byRegId };
  }

  function registrationHasCert(reg, certIndex) {
    return certIndex.byCourse.has(reg.course_name) || certIndex.byRegId.has(String(reg.id));
  }

  async function loadRegistrationsByEmail(email) {
    const normalized = String(email || '').trim();
    if (!normalized) return [];
    const { data, error } = await supabaseClient
      .from('registrations')
      .select('*')
      .ilike('email', normalized)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadCertificatesForTrainee(email, registrations) {
    const normalized = String(email || '').trim().toLowerCase();
    const byEmailRes = await supabaseClient
      .from('certificates')
      .select('*')
      .ilike('trainee_email', normalized);

    let certs = byEmailRes.data || [];
    const regIds = (registrations || []).map(r => r.id).filter(Boolean);

    if (regIds.length) {
      const { data: byReg } = await supabaseClient
        .from('certificates')
        .select('*')
        .in('registration_id', regIds);
      certs = certs.concat(byReg || []);
    }

    const seen = new Set();
    return certs.filter(c => {
      const key = c.id || c.certificate_number;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function mergeProfileFields(profile, registrations, authMeta) {
    const sorted = [...(registrations || [])].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
    const meta = authMeta || {};

    const pick = (field, metaKey) => {
      const fromProfile = String(profile[field] || '').trim();
      if (fromProfile) return fromProfile;
      for (const reg of sorted) {
        const value = String(reg[field] || '').trim();
        if (value) return value;
      }
      return String(meta[metaKey || field] || '').trim();
    };

    return {
      full_name: pick('full_name', 'full_name'),
      phone: pick('phone', 'phone'),
      country: pick('country', 'country'),
      specialty: pick('specialty')
    };
  }

  async function enrichProfileFromRegistrations(profile, registrations, authMeta) {
    const merged = mergeProfileFields(profile, registrations, authMeta);
    const patch = {};
    ['full_name', 'phone', 'country', 'specialty'].forEach(field => {
      if (merged[field] !== String(profile[field] || '')) patch[field] = merged[field];
    });

    if (!Object.keys(patch).length) {
      return { ...profile, ...merged };
    }

    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseClient
      .from('trainee_profiles')
      .update(patch)
      .eq('id', profile.id)
      .select()
      .single();

    if (error) {
      console.warn('enrichProfile:', error.message);
      return { ...profile, ...merged };
    }
    return data;
  }

  async function updateProfile(profileId, fields) {
    const allowed = ['full_name', 'phone', 'country', 'specialty', 'avatar_url'];
    const patch = { updated_at: new Date().toISOString() };
    allowed.forEach(k => {
      if (fields[k] !== undefined) patch[k] = fields[k];
    });

    const { data, error } = await supabaseClient
      .from('trainee_profiles')
      .update(patch)
      .eq('id', profileId)
      .select()
      .single();
    if (error) throw error;

    const session = await getSession();
    if (session?.user && (fields.full_name !== undefined || fields.phone !== undefined || fields.country !== undefined)) {
      const meta = { ...(session.user.user_metadata || {}) };
      if (fields.full_name !== undefined) meta.full_name = fields.full_name;
      if (fields.phone !== undefined) meta.phone = fields.phone;
      if (fields.country !== undefined) meta.country = fields.country;
      await supabaseClient.auth.updateUser({ data: meta });
    }
    return data;
  }

  function enrollmentFromRegistration(reg, certIndex) {
    const hasCert = registrationHasCert(reg, certIndex);
    const baseProgress = Number(reg.progress_percent) || 0;
    const regStatus = String(reg.status || 'pending').toLowerCase();
    const isComplete = hasCert || baseProgress >= 100 || regStatus === 'completed';

    const progress = isComplete
      ? 100
      : (baseProgress > 0 ? Math.min(baseProgress, 95) : (regStatus === 'pending' ? 35 : 55));

    return {
      status: isComplete ? 'completed' : 'active',
      progress_percent: progress,
      last_activity_at: reg.created_at,
      last_activity_label: isComplete
        ? (hasCert ? 'حصل على الشهادة' : 'أكمل الدورة')
        : (regStatus === 'pending' ? 'التسجيل قيد المراجعة' : 'متابعة التعلم'),
      completed_at: isComplete ? (reg.created_at || new Date().toISOString()) : null
    };
  }

  function computeStats(enrollments, registrations, certificates) {
    const certIndex = buildCertIndex(certificates);
    let completed = (enrollments || []).filter(e => e.status === 'completed').length;
    let active = (enrollments || []).filter(e => e.status === 'active').length;

    if (!enrollments?.length && registrations?.length) {
      registrations.forEach(reg => {
        const mapped = enrollmentFromRegistration(reg, certIndex);
        if (mapped.status === 'completed') completed += 1;
        else active += 1;
      });
    }

    const progress = enrollments?.length
      ? Math.round(enrollments.reduce((a, e) => a + (Number(e.progress_percent) || 0), 0) / enrollments.length)
      : (registrations?.length
        ? Math.round(registrations.reduce((a, reg) => {
            return a + enrollmentFromRegistration(reg, certIndex).progress_percent;
          }, 0) / registrations.length)
        : (certificates?.length ? 100 : 0));

    return { completed, active, progress, certCount: (certificates || []).length };
  }

  const certAuthApi = () => global.InexcCertAuth || null;

  function computeCertUpgradeOffer(stats, professionalValue, existingRequest) {
    const base = certAuthApi()?.computeOffer(stats, professionalValue) || {
      eligible: false,
      progress: Number(stats?.progress) || 0,
      hours: Number(professionalValue?.trainingHours) || 0,
      progressMin: 90,
      hoursMin: 70
    };

    const mappedRequest = existingRequest
      ? (certAuthApi()?.mapRow(existingRequest) || existingRequest)
      : null;

    return {
      ...base,
      progressUnlocked: base.progress >= base.progressMin,
      hoursUnlocked: base.hours > base.hoursMin,
      existingRequest: mappedRequest,
      hasOpenRequest: mappedRequest && certAuthApi()?.isOpenRequest(mappedRequest),
      canSubmit: base.eligible && !(mappedRequest && certAuthApi()?.isOpenRequest(mappedRequest))
    };
  }

  async function loadCertAuthRequest(traineeId) {
    if (!traineeId) return null;
    const table = certAuthApi()?.TABLE || 'certificate_authentication_requests';
    const { data, error } = await supabaseClient
      .from(table)
      .select('*')
      .eq('trainee_id', traineeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('loadCertAuthRequest:', error.message);
      return null;
    }
    return data;
  }

  async function maybeNotifyCertAuthEligibility(profile, offer, existingRequest) {
    if (!offer?.eligible || existingRequest) return;

    const { data: existing } = await supabaseClient
      .from('trainee_notifications')
      .select('id')
      .eq('trainee_id', profile.id)
      .ilike('title', '%مؤهل للتقديم على مصادقة%')
      .limit(1);

    if (existing?.length) return;

    await supabaseClient.from('trainee_notifications').insert([{
      trainee_id: profile.id,
      title: 'أنت مؤهل للتقديم على مصادقة الشهادات',
      body: 'لقد تجاوزت 90% من إنجاز مسارك التدريبي وأكثر من 70 ساعة تدريبية. يمكنك الآن التقديم على مصادقة الشهادات ضمن مسار الماجستير المهني.',
      read: false
    }]);
  }

  async function submitCertUpgradeRequest(profile, stats, professionalValue, enrollments, certificates) {
    const offer = computeCertUpgradeOffer(stats, professionalValue);
    if (!offer.canSubmit) {
      throw new Error(offer.hasOpenRequest
        ? 'لديك طلب مصادقة قيد المعالجة بالفعل'
        : 'لم تصل بعد إلى شروط الأهلية للمصادقة');
    }

    const progress = stats?.progress ?? 0;
    const hours = professionalValue?.trainingHours ?? 0;
    const completedCourses = (enrollments || [])
      .filter(e => e.status === 'completed' || Number(e.progress_percent) >= 100)
      .map(e => ({
        course_name: e.course_name,
        status: e.status,
        progress_percent: e.progress_percent,
        completed_at: e.completed_at
      }));

    const certSnapshot = (certificates || []).map(c => ({
      course_name: c.course_name,
      certificate_number: c.certificate_number,
      certificate_type: c.certificate_type,
      created_at: c.created_at
    }));

    const table = certAuthApi()?.TABLE || 'certificate_authentication_requests';
    const { data: inserted, error: insertError } = await supabaseClient
      .from(table)
      .insert([{
        trainee_id: profile.id,
        full_name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        total_hours: hours,
        completion_percent: progress,
        certificates_count: certSnapshot.length,
        completed_courses: completedCourses,
        certificates: certSnapshot,
        status: 'new',
        payment_status: 'not_required'
      }])
      .select('*')
      .single();

    if (insertError) throw insertError;

    const detail = [
      'طلب مصادقة شهادات — مسار الماجستير المهني',
      'رقم الطلب: ' + (inserted?.id || '—'),
      'الاسم: ' + (profile.full_name || '—'),
      'البريد: ' + profile.email,
      'التقدم التدريبي: ' + progress + '%',
      'ساعات التدريب: ' + hours,
      'الشهادات: ' + certSnapshot.length
    ].join('\n');

    const { error: notifError } = await supabaseClient.from('trainee_notifications').insert([{
      trainee_id: profile.id,
      title: 'تم استلام طلب مصادقة الشهادات',
      body: 'سيراجع فريق INEXC طلبك ويتواصل معك لاستكمال مسار الماجستير المهني.',
      read: false
    }]);
    if (notifError) console.warn('cert upgrade notification:', notifError.message);

    const { error: msgError } = await supabaseClient.from('messages').insert([{
      sender_name: profile.full_name || 'متدرب INEXC',
      sender_email: profile.email,
      sender_phone: profile.phone || '',
      subject: 'طلب مصادقة شهادات — مسار الماجستير المهني',
      body: detail,
      source: 'cert_upgrade_portal',
      read: false
    }]);
    if (msgError) console.warn('cert upgrade message:', msgError.message);

    return inserted;
  }

  async function syncRegistrationsByEmail(email, authUserId, profileId, certificates) {
    const regs = await loadRegistrationsByEmail(email);

    let pid = profileId;
    if (!pid) {
      const p = await loadProfileByEmail(email);
      pid = p?.id;
    }
    if (!pid) return regs;

    const certIndex = buildCertIndex(certificates);

    if (regs.length) {
      await Promise.all(regs.map(reg =>
        supabaseClient
          .from('registrations')
          .update({ trainee_profile_id: pid })
          .eq('id', reg.id)
      ));

      const { data: existingEnrollments } = await supabaseClient
        .from('trainee_enrollments')
        .select('id, registration_id')
        .eq('trainee_id', pid);

      const existingByRegId = new Map(
        (existingEnrollments || []).map(e => [String(e.registration_id), e.id])
      );

      await Promise.all(regs.map(reg => {
        const mapped = enrollmentFromRegistration(reg, certIndex);
        const row = {
          trainee_id: pid,
          registration_id: reg.id,
          course_name: reg.course_name,
          status: mapped.status,
          progress_percent: mapped.progress_percent,
          last_activity_at: mapped.last_activity_at,
          last_activity_label: mapped.last_activity_label,
          completed_at: mapped.completed_at
        };
        const existingId = existingByRegId.get(String(reg.id));
        if (existingId) {
          return supabaseClient.from('trainee_enrollments').update(row).eq('id', existingId);
        }
        return supabaseClient.from('trainee_enrollments').insert([row]);
      }));
    }

    await refreshLoyalty(pid, certificates);
    return regs;
  }

  async function refreshLoyalty(traineeId, certificates) {
    const email = await getProfileEmail(traineeId);
    const { data: enrollments } = await supabaseClient
      .from('trainee_enrollments')
      .select('status')
      .eq('trainee_id', traineeId);

    let certCount = (certificates || []).length;
    if (!certCount && email) {
      const { data: regs } = await supabaseClient.from('registrations').select('id').eq('email', email);
      const loaded = await loadCertificatesForTrainee(email, regs || []);
      certCount = loaded.length;
    }

    const completed = (enrollments || []).filter(e => e.status === 'completed').length;
    const points = calcPoints(completed, certCount);
    const tier = tierFromPoints(points);

    await supabaseClient
      .from('trainee_profiles')
      .update({ loyalty_points: points, membership_tier: tier.key })
      .eq('id', traineeId);

    await awardBadges(traineeId, completed, certCount);
    return { points, tier: tier.key };
  }

  async function getProfileEmail(traineeId) {
    const { data } = await supabaseClient.from('trainee_profiles').select('email').eq('id', traineeId).maybeSingle();
    return data?.email || '';
  }

  async function awardBadges(traineeId, completed, certCount) {
    const badges = [];
    if (completed >= 1) badges.push({ key: 'first_course', name: 'أول دورة', icon: '🎓' });
    if (completed >= 3) badges.push({ key: 'learner', name: 'متعلم نشط', icon: '📚' });
    if (completed >= 5) badges.push({ key: 'expert', name: 'خبير INEXC', icon: '⭐' });
    if (certCount >= 1) badges.push({ key: 'certified', name: 'حاصل على شهادة', icon: '🏅' });
    if (certCount >= 3) badges.push({ key: 'cert_master', name: 'جامع الشهادات', icon: '🎖️' });

    for (const b of badges) {
      const { error } = await supabaseClient.from('trainee_badges').insert([{
        trainee_id: traineeId,
        badge_key: b.key,
        badge_name: b.name,
        badge_icon: b.icon
      }]);
      if (error && !String(error.message).includes('duplicate') && error.code !== '23505') {
        console.warn('badge:', error.message);
      }
    }
  }

  async function loadDashboardData(profile, options) {
    const opts = options || {};
    const email = profile.email;
    const [
      { data: courses, error: e3 },
      { data: coupons, error: e4 },
      { data: paths, error: e5 },
      { data: badges, error: e6 },
      { data: notifications, error: e7 }
    ] = await Promise.all([
      supabaseClient.from('courses').select('*').eq('status', 'active'),
      supabaseClient.from('coupons').select('*').eq('status', 'active'),
      supabaseClient.from('learning_paths').select('*').eq('status', 'active').order('sort_order'),
      supabaseClient.from('trainee_badges').select('*').eq('trainee_id', profile.id),
      supabaseClient.from('trainee_notifications').select('*').eq('trainee_id', profile.id).order('created_at', { ascending: false }).limit(20)
    ]);

    if (e3) console.warn(e3);
    if (e4) console.warn(e4);

    const registrations = await loadRegistrationsByEmail(email);
    const certificates = await loadCertificatesForTrainee(email, registrations);
    if (!opts.skipSync) {
      await syncRegistrationsByEmail(email, null, profile.id, certificates);
    }

    const [
      { data: enrollments, error: e1 },
      { data: updatedProfile, error: eProfile }
    ] = await Promise.all([
      supabaseClient.from('trainee_enrollments').select('*').eq('trainee_id', profile.id).order('created_at', { ascending: false }),
      supabaseClient.from('trainee_profiles').select('*').eq('id', profile.id).single()
    ]);

    if (e1) console.warn(e1);
    if (eProfile) console.warn(eProfile);

    const loyalty = await refreshLoyalty(profile.id, certificates);
    const freshProfile = (await supabaseClient.from('trainee_profiles').select('*').eq('id', profile.id).single()).data
      || updatedProfile
      || profile;

    const stats = computeStats(enrollments || [], registrations, certificates);

    const courseMap = {};
    (courses || []).forEach(c => {
      courseMap[c.name] = c;
      const canonical = careerMap.resolveCanonicalCourseName?.(c.name);
      if (canonical && canonical !== c.name) courseMap[canonical] = c;
    });
    (enrollments || []).forEach(e => {
      if (e.course_name && !courseMap[e.course_name]) {
        courseMap[e.course_name] = { name: e.course_name, description: '', hours: '20 ساعة' };
      }
    });

    const professionalValue = computeProfessionalValue(enrollments || [], certificates, courseMap);
    const tier = tierFromPoints(freshProfile.loyalty_points || 0);
    const digitalId = buildDigitalId(freshProfile, tier, certificates, professionalValue);

    const existingAuthRequest = await loadCertAuthRequest(profile.id);
    const certUpgradeOffer = computeCertUpgradeOffer(stats, professionalValue, existingAuthRequest);
    await maybeNotifyCertAuthEligibility(freshProfile, certUpgradeOffer, existingAuthRequest);

    if (global.InexcAttendance?.loadAll) {
      try { await global.InexcAttendance.loadAll(); } catch (_) {}
    }

    const regCounts = {};
    (registrations || []).forEach(r => {
      regCounts[r.course_name] = (regCounts[r.course_name] || 0) + 1;
    });

    return {
      profile: freshProfile,
      enrollments: enrollments || [],
      certificates,
      courses: courses || [],
      coupons: filterCoupons(coupons || [], freshProfile),
      paths: paths || [],
      badges: badges || [],
      notifications: notifications || [],
      registrations,
      courseMap,
      regCounts,
      loyalty,
      stats,
      professionalValue,
      digitalId,
      certUpgradeOffer,
      recommendations: buildRecommendations(enrollments || [], courses || [], paths || [])
    };
  }

  function filterCoupons(coupons, profile) {
    const now = Date.now();
    return coupons.filter(c => {
      if (c.expires_at && new Date(c.expires_at).getTime() < now) return false;
      if (Number(c.used_count) >= Number(c.max_uses)) return false;
      if (c.active_members_only && tierRank(profile.membership_tier) < tierRank(c.min_tier)) return false;
      if (tierRank(profile.membership_tier) < tierRank(c.min_tier)) return false;
      return true;
    });
  }

  function buildRecommendations(enrollments, courses, paths) {
    const completed = new Set(enrollments.filter(e => e.status === 'completed').map(e => e.course_name));
    const enrolled = new Set(enrollments.map(e => e.course_name));
    const recs = [];
    const seen = new Set();

    completed.forEach(name => {
      (COURSE_PATHS[name] || []).forEach(next => {
        if (!enrolled.has(next) && !seen.has(next)) {
          seen.add(next);
          const course = courses.find(c => c.name === next);
          if (course) recs.push({ course, reason: 'بناءً على دورة «' + name + '»' });
        }
      });
    });

    paths.forEach(path => {
      const names = path.course_names || [];
      const missing = names.filter(n => !enrolled.has(n));
      if (missing.length && missing.length < names.length) {
        recs.push({
          type: 'path',
          path,
          missing,
          reason: 'أكمل مسار «' + path.name + '»'
        });
      }
    });

    if (!recs.length) {
      courses.filter(c => !enrolled.has(c.name)).slice(0, 3).forEach(course => {
        recs.push({ course, reason: 'دورة مقترحة لك' });
      });
    }

    return recs.slice(0, 5);
  }

  global.TraineeAuth = {
    TIER_THRESHOLDS,
    tierFromPoints,
    tierRank,
    initials,
    escapeHtml,
    withTimeout,
    getLocalTrainee,
    clearLocalTrainee,
    buildLocalDashboardData,
    getSession,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    signOut,
    ensureProfile,
    loadProfileByAuth,
    loadProfileByEmail,
    loadDashboardData,
    syncRegistrationsByEmail,
    updateProfile,
    computeStats,
    enrichProfileFromRegistrations,
    computeProfessionalValue,
    buildDigitalId,
    loadPublicDigitalId,
    computeCertUpgradeOffer,
    submitCertUpgradeRequest
  };
})(window);
