(function (global) {
  const DETAIL_FIELDS = [
    'description',
    'objectives',
    'outcomes',
    'what_you_learn',
    'learn_content',
    'course_method',
    'delivery_method',
    'target_audience',
    'requirements'
  ];

  function courseContentScore(row) {
    if (!row) return 0;
    return DETAIL_FIELDS.reduce((sum, key) => sum + String(row[key] || '').trim().length, 0);
  }

  function dedupeCoursesByName(rows) {
    const byName = new Map();

    (rows || []).forEach(row => {
      const name = String(row.name || '').trim();
      if (!name) return;

      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, row);
        return;
      }

      const existingScore = courseContentScore(existing);
      const rowScore = courseContentScore(row);
      const existingTime = new Date(existing.created_at || 0).getTime();
      const rowTime = new Date(row.created_at || 0).getTime();

      if (rowScore > existingScore || (rowScore === existingScore && rowTime > existingTime)) {
        byName.set(name, row);
      }
    });

    return Array.from(byName.values()).sort(
      (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
    );
  }

  const EMPTY_INFO_TEXT = 'لم تتم إضافة معلومات بعد';

  function normalizeCourseFields(row) {
    if (!row) return {};
    return {
      id: row.id || null,
      name: row.name || '',
      description: row.description || '',
      type: row.type || 'free',
      price: Number(row.price) || 0,
      status: row.status || 'active',
      hours: row.hours || '20 ساعة',
      level: row.level || 'متوسط',
      cert: row.cert || 'شهادة INEXC',
      days: row.days || 20,
      career_paths: row.career_paths || null,
      objectives: row.objectives || row.goals || '',
      outcomes: row.outcomes || row.outputs || '',
      what_you_learn: row.what_you_learn || row.learning_points || row.learn_content || '',
      course_method: row.course_method || row.delivery_method || row.method || '',
      target_audience: row.target_audience || row.audience || '',
      requirements: row.requirements || ''
    };
  }

  global.InexcCourseLoad = {
    EMPTY_INFO_TEXT,
    courseContentScore,
    dedupeCoursesByName,
    normalizeCourseFields
  };
})(typeof window !== 'undefined' ? window : globalThis);
