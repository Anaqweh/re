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
    const apiOrigin = endpoint.replace(/\/api\/?$/, '');
    const courseMedia = course => course.imageUrl
      ? `<div class="course-media"><img src="${esc(`${apiOrigin}${course.imageUrl}`)}" alt="${esc(course.name)}" loading="lazy"></div>`
      : '<div class="course-media fallback"><img src="assets/inexc-logo-official-source.png" alt="INEXC Training" loading="lazy"></div>';
    grid.innerHTML = courses.map(course => `<article class="course">
      ${courseMedia(course)}
      <span class="course-label">${esc(course.category || 'دورة تدريبية')}</span>
      <h3>${esc(course.name)}</h3><p>${esc(course.description)}</p>
      ${(course.axes || []).length ? `<div class="course-axes"><b>محاور الدورة</b><ul>${course.axes.slice(0,3).map(axis => `<li>${esc(axis)}</li>`).join('')}</ul></div>` : ''}
      <div class="course-meta"><span>${esc(course.date || 'سيحدد لاحقًا')}</span><span>${esc(course.location || 'عن بُعد / حضوري')}</span></div>
      <div class="course-bottom"><div class="price">${price(course.price)}</div>
      <a class="course-link" href="/course/?id=${encodeURIComponent(course.id)}">تفاصيل وتسجيل</a></div>
    </article>`).join('');
  } catch (error) { console.warn('INEXC course cards unavailable', error); }
});
