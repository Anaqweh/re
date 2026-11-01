/* تحميل بطاقات الدورات المنشورة من خادم INEXC الخاص. */
window.addEventListener('DOMContentLoaded', async () => {
  const grid = document.querySelector('.course-grid');
  const endpoint = window.INEXC_REGISTRATION_ENDPOINT || '';
  if (!grid || !endpoint) return;
  try {
    const response = await fetch(`${endpoint}/courses`);
    if (!response.ok) throw new Error('Courses are unavailable');
    const courses = await response.json();
    if (!courses.length) return;
    const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
    const price = value => Number(value) === 0 ? 'مجاني' : `${Number(value).toLocaleString('ar-AE')} <small>د.إ</small>`;
    const dateLabel = value => esc(value).replace(/(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})/g,'<bdi dir="ltr">$1</bdi>');
    const apiOrigin = endpoint.replace(/\/api\/?$/, '');
    const courseDetailsUrl = course => `/course/?id=${encodeURIComponent(course.id)}`;
    const overview = course => String(course.description || '').split(/\r?\n/).find(line => line.trim() && !line.startsWith('## ')) || '';
    const previewAxes = course => {
      const axes = course.axes || [], headings = axes.filter(line => /^(المحور\s+.+[:：]|##\s)/.test(line));
      return (headings.length ? headings : axes).slice(0,3).map(line => line.replace(/^(?:المحور\s+[^:：]+[:：]\s*|##\s*)/,''));
    };
    const courseMedia = course => course.imageUrl
      ? `<div class="course-media"><img src="${esc(`${apiOrigin}${course.imageUrl}`)}" alt="${esc(course.name)}" loading="lazy" decoding="async" width="640" height="360"></div>`
      : '<div class="course-media fallback"><img src="assets/inexc-logo-official-source.png" alt="INEXC Training" loading="lazy" decoding="async" width="640" height="360"></div>';
    grid.innerHTML = courses.map(course => `<article class="course${course.featured?' is-featured':''}">
      ${courseMedia(course)}
      ${course.featured?'<span class="course-featured-badge">★ مميّزة</span>':''}
      <span class="course-label">${esc(course.category || 'دورة تدريبية')}</span>
      <h3>${esc(course.name)}</h3><p>${esc(overview(course))}</p>
      ${(course.axes || []).length ? `<div class="course-axes"><b>من محاور البرنامج</b><ul>${previewAxes(course).map(axis => `<li>${esc(axis)}</li>`).join('')}</ul></div>` : ''}
      <div class="course-meta"><span>${dateLabel(course.date || 'سيحدد لاحقًا')}</span><span>${esc(course.location || 'عن بُعد / حضوري')}</span></div>
      <p class="course-card-eligibility">${esc(window.INEXCCardLabels?.eligibility(course)||'')}</p>
      <div class="course-bottom"><div class="course-quick-info">${Number(course.hours) > 0 ? `<span class="course-hours">⏱ ${Number(course.hours).toLocaleString('ar-AE')} ساعة</span>` : ''}<div class="price">${price(course.price)}</div></div>
      <a class="course-link" href="${esc(courseDetailsUrl(course))}">${Number(course.price)===0?'التفاصيل والتسجيل المجاني':'تفاصيل وتسجيل'}</a></div>
    </article>`).join('');
  } catch (error) { console.warn('INEXC course cards unavailable', error); }
});
