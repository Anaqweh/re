/* عرض آراء المتدربين الظاهرة فقط في الصفحة الرئيسية. */
window.addEventListener('DOMContentLoaded', async () => {
  const section = document.getElementById('testimonials');
  const grid = document.getElementById('testimonialsGrid');
  const endpoint = window.INEXC_REGISTRATION_ENDPOINT || '';
  if (!section || !grid || !endpoint) return;
  try {
    const response = await fetch(`${endpoint}/testimonials`);
    if (!response.ok) throw new Error('Testimonials unavailable');
    const data = await response.json();
    const testimonials = Array.isArray(data.testimonials) ? data.testimonials.slice(0, 3) : [];
    if (data.visible === false || !testimonials.length) return;
    const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
    const apiOrigin = endpoint.replace(/\\/api\\/?$/, '');
    grid.innerHTML = testimonials.map(item => {
      const initial = escape(String(item.name || 'م').trim().charAt(0) || 'م');
      const image = item.imageUrl ? `<img class="testimonial-avatar" src="${escape(apiOrigin + item.imageUrl)}" alt="${escape(item.name)}" loading="lazy">` : `<span class="testimonial-avatar">${initial}</span>`;
      const rating = Math.max(1, Math.min(5, Number(item.rating) || 5));
      return `<article class="testimonial"><div class="testimonial-head">${image}<div><div class="testimonial-name">${escape(item.name)}</div>${item.verified ? '<span class="testimonial-verified">رأي موثّق ✓</span>' : ''}</div><div class="testimonial-stars" aria-label="${rating} من 5">${'★'.repeat(rating)}${'☆'.repeat(5-rating)}</div></div><p>“${escape(item.content)}”</p></article>`;
    }).join('');
    section.hidden = false;
  } catch (error) { console.warn('INEXC testimonials unavailable', error); }
});
