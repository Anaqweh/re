/* مساعد INEXC المجاني: يوجّه الزائر وفق بيانات الموقع دون خدمة خارجية. */
(() => {
  if (document.getElementById('inexcAssistant')) return;
  const endpoint = window.INEXC_REGISTRATION_ENDPOINT || '';
  const FAQS = [
    { question:'هل الدورة حضورية أم عن بُعد؟', keys:['حضوري','حضورية','أون لاين','اون لاين','عن بعد','عن بُعد','وجاهي','وجاهيا','مكان الدورة'], answer:'كل دورة مختلفة عن الأخرى، بعض الدورات أون لاين، وبعض الدورات وجاهيًا.' },
    { question:'هل توجد شهادة؟', keys:['شهادة','الشهادات'], answer:'تظهر خيارات الشهادة وسعرها عند اختيار الدورة.' },
    { question:'كيف أسجل؟', keys:['كيف أسجل','كيف اسجل','التسجيل','سجل'], answer:'اختر الدورة ثم املأ نموذج التسجيل، وسيصلك تأكيد عبر البريد.' },
    { question:'ما نوع الشهادات؟', keys:['نوع الشهادات','أنواع الشهادات','انواع الشهادات','البورد الأمريكي','البورد الامريكي','cambridge','كامبردج','كامبرج','khda','adek'], answer:'تتوفر شهادات دولية مثل البورد الأمريكي وCambridge، وشهادات محلية مثل شركة التميز الابتكاري وKHDA وADEK، بالتعاون مع المؤسسات الدولية والمحلية.' },
    { question:'هل لديكم شهادات ماجستير مهني أو دكتوراه مهني؟', keys:['ماجستير مهني','دكتوراه مهني','دكتوراة مهني','ماجستير','دكتوراه'], answer:'نعم، لدينا تعاون دولي يمكن من خلاله إصدار الشهادات المهنية المصدّقة حسب الأصول.' },
    { question:'هل لديكم خدمات أخرى؟', keys:['خدمات أخرى','خدمات اخرى','خدماتكم','خدمات'], answer:'نعم، نقدم العديد من الخدمات التعليمية والتدريبية وغيرها. يمكن التواصل عبر واتساب لمعرفة الخدمة الأنسب لاحتياجك.' },
    { question:'هل تنصحون بدورات IELTS أو TOEFL أو اللغة الإنجليزية؟', keys:['ielts','ايلتس','آيلتس','toefl','توفل','لغة انجليزية','اللغة الإنجليزية','اللغة الانجليزية','انجليزي'], answer:'نعم، نرشّح معهد سبارك لتعليم اللغات لبرامج IELTS وTOEFL ودورات اللغة الإنجليزية. يمكن التواصل معهم مباشرة عبر واتساب.', url:'https://wa.me/971506226156', urlLabel:'التواصل مع معهد سبارك عبر واتساب ←', listed:false },
    { question:'هل تقدمون برامج تدريبية للمؤسسات والمدارس والشركات؟', keys:['للمؤسسات','للمؤسسه','للمدارس','للشركات','برنامج مؤسسي','برامج مؤسسية','برامج مؤسسيه','تدريب مؤسسة','تدريب مؤسسي'], answer:'نعم، نقدم برامج ودورات تدريبية مخصصة للمؤسسات التعليمية وغير التعليمية، بما يشمل المدارس والشركات والجهات المختلفة، باللغتين العربية والإنجليزية. نعمل على مواءمة المحتوى وطريقة التنفيذ مع احتياج الجهة.' , url:'/register/?type=institution', urlLabel:'اطلب برنامجًا تدريبيًا لمؤسستك ←', listed:false }
  ];
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const root = document.createElement('div');
  root.id = 'inexcAssistant';
  root.innerHTML = `<button id="assistantToggle" type="button" aria-expanded="false" aria-controls="assistantPanel"><span class="assistant-dot"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A3.5 3.5 0 0 1 7.5 1h9A3.5 3.5 0 0 1 20 4.5v7a3.5 3.5 0 0 1-3.5 3.5H10l-4.5 4v-4.42A3.5 3.5 0 0 1 4 11.5v-7ZM8 7h8M8 10h5"/></svg><span>مساعد INEXC</span></button><section id="assistantPanel" hidden aria-label="مساعد INEXC"><header><div><b>كيف يمكنني مساعدتك؟</b><small>مساعد سريع ومجاني</small></div><button id="assistantClose" type="button" aria-label="إغلاق">×</button></header><div id="assistantMessages" class="assistant-messages"></div><div id="assistantQuick" class="assistant-quick"><button type="button" data-assistant-action="courses">الدورات المتاحة</button><button type="button" data-assistant-action="register">أريد التسجيل</button><button type="button" data-assistant-action="institution">طلب مؤسسة</button><button type="button" data-assistant-action="english">IELTS والإنجليزية</button><button type="button" data-assistant-action="institutionTraining">الدورات للمؤسسات</button><button type="button" data-assistant-action="faq">أسئلة شائعة</button><button type="button" data-assistant-action="contact">تواصل مع الفريق</button></div><form id="assistantForm"><input id="assistantInput" maxlength="300" autocomplete="off" placeholder="اكتب سؤالك عن الدورات"><button type="submit" aria-label="إرسال">←</button></form></section>`;
  const style = document.createElement('style');
  style.textContent = `
    #inexcAssistant{position:fixed;right:22px;bottom:22px;z-index:9998;font-family:Arial,sans-serif;color:#17324d}
    #assistantToggle{display:inline-flex;align-items:center;gap:8px;background:#0866c6;color:#fff;border:1px solid #ffffff55;border-radius:999px;padding:12px 15px;box-shadow:0 12px 28px #0866c63d;font:700 12px Arial,sans-serif;cursor:pointer;transition:.18s}
    #assistantToggle:hover{transform:translateY(-2px);background:#0757a8}#assistantToggle svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.assistant-dot{width:7px;height:7px;background:#31d69b;border:2px solid #fff;border-radius:50%;position:absolute;margin:-18px 0 0 16px}
    #assistantPanel{position:absolute;bottom:67px;right:0;width:360px;overflow:hidden;background:#fff;border:1px solid #d8e9fa;border-radius:18px;box-shadow:0 24px 65px #0753982b;direction:rtl}
    #assistantPanel header{display:flex;align-items:center;justify-content:space-between;padding:16px 17px;background:linear-gradient(135deg,#063f86,#0866c6);color:#fff}#assistantPanel header b{display:block;font-size:14px}#assistantPanel header small{display:block;font-size:10px;opacity:.84;margin-top:2px}#assistantClose{background:transparent;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:0 4px}
    .assistant-messages{min-height:112px;max-height:260px;overflow:auto;padding:14px;background:#f8fbff}.assistant-message{max-width:91%;width:max-content;padding:10px 12px;margin:0 0 9px;border-radius:12px;font-size:12px;line-height:1.8}.assistant-message.bot{background:#fff;border:1px solid #e0edf9;color:#46627c;border-top-right-radius:3px}.assistant-message.user{background:#e1f1ff;color:#124778;margin-right:auto;border-top-left-radius:3px}.assistant-message a{color:#0866c6;font-weight:700;text-decoration:none}.assistant-course-list{display:grid;gap:6px;margin-top:7px}.assistant-course{display:block;border:1px solid #cfe5fa;background:#f5faff;color:#0d5ca9!important;border-radius:9px;padding:8px;text-decoration:none!important;font-size:11px}
    .assistant-quick{display:flex;flex-wrap:wrap;gap:7px;padding:11px 12px;border-top:1px solid #e7f0fa;background:#fff}.assistant-quick button{background:#fff;border:1px solid #cfe4f8;color:#0866c6;border-radius:999px;padding:7px 9px;font:700 10px Arial;cursor:pointer}.assistant-quick button:hover{background:#edf7ff}
    #assistantForm{display:flex;gap:7px;padding:10px 12px;border-top:1px solid #e7f0fa;background:#fff}#assistantInput{flex:1;min-width:0;border:1px solid #d5e6f6;border-radius:9px;padding:9px 10px;font:12px Arial;outline:0}#assistantInput:focus{border-color:#0866c6;box-shadow:0 0 0 3px #0866c617}#assistantForm button{border:0;background:#0866c6;color:#fff;width:37px;border-radius:9px;font-size:18px;cursor:pointer}
    @media(max-width:600px){#inexcAssistant{right:14px;bottom:14px}#assistantToggle{width:56px;height:56px;border-radius:50%;justify-content:center;padding:0}#assistantToggle span:last-child{display:none}#assistantToggle svg{width:22px;height:22px}.assistant-dot{margin:-20px 0 0 19px}#assistantPanel{position:fixed;right:12px;left:12px;bottom:80px;width:auto;max-height:calc(100vh - 100px)}.assistant-messages{max-height:calc(100vh - 315px)}}`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const panel = document.getElementById('assistantPanel');
  const toggle = document.getElementById('assistantToggle');
  const messages = document.getElementById('assistantMessages');
  const quick = document.getElementById('assistantQuick');
  let courses = [];
  const show = () => { panel.hidden=false; toggle.setAttribute('aria-expanded','true'); document.getElementById('assistantInput').focus(); };
  const hide = () => { panel.hidden=true; toggle.setAttribute('aria-expanded','false'); };
  const say = (html, type='bot') => { const bubble=document.createElement('div'); bubble.className='assistant-message '+type; bubble.innerHTML=html; messages.appendChild(bubble); messages.scrollTop=messages.scrollHeight; };
  const getCourses = async () => {
    if (courses.length || !endpoint) return courses;
    try { const response=await fetch(endpoint+'/courses'); if(response.ok) courses=await response.json(); } catch (_) {}
    return courses;
  };
  const courseList = async () => {
    const list=await getCourses();
    if(!list.length) return say('لا توجد دورات منشورة حاليًا. يمكنك التواصل مع الفريق وسيساعدك مباشرة.');
    say('هذه الدورات المتاحة الآن:<div class="assistant-course-list">'+list.map(course=>'<a class="assistant-course" href="/course/?id='+encodeURIComponent(course.id)+'">'+esc(course.name)+(Number(course.hours)>0?' · '+Number(course.hours).toLocaleString('ar-AE')+' ساعة':'')+'</a>').join('')+'</div>');
  };
  const action = async name => {
    if(name==='courses') return courseList();
    if(name==='register') return say('يمكنك اختيار الدورة المناسبة ثم بدء التسجيل من هنا:<br><a href="/register/">ابدأ التسجيل ←</a>');
    if(name==='institution') return say('لديك برنامج مخصص للمؤسسات. اترك احتياجكم وسيتواصل الفريق معكم:<br><a href="/register/?type=institution">طلب برنامج لمؤسسة ←</a>');
    if(name==='english') { const item=FAQS.find(entry => entry.url === 'https://wa.me/971506226156'); return say(esc(item.answer)+'<br><a href="'+item.url+'" target="_blank" rel="noopener">'+esc(item.urlLabel)+'</a>'); }
    if(name==='institutionTraining') { const item=FAQS.find(entry => entry.url === '/register/?type=institution'); return say(esc(item.answer)+'<br><a href="'+item.url+'">'+esc(item.urlLabel)+'</a>'); }
    if(name==='faq') return say(FAQS.filter(item => item.listed !== false).map(item => '<b style="display:block;color:#103b70;margin-top:4px">'+esc(item.question)+'</b>'+esc(item.answer)).join('<br>'));
    if(name==='contact') return say('يمكنك التواصل السريع مع فريقنا عبر <a href="https://wa.me/971543475500?text='+encodeURIComponent('مرحبًا، لدي استفسار عن دورات INEXC Training.')+'" target="_blank" rel="noopener">واتساب ←</a>');
  };
  toggle.onclick = () => panel.hidden ? show() : hide();
  document.getElementById('assistantClose').onclick = hide;
  quick.onclick = event => { const button=event.target.closest('[data-assistant-action]'); if(button) action(button.dataset.assistantAction); };
  document.getElementById('assistantForm').onsubmit = async event => {
    event.preventDefault();
    const input=document.getElementById('assistantInput'), question=input.value.trim(); if(!question) return;
    say(esc(question),'user'); input.value='';
    const normalized=question.toLowerCase();
    const faq = FAQS.find(item => item.keys.some(key => normalized.includes(key.toLowerCase())));
    if (faq) return say(esc(faq.answer)+(faq.url ? '<br><a href="'+faq.url+'" target="_blank" rel="noopener">'+esc(faq.urlLabel)+'</a>' : ''));
    if(/دورة|دورات|برنامج|المتاح/.test(normalized)) return courseList();
    if(/سجل|تسجيل|التحاق/.test(normalized)) return action('register');
    if(/مؤسسة|مؤسسه|شركة|مدرسة|جامعة|جهة/.test(normalized)) return action('institution');
    if(/واتساب|تواصل|موظف|فريق/.test(normalized)) return action('contact');
    if(/سعر|رسوم|دفع|شهادة|ساعات|محاور/.test(normalized)) { const list=await getCourses(); const match=list.find(course=>normalized.includes(String(course.name).toLowerCase())); if(match) return say('يمكنك الاطلاع على السعر والمحاور والشهادة لهذه الدورة هنا:<br><a href="/course/?id='+encodeURIComponent(match.id)+'">'+esc(match.name)+' ←</a>'); return say('تظهر تفاصيل السعر والشهادة والمحاور داخل كل دورة. اختر الدورة التي تهمك:'); }
    const list=await getCourses(); const match=list.find(course=>normalized.includes(String(course.name).toLowerCase()) || String(course.name).toLowerCase().includes(normalized)); if(match) return say('هذه صفحة الدورة التي تبحث عنها:<br><a href="/course/?id='+encodeURIComponent(match.id)+'">'+esc(match.name)+' ←</a>');
    say('أستطيع مساعدتك في معرفة الدورات أو التسجيل أو طلب برنامج لمؤسسة. اختر أحد الخيارات أسفل المحادثة.');
  };
  say('مرحبًا بك في INEXC. يمكنني مساعدتك في اختيار دورة، التسجيل، أو طلب برنامج لمؤسستك.');
})();
