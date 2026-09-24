(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const inline = value => esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const rich = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.startsWith('## ') ? `<h3 class="rich-heading">${inline(line.slice(3))}</h3>` : `<p>${inline(line)}</p>`).join('') || '<p>ستظهر تفاصيل الدورة هنا قريبًا.</p>';
  const arabicNumber = value => ['١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'][value] || String(value + 1);
  const groupAxes = axes => {
    const groups = []; let current;
    (axes || []).map(value => String(value || '').trim()).filter(Boolean).forEach(line => {
      const manualHeading = line.match(/^##\s*(.+)$/);
      const naturalHeading = line.match(/^(المحور\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)\s*[:：-].+)$/);
      const title = manualHeading?.[1] || naturalHeading?.[1];
      if (title) { current = { title, points: [] }; groups.push(current); return; }
      if (!current) { current = { title: 'محاور البرنامج', points: [] }; groups.push(current); }
      current.points.push(line);
    });
    return groups;
  };
  const setupJourney = root => {
    const panels = [...root.querySelectorAll('.panel')], steps = [...root.querySelectorAll('.step')]; let current = 0;
    const paint = index => {
      current = Math.max(0, Math.min(index, panels.length - 1));
      panels.forEach((panel, i) => panel.classList.toggle('active', i === current));
      steps.forEach((step, i) => { step.classList.toggle('active', i === current); step.classList.toggle('done', i < current); step.setAttribute('aria-current', i === current ? 'step' : 'false'); });
      const previous = root.querySelector('.previous'), next = root.querySelector('.next'); previous.hidden = current === 0; next.hidden = current === panels.length - 1;
      root.querySelector('.journey').scrollIntoView({ behavior:'smooth', block:'start' });
    };
    steps.forEach((step, index) => step.addEventListener('click', () => paint(index)));
    root.querySelector('.previous').addEventListener('click', () => paint(current - 1)); root.querySelector('.next').addEventListener('click', () => paint(current + 1)); paint(0);
  };
  window.addEventListener('DOMContentLoaded', async () => {
    const id = new URLSearchParams(location.search).get('id'), root = document.getElementById('course'), endpoint = window.INEXC_REGISTRATION_ENDPOINT;
    if (!id || !endpoint) { root.innerHTML = '<p class="error">تعذر العثور على الدورة.</p>'; return; }
    try {
      const response = await fetch(`${endpoint}/courses`), course = (await response.json()).find(item => item.id === id); if (!course) throw new Error('not found');
      document.title = `${course.name} | INEXC Training`; document.querySelector('meta[name="description"]').content = course.description || `تفاصيل دورة ${course.name} من INEXC Training`;
      const apiOrigin = endpoint.replace(/\/api\/?$/, ''), image = course.imageUrl ? `${apiOrigin}${course.imageUrl}` : '/assets/inexc-logo-official-source.png', axes = groupAxes(course.axes), outcomes = course.outcomes || [];
      const certificateNote = course.certificate?.mode === 'included' ? `شهادة ${course.certificate.name || 'إتمام'} مشمولة في سعر الدورة.` : course.certificate?.mode === 'optional' ? `شهادة ${course.certificate.name || 'إتمام'} اختيارية بسعر ${Number(course.certificate.price || 0).toLocaleString('ar-AE')} د.إ.` : 'لا توجد شهادة ضمن هذه الدورة.';
      const panels = [
        { label:'عن الدورة', content:`<section class="panel intro"><span class="tag">${esc(course.category || 'دورة تدريبية')}</span><h1>${esc(course.name)}</h1><div class="rich">${rich(course.description)}</div><div class="meta"><span>📅 ${esc(course.date || 'سيُعلن قريبًا')}</span><span>📍 ${esc(course.location || 'عن بُعد / حضوري')}</span><span>💳 ${Number(course.price) === 0 ? 'مجاني' : `${Number(course.price).toLocaleString('ar-AE')} د.إ`}</span></div><button class="share-button" type="button">مشاركة الدورة</button></section>` },
        ...(axes.length ? [{ label:'محاور الدورة', content:`<section class="panel"><h2>محاور الدورة</h2><p class="panel-lead">اضغط على أي محور رئيسي لعرض النقاط التي يتضمنها.</p>${axes.map((axis,index) => `<details class="axis-group"><summary><i class="axis-number">${arabicNumber(index)}</i><span>${inline(axis.title)}</span><b class="axis-arrow">⌄</b></summary>${axis.points.length ? `<ul class="axis-list">${axis.points.map(point => `<li>${inline(point)}</li>`).join('')}</ul>` : '<p class="axis-empty">تفاصيل هذا المحور ستُناقش ضمن جلسات الدورة.</p>'}</details>`).join('')}</section>` }] : []),
        ...(outcomes.length ? [{ label:'مخرجات الدورة', content:`<section class="panel"><h2>ماذا ستخرج به بعد الدورة؟</h2><p class="panel-lead">نتائج عملية تساعدك على الانتقال من المعرفة إلى التطبيق.</p>${outcomes.map(outcome => `<article class="outcome">${inline(outcome)}</article>`).join('')}</section>` }] : []),
        { label:'السعر', content:`<section class="panel"><h2>السعر وخيارات الشهادة</h2><div class="price-box"><div class="price-top"><span class="price-icon">💳</span><span>سعر الدورة</span></div><div class="price-amount">${Number(course.price) === 0 ? 'مجاني' : `${Number(course.price).toLocaleString('ar-AE')} د.إ`}</div><p class="price-note">${esc(certificateNote)}</p></div></section>` },
        { label:'التسجيل', content:`<section class="panel"><div class="register-box"><h2>جاهز للبدء؟</h2><p>أرسل طلبك الآن، وسيتم التواصل معك لاستكمال خطوات التسجيل بالطريقة المناسبة.</p><a class="button" href="/register/?course=${encodeURIComponent(course.name)}">سجّل في هذه الدورة ←</a></div></section>` }
      ];
      root.innerHTML = `<img class="cover" src="${esc(image)}" alt="${esc(course.name)}"><div class="content"><div class="journey"><div class="steps">${panels.map((panel,index) => `<button class="step" type="button">${index + 1}. ${panel.label}</button>`).join('')}</div>${panels.map(panel => panel.content).join('')}<div class="controls"><button class="previous" type="button">السابق</button><button class="next" type="button">التالي ←</button></div></div></div>`;
      setupJourney(root);
      const shareButton = root.querySelector('.share-button');
      shareButton?.addEventListener('click', async () => {
        const shareUrl = course.shareUrl || location.href;
        try {
          if (navigator.share) await navigator.share({ title: course.name, text: `تفاصيل دورة ${course.name} من INEXC Training`, url: shareUrl });
          else { await navigator.clipboard.writeText(shareUrl); shareButton.textContent = 'تم نسخ رابط المشاركة ✓'; }
        } catch (_) { /* إلغاء نافذة المشاركة لا يحتاج إلى تنبيه. */ }
      });
      const schema = { '@context':'https://schema.org', '@type':'Course', name:course.name, description:course.description, provider:{'@type':'Organization',name:'INEXC Training',url:'https://www.inexctraining.com'}, offers:{'@type':'Offer',price:course.price,priceCurrency:'AED',availability:'https://schema.org/InStock'} }; const node = document.createElement('script'); node.type = 'application/ld+json'; node.textContent = JSON.stringify(schema); document.head.appendChild(node);
    } catch (_) { root.innerHTML = '<p class="error" style="padding:25px">تعذر تحميل تفاصيل هذه الدورة حاليًا.</p>'; }
  });
})();
