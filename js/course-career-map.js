(function (global) {
  'use strict';

  const CAREER_ROLES = [
    {
      key: 'ai_trainer',
      title: 'مدرب AI',
      icon: '🎓',
      requiredCourses: [
        { name: 'الذكاء الاصطناعي في التعليم', weight: 35 },
        { name: 'تدريب المدربين AI TOT', weight: 40 },
        { name: 'هندسة الأوامر Prompt Engineering', weight: 25 }
      ]
    },
    {
      key: 'curriculum_designer',
      title: 'مصمم مناهج ذكية',
      icon: '📐',
      requiredCourses: [
        { name: 'بناء المناهج الذكية', weight: 45 },
        { name: 'الذكاء الاصطناعي في التعليم', weight: 30 },
        { name: 'صناعة المحتوى الرقمي', weight: 25 }
      ]
    },
    {
      key: 'ai_content_creator',
      title: 'صانع محتوى AI',
      icon: '🎬',
      requiredCourses: [
        { name: 'صناعة المحتوى الرقمي', weight: 40 },
        { name: 'هندسة الأوامر Prompt Engineering', weight: 35 },
        { name: 'بناء الشات بوتات التعليمية', weight: 25 }
      ]
    },
    {
      key: 'digital_leader',
      title: 'قائد تحول رقمي',
      icon: '🏛️',
      requiredCourses: [
        { name: 'التحول الرقمي للمؤسسات', weight: 40 },
        { name: 'تطوير القيادات التعليمية', weight: 35 },
        { name: 'بناء المناهج الذكية', weight: 25 }
      ]
    },
    {
      key: 'chatbot_specialist',
      title: 'متخصص شات بوتات تعليمية',
      icon: '🤖',
      requiredCourses: [
        { name: 'بناء الشات بوتات التعليمية', weight: 45 },
        { name: 'هندسة الأوامر Prompt Engineering', weight: 30 },
        { name: 'الذكاء الاصطناعي في التعليم', weight: 25 }
      ]
    }
  ];

  const COURSE_CATALOG_META = {
    'الذكاء الاصطناعي في التعليم': {
      hours: 20,
      skills: ['تطبيق AI في التعليم', 'تصميم أنشطة تفاعلية', 'أدوات الذكاء الاصطناعي'],
      domains: ['التعليم والتدريب', 'الذكاء الاصطناعي']
    },
    'تدريب المدربين AI TOT': {
      hours: 30,
      skills: ['تدريب المدربين', 'تصميم ورش AI', 'تقييم الأداء التدريبي'],
      domains: ['التعليم والتدريب', 'القيادة التدريبية']
    },
    'هندسة الأوامر Prompt Engineering': {
      hours: 15,
      skills: ['هندسة الأوامر', 'ChatGPT & Claude', 'أتمتة المهام'],
      domains: ['الذكاء الاصطناعي', 'الإنتاجية الرقمية']
    },
    'بناء المناهج الذكية': {
      hours: 25,
      skills: ['تصميم المناهج', 'تحليل احتياجات التعلم', 'AI Curriculum Design'],
      domains: ['التعليم والتدريب', 'تصميم المحتوى']
    },
    'صناعة المحتوى الرقمي': {
      hours: 20,
      skills: ['إنتاج محتوى رقمي', 'تحرير بالذكاء الاصطناعي', 'التسويق التعليمي'],
      domains: ['صناعة المحتوى', 'الإنتاجية الرقمية']
    },
    'بناء الشات بوتات التعليمية': {
      hours: 18,
      skills: ['بناء Chatbots', 'أتمتة الدعم التعليمي', 'تكامل AI'],
      domains: ['الذكاء الاصطناعي', 'التعليم والتدريب']
    },
    'التحول الرقمي للمؤسسات': {
      hours: 24,
      skills: ['استراتيجية التحول الرقمي', 'إدارة التغيير', 'حوكمة التقنية'],
      domains: ['الإدارة والقيادة', 'التحول الرقمي']
    },
    'المهارات المستقبلية': {
      hours: 12,
      skills: ['مهارات المستقبل', 'التعلم الذاتي', 'التفكير النقدي'],
      domains: ['التطوير المهني', 'المهارات الشخصية']
    },
    'تطوير القيادات التعليمية': {
      hours: 22,
      skills: ['قيادة تعليمية', 'اتخاذ قرارات بالبيانات', 'إدارة فرق التعلم'],
      domains: ['الإدارة والقيادة', 'التعليم والتدريب']
    }
  };

  const COURSE_PATHS = {
    'الذكاء الاصطناعي في التعليم': ['هندسة الأوامر Prompt Engineering', 'بناء المناهج الذكية', 'بناء الشات بوتات التعليمية'],
    'هندسة الأوامر Prompt Engineering': ['الذكاء الاصطناعي في التعليم', 'صناعة المحتوى الرقمي'],
    'تدريب المدربين AI TOT': ['صناعة المحتوى الرقمي', 'بناء الشات بوتات التعليمية'],
    'بناء المناهج الذكية': ['التحول الرقمي للمؤسسات', 'تطوير القيادات التعليمية'],
    'المهارات المستقبلية': ['الذكاء الاصطناعي في التعليم', 'هندسة الأوامر Prompt Engineering']
  };

  const KEYWORD_CAREER_RULES = [
    { roleKey: 'ai_trainer', patterns: [/مدرب/i, /tot/i, /تدريب/i, /trainer/i] },
    { roleKey: 'curriculum_designer', patterns: [/مناهج/i, /curriculum/i, /تعليم/i, /ترب/i] },
    { roleKey: 'ai_content_creator', patterns: [/محتوى/i, /content/i, /صناعة/i, /رقمي/i] },
    { roleKey: 'digital_leader', patterns: [/تحول/i, /قياد/i, /مؤسس/i, /إدار/i] },
    { roleKey: 'chatbot_specialist', patterns: [/chatbot/i, /شات/i, /بوت/i, /bot/i] },
    { roleKey: 'ai_trainer', patterns: [/prompt/i, /أوامر/i] },
    { roleKey: 'ai_content_creator', patterns: [/prompt/i, /أوامر/i] },
    { roleKey: 'ai_trainer', patterns: [/ذكاء/i, /\bai\b/i] },
    { roleKey: 'ai_content_creator', patterns: [/ذكاء/i, /\bai\b/i] }
  ];

  const DEFAULT_CAREER_KEYS = ['ai_trainer', 'curriculum_designer', 'ai_content_creator', 'digital_leader'];

  function buildCourseCareerReverseMap() {
    const map = {};
    CAREER_ROLES.forEach(role => {
      role.requiredCourses.forEach(req => {
        if (!map[req.name]) map[req.name] = [];
        map[req.name].push({
          roleKey: role.key,
          weight: req.weight,
          title: role.title,
          icon: role.icon
        });
      });
    });
    return map;
  }

  const COURSE_TO_CAREER = buildCourseCareerReverseMap();

  function normalizeCourseName(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function getRoleByKey(key) {
    return CAREER_ROLES.find(r => r.key === key) || null;
  }

  function resolveCanonicalCourseName(name) {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    if (COURSE_CATALOG_META[raw]) return raw;

    const norm = normalizeCourseName(raw);
    for (const key of Object.keys(COURSE_CATALOG_META)) {
      if (normalizeCourseName(key) === norm) return key;
    }
    for (const key of Object.keys(COURSE_CATALOG_META)) {
      const nk = normalizeCourseName(key);
      if (norm.includes(nk) || nk.includes(norm)) return key;
    }
    return raw;
  }

  function parseCareerPathsField(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function inferCareerLinksFromText(name, description) {
    const text = (name + ' ' + (description || '')).toLowerCase();
    const matched = new Map();

    KEYWORD_CAREER_RULES.forEach(rule => {
      if (rule.patterns.some(p => p.test(text))) {
        matched.set(rule.roleKey, (matched.get(rule.roleKey) || 0) + 1);
      }
    });

    if (matched.size) {
      const weight = Math.max(20, Math.round(100 / matched.size));
      return [...matched.keys()].map(roleKey => ({ roleKey, weight }));
    }

    return DEFAULT_CAREER_KEYS.map(roleKey => ({ roleKey, weight: 25 }));
  }

  function getCareerLinksForCourse(courseName, courseRow) {
    const dbPaths = parseCareerPathsField(courseRow?.career_paths);
    if (dbPaths.length) {
      return dbPaths
        .map(item => ({
          roleKey: item.key || item.roleKey,
          weight: Number(item.weight) || 25
        }))
        .filter(item => item.roleKey && getRoleByKey(item.roleKey));
    }

    const canonical = resolveCanonicalCourseName(courseName);
    if (COURSE_TO_CAREER[canonical]) {
      return COURSE_TO_CAREER[canonical].map(link => ({ ...link }));
    }

    return inferCareerLinksFromText(courseName, courseRow?.description || courseRow?.desc);
  }

  function getCareerLabelsForCourse(courseName, courseRow) {
    const seen = new Set();
    return getCareerLinksForCourse(courseName, courseRow)
      .map(link => getRoleByKey(link.roleKey))
      .filter(role => role && !seen.has(role.key) && seen.add(role.key));
  }

  function parseCourseHours(hoursStr, fallback) {
    const match = String(hoursStr || '').match(/(\d+)/);
    return match ? Number(match[1]) : (fallback || 20);
  }

  function getCourseMeta(courseName, courseRow) {
    const canonical = resolveCanonicalCourseName(courseName);
    const known = COURSE_CATALOG_META[canonical];
    if (known) {
      return {
        ...known,
        hours: known.hours || parseCourseHours(courseRow?.hours)
      };
    }
    return {
      hours: parseCourseHours(courseRow?.hours),
      skills: inferSkillsFromCourse(courseName, courseRow?.description || courseRow?.desc),
      domains: ['التطوير المهني']
    };
  }

  function inferSkillsFromCourse(name, description) {
    const links = getCareerLinksForCourse(name, { description });
    const skills = new Set();
    links.forEach(link => {
      const role = getRoleByKey(link.roleKey);
      if (role) skills.add('مهارات ' + role.title);
    });
    if (!skills.size) skills.add('مهارات ' + name);
    return [...skills];
  }

  function computeCareerReadiness(courseProgress, courseMap) {
    const roleEarned = {};
    const roleWeight = {};
    CAREER_ROLES.forEach(r => {
      roleEarned[r.key] = 0;
      roleWeight[r.key] = 0;
    });

    Object.entries(courseProgress || {}).forEach(([courseName, progress]) => {
      const pct = Number(progress) || 0;
      if (pct <= 0) return;

      const links = getCareerLinksForCourse(courseName, courseMap?.[courseName]);
      links.forEach(link => {
        if (!roleEarned[link.roleKey]) return;
        roleWeight[link.roleKey] += link.weight;
        roleEarned[link.roleKey] += link.weight * (pct / 100);
      });
    });

    return CAREER_ROLES.map(role => {
      const total = roleWeight[role.key];
      const readiness = total ? Math.round((roleEarned[role.key] / total) * 100) : 0;
      return { ...role, readiness };
    }).sort((a, b) => b.readiness - a.readiness);
  }

  global.InexcCareerMap = {
    CAREER_ROLES,
    COURSE_CATALOG_META,
    COURSE_PATHS,
    COURSE_TO_CAREER,
    DEFAULT_CAREER_KEYS,
    getRoleByKey,
    resolveCanonicalCourseName,
    getCareerLinksForCourse,
    getCareerLabelsForCourse,
    getCourseMeta,
    parseCourseHours,
    computeCareerReadiness,
    inferCareerLinksFromText
  };
})(typeof window !== 'undefined' ? window : globalThis);
