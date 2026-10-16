(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const inline = value => esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})/g,'<bdi dir="ltr">$1</bdi>');
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
    const unavailable = () => {
      const robots = document.querySelector('meta[name="robots"]') || document.createElement('meta');
      robots.name = 'robots'; robots.content = 'noindex,follow';
      if (!robots.isConnected) document.head.appendChild(robots);
      document.title = 'الدورة غير متاحة | INEXC Training';
      root.innerHTML = '<p class="error" style="padding:25px">هذه الدورة غير متاحة حاليًا. <a href="/">استعرض الدورات المتاحة</a></p>';
    };
    if (!id) { unavailable(); return; }
    if (!endpoint) { root.innerHTML = '<p class="error">تعذر تحميل تفاصيل الدورة حاليًا.</p>'; return; }
    try {
      const response = await fetch(`${endpoint}/courses`, {cache:'no-store'});
      if (!response.ok) throw new Error('Course service unavailable');
      const courses = await response.json();
      if (!Array.isArray(courses)) throw new Error('Invalid course response');
      const course = courses.find(item => item.id === id);
      if (!course) { unavailable(); return; }
      document.title = `${course.name} | INEXC Training`; document.querySelector('meta[name="description"]').content = (course.description || '').split(/\r?\n/)[0] || `تفاصيل دورة ${course.name} من INEXC Training`;
      // Both course entry points describe the same course. Keep its ID and drop tracking parameters.
      const canonical = document.querySelector('link[rel="canonical"]') || document.createElement('link');
      canonical.rel = 'canonical';
      canonical.href = `https://www.inexctraining.com/course.html?id=${encodeURIComponent(course.id)}`;
      if (!canonical.isConnected) document.head.appendChild(canonical);
      const apiOrigin = endpoint.replace(/\/api\/?$/, ''), image = course.imageUrl ? `${apiOrigin}${course.imageUrl}` : '/assets/inexc-logo-official-source.png', axes = groupAxes(course.axes), outcomes = course.outcomes || [];
      const certificateNote = course.certificate?.mode === 'included' ? `شهادة ${course.certificate.name || 'إتمام'} مشمولة في سعر الدورة.` : course.certificate?.mode === 'optional' ? `شهادة ${course.certificate.name || 'إتمام'} اختيارية بسعر ${Number(course.certificate.price || 0).toLocaleString('ar-AE')} د.إ.` : 'لا توجد شهادة ضمن هذه الدورة.';
      const panels = [
        { label:'عن الدورة', content:`<section class="panel intro"><span class="tag">${esc(course.category || 'دورة تدريبية')}</span><h1>${esc(course.name)}</h1><div class="rich">${rich(course.description)}</div><div class="meta">${course.trainer ? `<span>المدرّب: ${esc(course.trainer)}</span>` : ''}<span>📅 ${inline(course.date || 'سيُعلن قريبًا')}</span><span>📍 ${esc(course.location || 'عن بُعد / حضوري')}</span>${Number(course.hours) > 0 ? `<span>⏱️ ${Number(course.hours).toLocaleString('ar-AE')} ساعة تدريبية</span>` : ''}<span>💳 ${Number(course.price) === 0 ? 'مجاني' : `${Number(course.price).toLocaleString('ar-AE')} د.إ`}</span></div><button class="share-button" type="button">مشاركة الدورة</button></section>` },
        ...(axes.length ? [{ label:'محاور الدورة', content:`<section class="panel"><h2>محاور الدورة</h2><p class="panel-lead">اضغط على أي محور رئيسي لعرض النقاط التي يتضمنها.</p>${axes.map((axis,index) => `<details class="axis-group"><summary><i class="axis-number">${arabicNumber(index)}</i><span>${inline(axis.title)}</span><b class="axis-arrow">⌄</b></summary>${axis.points.length ? `<ul class="axis-list">${axis.points.map(point => `<li>${inline(point)}</li>`).join('')}</ul>` : '<p class="axis-empty">تفاصيل هذا المحور ستُناقش ضمن جلسات الدورة.</p>'}</details>`).join('')}</section>` }] : []),
        ...(outcomes.length ? [{ label:'مخرجات الدورة', content:`<section class="panel"><h2>ماذا ستخرج به بعد الدورة؟</h2><p class="panel-lead">نتائج عملية تساعدك على الانتقال من المعرفة إلى التطبيق.</p>${outcomes.map(outcome => `<article class="outcome">${inline(outcome)}</article>`).join('')}</section>` }] : []),
        { label:'هل تناسبك؟', content:`<section class="panel"><h2>هل هذه الدورة مناسبة لك؟</h2><p class="panel-lead">أجب عن 3 أسئلة قصيرة لتحصل على توجيه مناسب قبل التسجيل.</p><div class="fit-card" data-fit-check><div class="fit-question"><b>1. ما هدفك الأساسي من الدورة؟</b><div class="fit-options"><button class="fit-option" type="button" data-fit-question="goal" data-fit-value="تطوير مهارة عملية">تطوير مهارة عملية</button><button class="fit-option" type="button" data-fit-question="goal" data-fit-value="تطبيقها في التعليم أو العمل">تطبيقها في التعليم أو العمل</button><button class="fit-option" type="button" data-fit-question="goal" data-fit-value="بناء مشروع أو مخرج واضح">بناء مشروع أو مخرج واضح</button></div></div><div class="fit-question"><b>2. ما مستوى خبرتك الحالي؟</b><div class="fit-options"><button class="fit-option" type="button" data-fit-question="level" data-fit-value="beginner">مبتدئ</button><button class="fit-option" type="button" data-fit-question="level" data-fit-value="basic">لدي معرفة أساسية</button><button class="fit-option" type="button" data-fit-question="level" data-fit-value="advanced">أستخدم الأدوات وأريد مستوى متقدمًا</button></div></div><div class="fit-question"><b>3. كيف ستستفيد منها؟</b><div class="fit-options"><button class="fit-option" type="button" data-fit-question="use" data-fit-value="عملك الحالي">في عملي الحالي</button><button class="fit-option" type="button" data-fit-question="use" data-fit-value="تدريبك أو تدريسك">في تدريبي أو تدريسي</button><button class="fit-option" type="button" data-fit-question="use" data-fit-value="مشروع شخصي أو مؤسسي">في مشروع شخصي أو مؤسسي</button></div></div><div class="fit-result" data-fit-result>أجب عن الأسئلة الثلاثة لتظهر لك النتيجة المناسبة.</div><a class="fit-register" data-fit-register href="/register/?course_id=${encodeURIComponent(course.id)}&course=${encodeURIComponent(course.name)}">سجّل في الدورة الآن ←</a></div></section>` },
        { label:'السعر', content:`<section class="panel"><h2>السعر وخيارات الشهادة</h2><div class="price-box"><div class="price-top"><span class="price-icon">💳</span><span>سعر الدورة</span></div><div class="price-amount">${Number(course.price) === 0 ? 'مجاني' : `${Number(course.price).toLocaleString('ar-AE')} د.إ`}</div><p class="price-note">${esc(certificateNote)}</p></div></section>` },
        { label:'التسجيل', content:`<section class="panel"><div class="register-box"><h2>جاهز للبدء؟</h2><p>أرسل طلبك الآن، وسيتم التواصل معك لاستكمال خطوات التسجيل بالطريقة المناسبة.</p><a class="button" href="/register/?course_id=${encodeURIComponent(course.id)}&course=${encodeURIComponent(course.name)}">سجّل في هذه الدورة ←</a></div></section>` }
      ];
      root.innerHTML = `<img decoding="async" width="1672" height="941" class="cover" src="${esc(image)}" alt="${esc(course.name)}"><div class="content"><div class="journey"><div class="steps">${panels.map((panel,index) => `<button class="step" type="button">${index + 1}. ${panel.label}</button>`).join('')}</div>${panels.map(panel => panel.content).join('')}<div class="controls"><button class="previous" type="button">السابق</button><button class="next" type="button">التالي ←</button></div></div></div>`;
      setupJourney(root);
      const shareButton = root.querySelector('.share-button');
      shareButton?.addEventListener('click', async () => {
        const shareUrl = /^https:\/\/courses\.inexctraining\.com\/course-[a-z0-9]+$/.test(course.shareUrl || '') ? course.shareUrl : `https://www.inexctraining.com/course/?id=${encodeURIComponent(course.id)}`;
        try {
          if (navigator.share) await navigator.share({ title: course.name, text: `تفاصيل دورة ${course.name} من INEXC Training`, url: shareUrl });
          else { await navigator.clipboard.writeText(shareUrl); shareButton.textContent = 'تم نسخ رابط الدورة ✓'; }
        } catch (_) { /* إلغاء نافذة المشاركة لا يحتاج إلى تنبيه. */ }
      });
      const fitCheck = root.querySelector('[data-fit-check]');
      if (fitCheck) {
        const answers = {}, result = fitCheck.querySelector('[data-fit-result]'), register = fitCheck.querySelector('[data-fit-register]');
        fitCheck.querySelectorAll('[data-fit-question]').forEach(button => button.addEventListener('click', () => {
          const question = button.dataset.fitQuestion;
          answers[question] = button.dataset.fitValue;
          fitCheck.querySelectorAll(`[data-fit-question="${question}"]`).forEach(item => item.classList.toggle('selected', item === button));
          if (answers.goal && answers.level && answers.use) {
            const levelNote = answers.level === 'beginner' ? 'وستحصل على انتقال تدريجي من الفهم إلى التطبيق.' : answers.level === 'advanced' ? 'وستساعدك على الانتقال إلى مستوى أكثر تقدمًا في التطبيق والإنتاج.' : 'وستبني على معرفتك الحالية بخطوات عملية واضحة.';
            result.innerHTML = `<strong>هذه الدورة مناسبة لك ✓</strong><br>لأن هدفك هو ${esc(answers.goal)}، وستوظف ما تتعلمه في ${esc(answers.use)}. ${levelNote}`;
            register.classList.add('ready');
          }
        }));
      }
      const schema = { '@context':'https://schema.org', '@type':'Course', name:course.name, description:course.description, provider:{'@type':'Organization',name:'INEXC Training',url:'https://www.inexctraining.com'}, offers:{'@type':'Offer',price:course.price,priceCurrency:'AED',availability:'https://schema.org/InStock'} }; const node = document.createElement('script'); node.type = 'application/ld+json'; node.textContent = JSON.stringify(schema); document.head.appendChild(node);
    } catch (_) { root.innerHTML = '<p class="error" style="padding:25px">تعذر تحميل تفاصيل هذه الدورة حاليًا.</p>'; }
  });
})();

