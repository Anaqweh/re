(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const root = document.getElementById('course');
  if (!id || !window.INEXC_REGISTRATION_ENDPOINT) { root.innerHTML = '<p class="error">تعذر العثور على الدورة.</p>'; return; }
  try {
    const response = await fetch(window.INEXC_REGISTRATION_ENDPOINT + '/courses');
    const course = (await response.json()).find(item => item.id === id);
    if (!course) throw new Error('not found');
    const esc = value => String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    document.title = course.name + ' | INEXC Training';
    document.querySelector('meta[name="description"]').content = course.description || ('تفاصيل دورة ' + course.name + ' من INEXC Training');
    const price = Number(course.price) === 0 ? 'مجاني' : Number(course.price).toLocaleString('ar-AE') + ' د.إ';
    root.innerHTML = '<span class="tag">' + esc(course.category || 'دورة تدريبية') + '</span><h1>' + esc(course.name) + '</h1><p>' + esc(course.description || '') + '</p><div class="meta"><span>📅 ' + esc(course.date || 'سيحدد لاحقًا') + '</span><span>📍 ' + esc(course.location || 'سيحدد لاحقًا') + '</span><span>💳 ' + price + '</span></div><a class="button" href="register.html?course=' + encodeURIComponent(course.name) + '">سجّل في هذه الدورة</a>';
    const schema = { '@context':'https://schema.org', '@type':'Course', name:course.name, description:course.description, provider:{'@type':'Organization',name:'INEXC Training',url:'https://www.inexctraining.com'}, offers:{'@type':'Offer',price:course.price,priceCurrency:'AED',availability:'https://schema.org/InStock'} };
    const node = document.createElement('script'); node.type = 'application/ld+json'; node.textContent = JSON.stringify(schema); document.head.appendChild(node);
  } catch (_) { root.innerHTML = '<p class="error">تعذر تحميل تفاصيل هذه الدورة حاليًا.</p>'; }
})();
