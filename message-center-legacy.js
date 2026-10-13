import { createMessageEditor } from './message-editor-legacy.js?v=20261012-studio2';
import { messageText, messageDirection, renderMessageBody } from './message-format-legacy.js?v=20261012-studio2';

(() => {
  const boot = () => {
    const $ = selector => document.querySelector(selector);
    const app = $('#app'), tabs = $('.tabs'), wrap = $('.wrap');
    if (!app || !tabs || !wrap || $('#message-center')) return;

    const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
    const state = { ready: false, templates: [], lists: [], courses: [], editingTemplate: '', uploadedAttachment: '', importFile: null };
    const api = () => window.INEXC_REGISTRATION_ENDPOINT || 'https://api.inexctraining.com/api';
    const call = async (path, options = {}) => {
      if (options.method && options.method !== 'GET' && !state.ready) throw Error('يلزم إكمال تحديث خدمة الرسائل على الخادم أولًا.');
      if (['POST','PUT'].includes(options.method) && /^\/admin\/(?:message-templates(?:\/[^/]+)?|messages(?:\/test)?)$/.test(path) && !state.richTextReady) throw Error('يلزم تحديث خدمة الرسائل لتفعيل حفظ التنسيق وإرساله. يمكنك تجهيز النص ومعاينته الآن.');
      const token = sessionStorage.getItem('inexc_do_admin') || '';
      if (!token) throw Error('انتهت جلسة الإدارة. سجّل الدخول ثم أعد المحاولة.');
      const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
      if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await fetch(api() + path, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'تعذر إتمام العملية.');
      return data;
    };
    const notify = (message, good = false) => {
      const output = $('#mc-feedback');
      output.style.color = good ? '#137b55' : '#b02b3a';
      output.textContent = message || '';
    };
    const setBusy = (button, busy, text = 'جارٍ التنفيذ…') => {
      if (!button) return;
      if (busy) { button.dataset.label = button.textContent; button.disabled = true; button.textContent = text; }
      else { button.disabled = false; button.textContent = button.dataset.label || button.textContent; }
    };
    const localRows = raw => String(raw || '').split(/\r?\n|;/).flatMap(line => {
      const emails = (line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(email => email.toLowerCase());
      const name = line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/[<>,|]/g, ' ').trim();
      return emails.length ? emails.map((email, index) => ({ email, name: index === 0 ? name : '' })) : [{ email:'', name }];
    }).filter(row => row.email || row.name);
    const merge = (value, sample = {}) => String(value || '').replace(/\{\{(name|email|course)\}\}/g, (_match, key) => sample[key] || '');

    const style = document.createElement('style');
    style.textContent = `
      #message-center{display:none}#message-center.active{display:block}#message-center [hidden]{display:none!important}#message-center :is(input,select,textarea,button){font-size:14px;min-width:0}#message-center :is(input,select,button){min-height:44px}#message-center :focus-visible{outline:3px solid #0866c6;outline-offset:3px}#message-center .mc-grid>*{min-width:0}#mc-preview-body{white-space:pre-wrap;overflow-wrap:anywhere}.mc-result:empty{display:none}.mc-result:not(:empty){padding:12px 16px;border:1px solid currentColor;border-radius:10px;background:#fff}.mc-status.partial{background:#fff4d9;color:#946500}.mc-shell{display:grid;gap:16px}.mc-hero{padding:23px;background:linear-gradient(135deg,#103b70,#0866c6);color:#fff;position:relative;overflow:hidden}.mc-hero:after{content:'';position:absolute;width:210px;height:210px;border:34px solid #ffffff15;border-radius:50%;left:-64px;top:-96px}.mc-hero>*{position:relative;z-index:1}.mc-eyebrow{font-size:11px;letter-spacing:.08em;opacity:.75;font-weight:700}.mc-hero h2{margin:7px 0 5px;font-size:24px}.mc-hero p{margin:0;max-width:700px;font-size:16px;line-height:1.9;color:#eaf4ff}.mc-tabs{display:flex;gap:8px;flex-wrap:wrap}.mc-tabs button.active{background:#103b70;color:#fff}.mc-view{display:none}.mc-view.active{display:block}.mc-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(330px,.85fr);gap:16px;align-items:start}.mc-stack{display:grid;gap:16px}.mc-card{padding:20px}.mc-card h3{margin:0 0 5px;color:#103b70;font-size:17px}.mc-muted{margin:0;color:#52677d;font-size:14px;line-height:1.8}.mc-step{display:flex;align-items:center;gap:8px;margin-bottom:12px}.mc-num{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#eaf4ff;color:#0866c6;font-size:12px;font-weight:800}.mc-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mc-inline{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.mc-inline>*{flex:1}.mc-inline button{flex:0 0 auto}.mc-variables{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.mc-variable{background:#f1f7ff;color:#0866c6;border:1px solid #d5e7fa;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:700}.mc-variable:hover{background:#e2f0ff}.mc-recipient-info{margin-top:10px;border:1px dashed #b6d3ee;border-radius:11px;padding:10px;color:#58708a;font-size:12px;background:#fbfdff;line-height:1.8}.mc-preview{position:sticky;top:16px;overflow:hidden}.mc-preview-head{background:linear-gradient(135deg,#0866c6,#063f86);padding:24px;color:#fff;text-align:center}.mc-preview-head strong{display:block;font-size:11px;letter-spacing:1px;opacity:.82}.mc-preview-head span{display:block;margin-top:5px;font-size:17px;font-weight:800}.mc-preview-body{padding:24px;background:#fff;min-height:260px;line-height:2;color:#304d67;font-size:16px}.mc-preview-subject{font-size:19px;font-weight:800;color:#103b70;line-height:1.5}.mc-preview-cta{display:inline-block;margin-top:18px;background:#0866c6;color:#fff!important;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:700}.mc-preview-foot{padding:14px 20px;text-align:center;background:#f7fbff;border-top:1px solid #dceafb;color:#7890a8;font-size:10px}.mc-template-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px;margin-top:16px}.mc-template{border:1px solid #dceafb;border-radius:14px;padding:14px;background:#fff;display:flex;flex-direction:column;gap:8px}.mc-template b{font-size:14px;color:#103b70}.mc-template small{font-size:11px;color:#64778c;min-height:31px;line-height:1.55}.mc-template-actions{display:flex;gap:7px;margin-top:auto}.mc-template-actions button{font-size:11px;padding:8px 10px}.mc-empty{border:1px dashed #bdd8ef;border-radius:13px;background:#fbfdff;padding:22px;text-align:center;color:#52677d;font-size:14px;line-height:1.8}.mc-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border-bottom:1px solid #edf4fb;padding:13px 0}.mc-list-row:last-child{border:0}.mc-list-row b{font-size:14px;color:#103b70}.mc-list-row span{display:block;color:#64778c;font-size:11px;margin-top:3px}.mc-badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#eaf4ff;color:#0866c6;font-size:10px;font-weight:700}.mc-table{overflow:auto}.mc-table table{min-width:720px;width:100%;border-collapse:collapse}.mc-table th,.mc-table td{padding:10px 8px;text-align:right;border-bottom:1px solid #e8f1fb;font-size:14px;vertical-align:middle}.mc-table th{background:#f8fbff;color:#52708f}.mc-status{display:inline-block;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:700;background:#edf4fb;color:#52708f}.mc-status.sent{background:#e5f8ef;color:#137b55}.mc-status.scheduled,.mc-status.queued,.mc-status.sending{background:#fff4d9;color:#946500}.mc-status.failed{background:#fff0f1;color:#b02b3a}.mc-divider{height:1px;background:#e7f0fa;margin:17px 0}.mc-helper{font-size:11px;color:#64778c;line-height:1.75;margin:4px 0 0}.mc-file{background:#fbfdff;border:1px dashed #b8d4ec;border-radius:12px;padding:13px}.mc-file input{margin:0}.mc-result{min-height:20px;font-size:12px;line-height:1.75}.mc-danger{background:#fff0f1;color:#b02b3a}@media(max-width:900px){.mc-grid{grid-template-columns:1fr}.mc-preview{position:static}.mc-field-grid{grid-template-columns:1fr}}@media(max-width:560px){.mc-card,.mc-hero{padding:16px}.mc-field-grid{grid-template-columns:1fr}.mc-inline{align-items:stretch}.mc-inline>*{flex-basis:100%}.mc-inline button{flex-basis:auto}.mc-hero h2{font-size:20px}}
    `;
    document.head.append(style);
    tabs.insertAdjacentHTML('beforeend', '<button class="light" type="button" data-view="message-center">مركز الرسائل</button>');
    wrap.insertAdjacentHTML('beforeend', `
      <section id="message-center" class="view">
        <div class="mc-shell">
          <section class="panel mc-hero"><div class="mc-eyebrow">INEXC TRAINING · COMMUNICATIONS</div><h2>مركز الرسائل</h2><p>أنشئ رسائلك بنصك أنت، احفظها كقوالب، أدر قوائم المستلمين، ثم راجع المعاينة وأرسل أو جدوِل بثقة.</p></section>
          <div id="mc-feedback" class="mc-result" role="status" aria-live="polite"></div>
          <div class="mc-tabs" role="tablist"><button class="light active" type="button" data-mc-view="compose">إنشاء وإرسال</button><button class="light" type="button" data-mc-view="templates">القوالب</button><button class="light" type="button" data-mc-view="lists">قوائم المستلمين</button><button class="light" type="button" data-mc-view="reports">سجل الإرسال</button></div>
          <section class="mc-view active" data-mc-panel="compose"><div class="mc-grid"><div class="mc-stack">
            <section class="panel mc-card"><div class="mc-step"><span class="mc-num">1</span><h3>المستلمون</h3></div><p class="mc-muted">اختر شريحة من التسجيلات، قائمة محفوظة، أو اكتب أسماءً وعناوين بنفسك.</p>
              <label>مصدر المستلمين</label><select id="mc-audience"><option value="all">كل المسجلين</option><option value="selected">المحددون من جدول التسجيلات</option><option value="course">المسجلون في دورة</option><option value="unpaid">من لم يكتمل دفعهم</option><option value="list">قائمة محفوظة</option><option value="custom">أسماء وعناوين أكتبها الآن</option></select>
              <div id="mc-course-wrap" hidden><label>اختر الدورة</label><select id="mc-course"></select></div><div id="mc-list-wrap" hidden><label>اختر القائمة</label><select id="mc-list"></select></div>
              <div id="mc-custom-wrap" hidden><label>أسماء وعناوين خارجية</label><textarea id="mc-recipients" placeholder="الاسم، name@example.com&#10;name2@example.com&#10;يمكن كتابة الاسم وحده لحفظه في القائمة، لكن لا يمكن إرسال بريد له قبل إضافة عنوانه."></textarea><div class="mc-inline"><input id="mc-manual-list-name" maxlength="120" placeholder="اسم لحفظ هذه القائمة (اختياري)"><button id="mc-save-manual-list" class="light" type="button">حفظ كقائمة</button></div></div>
              <div class="mc-divider"></div><div class="mc-file"><b style="font-size:13px;color:#103b70">استخراج البريد من ملف</b><p class="mc-helper" id="mc-import-help">اختر الملف بأي امتداد؛ نستخرج البريد من Excel وWord وPDF والصور والنصوص مثل CSV وTXT وJSON. لا يلزم ترتيب محدد للأعمدة، وتُزال العناوين المكررة. تُحفظ الأسماء إن وُجد عمود لها. حتى 3000 جهة و5MB. راجع العناوين المستخرجة من الصور قبل الإرسال.</p><div class="mc-inline"><input id="mc-import-name" maxlength="120" placeholder="اسم القائمة" aria-label="اسم القائمة المستوردة"><input id="mc-import-file" type="file" aria-label="ملف استخراج البريد" aria-describedby="mc-import-help"><button id="mc-import-list" class="light" type="button">رفع واستخراج البريد</button></div></div>
              <div id="mc-recipient-info" class="mc-recipient-info">اختر شريحة ثم اضغط «فحص المستلمين» قبل الإرسال.</div><button id="mc-check-recipients" class="light" type="button" style="margin-top:10px">فحص المستلمين</button>
            </section>
            <section class="panel mc-card"><div class="mc-step"><span class="mc-num">2</span><h3>نص رسالتك</h3></div><p class="mc-muted">القالب يملأ الحقول فقط؛ يمكنك دائمًا الكتابة والتعديل بحرية قبل الإرسال.</p>
              <label>بدء من قالب محفوظ</label><select id="mc-template-select"><option value="">رسالة مخصصة من الصفر</option></select><label>عنوان الرسالة</label><input id="mc-subject" maxlength="160" placeholder="اكتب عنوان رسالتك"><label>نص الرسالة</label><textarea id="mc-body" maxlength="5000" placeholder="اكتب رسالتك هنا كما تريد أن تصل للمستلمين."></textarea><button id="mc-save-as-template" class="light" type="button">حفظ النص الحالي كقالب</button>
              <div class="mc-variables"><button class="mc-variable" type="button" data-variable="{{name}}">اسم المستلم</button><button class="mc-variable" type="button" data-variable="{{email}}">بريد المستلم</button><button class="mc-variable" type="button" data-variable="{{course}}">اسم الدورة</button></div><p class="mc-helper">تُستبدل المتغيرات تلقائيًا عند الإرسال. لا تحتاج إلى استخدامها إن لم ترغب.</p>
              <div class="mc-field-grid"><div><label>نص زر اختياري</label><input id="mc-cta-label" maxlength="80" placeholder="مثال: عرض التفاصيل"></div><div><label>رابط الزر الاختياري</label><input id="mc-cta-url" dir="ltr" maxlength="600" placeholder="https://..."></div></div>
              <label>مرفق اختياري</label><input id="mc-attachment" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif"><p id="mc-attachment-info" class="mc-helper">حتى 10MB. يمنع النظام الملفات التنفيذية وغير الآمنة.</p>
              <label>موعد الإرسال</label><input id="mc-schedule" type="datetime-local"><p class="mc-helper">اتركه فارغًا للإرسال الآن. الموعد محفوظ في سجل الرسائل ويمكن متابعته.</p>
            </section>
            <section class="panel mc-card"><div class="mc-step"><span class="mc-num">3</span><h3>راجع ثم أرسل</h3></div><div class="mc-field-grid"><div><label>بريد تجربة</label><input id="mc-test-email" type="email" autocomplete="off" placeholder="اكتب بريد التجربة بنفسك" style="direction:ltr;text-align:left"></div><div><label>اسم التجربة (اختياري)</label><input id="mc-test-name" maxlength="160" placeholder="الاسم الظاهر في المعاينة"></div></div><div class="mc-inline" style="margin-top:12px"><button id="mc-send-test" class="light" type="button">إرسال تجربة</button><button id="mc-send" class="primary" type="button">إرسال الرسالة الآن</button></div><div id="mc-result" class="mc-result" aria-live="polite"></div></section>
          </div><aside class="panel mc-preview"><div class="mc-preview-head"><strong>INEXC TRAINING</strong><span>شركة التميز الابتكاري</span></div><div class="mc-preview-body"><div id="mc-preview-subject" class="mc-preview-subject">عنوان الرسالة</div><p id="mc-preview-greeting">مرحبًا،</p><div id="mc-preview-body">سيظهر نص رسالتك هنا قبل أن ترسله.</div><a id="mc-preview-cta" class="mc-preview-cta" hidden target="_blank" rel="noopener">زر الإجراء</a></div><div class="mc-preview-foot">يتضمن البريد رابط إلغاء الاشتراك لحماية اختيار المستلم.</div></aside></div></section>
          <section class="mc-view" data-mc-panel="templates"><div class="mc-grid"><section class="panel mc-card"><h3 id="mc-template-title">حفظ قالب جديد</h3><p class="mc-muted">احفظ النص الذي تكتبه أنت، ثم استدعه في أي رسالة لاحقة.</p><input id="mc-template-id" type="hidden"><label>اسم القالب</label><input id="mc-template-name" maxlength="120" placeholder="مثال: دعوة حضور"><label>عنوان الرسالة</label><input id="mc-template-subject" maxlength="160" placeholder="عنوان القالب"><label>نص الرسالة</label><textarea id="mc-template-body" maxlength="5000" placeholder="نصك أنت…"></textarea><div class="mc-field-grid"><div><label>نص الزر</label><input id="mc-template-cta-label" maxlength="80" placeholder="اختياري"></div><div><label>رابط الزر</label><input id="mc-template-cta-url" dir="ltr" maxlength="600" placeholder="https://..."></div></div><div class="mc-inline" style="margin-top:12px"><button id="mc-template-save" class="primary" type="button">حفظ القالب</button><button id="mc-template-clear" class="light" type="button">قالب جديد</button></div><div id="mc-template-result" class="mc-result"></div></section><section class="panel mc-card"><h3>قوالبك المحفوظة</h3><p class="mc-muted">لا ننشئ نصوصًا باسمك؛ تظهر هنا فقط القوالب التي تحفظها.</p><div id="mc-template-list" class="mc-template-list"></div></section></div></section>
          <section class="mc-view" data-mc-panel="lists"><section class="panel mc-card"><div class="mc-inline"><div><h3>قوائم المستلمين</h3><p class="mc-muted">الأسماء بلا بريد تُحفظ للمراجعة، لكنها لا تدخل الإرسال إلى أن تضيف بريدًا صالحًا.</p></div><button id="mc-reload-lists" class="light" type="button">تحديث القوائم</button></div><div id="mc-lists" style="margin-top:10px"></div><div id="mc-list-detail" hidden class="mc-divider"></div></section></section>
          <section class="mc-view" data-mc-panel="reports"><section class="panel mc-card"><div class="mc-inline"><div><h3>سجل الإرسال</h3><p class="mc-muted">تابع الرسائل الفورية والمجدولة وحالات الوصول والفتح والنقر عند ورودها من مزود البريد.</p></div><button id="mc-reload-reports" class="light" type="button">تحديث السجل</button></div><div id="mc-reports" class="mc-table" style="margin-top:12px"></div><div id="mc-report-details" class="mc-table"></div></section></section>
        </div>
      </section>`);

    const editors = { body: createMessageEditor($('#mc-body')), template: createMessageEditor($('#mc-template-body')) };
    ['mc-subject','mc-template-subject'].forEach(id => { $('#'+id).dir = 'auto'; $('#'+id).style.textAlign = 'start'; });
    const showMain = () => {
      document.querySelectorAll('.tabs button,.view').forEach(node => node.classList.remove('active'));
      tabs.querySelector('[data-view="message-center"]').classList.add('active');
      $('#message-center').classList.add('active');
      loadAll();
    };
    tabs.querySelector('[data-view="message-center"]').onclick = showMain;
    const showSub = name => {
      document.querySelectorAll('[data-mc-view],[data-mc-panel]').forEach(node => node.classList.toggle('active', node.dataset.mcView === name || node.dataset.mcPanel === name));
      if (name === 'templates') loadTemplates();
      if (name === 'lists') loadLists();
      if (name === 'reports') loadReports();
    };
    document.querySelectorAll('[data-mc-view]').forEach(button => button.onclick = () => showSub(button.dataset.mcView));

    document.querySelectorAll('[data-variable]').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => editors.body.insertText(button.dataset.variable); });
    ['mc-subject','mc-body','mc-cta-label','mc-cta-url','mc-test-name','mc-test-email'].forEach(id => $('#'+id).addEventListener('input', refreshPreview));
    function refreshPreview() {
      const sample = { name: $('#mc-test-name').value.trim() || 'اسم المستلم', email: $('#mc-test-email').value.trim() || 'name@example.com', course: $('#mc-course').value ? $('#mc-course option:checked').textContent : 'اسم الدورة' };
      const subject = merge($('#mc-subject').value.trim(), sample) || 'عنوان الرسالة';
      const body = renderMessageBody($('#mc-body').value.trim() || 'سيظهر نص رسالتك هنا قبل أن ترسله.', sample);
      const label = merge($('#mc-cta-label').value.trim(), sample), url = merge($('#mc-cta-url').value.trim(), sample);
      $('#mc-preview-subject').textContent = subject;
      const preview = $('#mc-preview-body').parentElement;
      preview.dir = body.direction; preview.style.direction = body.direction; preview.style.textAlign = body.direction === 'rtl' ? 'right' : 'left';
      $('#mc-preview-subject').dir = messageDirection(subject, body.direction); $('#mc-preview-subject').style.textAlign = $('#mc-preview-subject').dir === 'rtl' ? 'right' : 'left';
      $('#mc-preview-greeting').textContent = body.direction === 'rtl' ? (sample.name ? `مرحبًا ${sample.name}،` : 'مرحبًا،') : (sample.name === 'اسم المستلم' ? 'Hello,' : `Hello ${sample.name},`);
      $('#mc-preview-body').style.whiteSpace = 'normal'; $('#mc-preview-body').innerHTML = body.html;
      $('#mc-preview-cta').hidden = !(label && /^https?:\/\//i.test(url));
      $('#mc-preview-cta').textContent = label || 'زر الإجراء';
      $('#mc-preview-cta').href = url || '#';
    }
    function audiencePayload() {
      const audience = $('#mc-audience').value;
      return { audience, courseId: audience === 'course' ? $('#mc-course').value : '', listId: $('#mc-list').value, recipientRows: audience === 'custom' ? localRows($('#mc-recipients').value) : [], ids: audience === 'selected' ? [...document.querySelectorAll('.pick:checked')].map(input => input.dataset.id) : [] };
    }
    async function loadTemplates() {
      try { state.templates = await call('/admin/message-templates'); renderTemplates(); }
      catch (error) { $('#mc-template-list').innerHTML = `<div class="mc-empty">${escape(error.message)}</div>`; }
    }
    function renderTemplateSelect() {
      const selected = $('#mc-template-select').value;
      $('#mc-template-select').innerHTML = '<option value="">رسالة مخصصة من الصفر</option>' + state.templates.map(template => `<option value="${template.id}">${escape(template.name)}</option>`).join('');
      if (state.templates.some(template => template.id === selected)) $('#mc-template-select').value = selected;
    }
    function renderTemplates() {
      renderTemplateSelect();
      $('#mc-template-list').innerHTML = state.templates.length ? state.templates.map(template => `<article class="mc-template"><b>${escape(template.name)}</b><small>${escape(template.subject || 'بدون عنوان')}<br>${escape((template.body || '').slice(0, 85)) || 'نص القالب فارغ حتى الآن.'}</small><div class="mc-template-actions"><button class="light" type="button" data-template-use="${template.id}">استخدام</button><button class="light" type="button" data-template-edit="${template.id}">تعديل</button><button class="mc-danger" type="button" data-template-delete="${template.id}">حذف</button></div></article>`).join('') : '<div class="mc-empty">لم تحفظ أي قالب بعد. اكتب نصك ثم احفظه من النموذج المجاور.</div>';
      document.querySelectorAll('[data-template-use]').forEach(button => button.onclick = () => applyTemplate(button.dataset.templateUse));
      document.querySelectorAll('[data-template-edit]').forEach(button => button.onclick = () => editTemplate(button.dataset.templateEdit));
      document.querySelectorAll('[data-template-delete]').forEach(button => button.onclick = () => deleteTemplate(button.dataset.templateDelete));
    }
    function applyTemplate(id) {
      const template = state.templates.find(item => item.id === id); if (!template) return;
      $('#mc-template-select').value = id; $('#mc-subject').value = template.subject; $('#mc-body').value = template.body; $('#mc-cta-label').value = template.cta_label; $('#mc-cta-url').value = template.cta_url; refreshPreview(); showSub('compose');
    }
    function editTemplate(id) {
      const template = state.templates.find(item => item.id === id); if (!template) return;
      $('#mc-template-id').value = id; $('#mc-template-name').value = template.name; $('#mc-template-subject').value = template.subject; $('#mc-template-body').value = template.body; $('#mc-template-cta-label').value = template.cta_label; $('#mc-template-cta-url').value = template.cta_url; $('#mc-template-title').textContent = `تعديل قالب: ${template.name}`; showSub('templates');
    }
    function clearTemplateForm() {
      ['mc-template-id','mc-template-name','mc-template-subject','mc-template-body','mc-template-cta-label','mc-template-cta-url'].forEach(id => $('#'+id).value = ''); $('#mc-template-title').textContent = 'حفظ قالب جديد'; $('#mc-template-result').textContent = '';
    }
    async function deleteTemplate(id) {
      const template = state.templates.find(item => item.id === id); if (!template || !confirm(`حذف قالب «${template.name}»؟`)) return;
      try { await call('/admin/message-templates/'+id, { method:'DELETE' }); await loadTemplates(); }
      catch (error) { notify(error.message); }
    }
    async function loadLists() {
      try { state.lists = await call('/admin/message-lists'); renderLists(); }
      catch (error) { $('#mc-lists').innerHTML = `<div class="mc-empty">${escape(error.message)}</div>`; }
    }
    function renderListSelect() {
      const selected = $('#mc-list').value;
      $('#mc-list').innerHTML = '<option value="">اختر قائمة</option>' + state.lists.map(list => `<option value="${list.id}">${escape(list.name)} — ${list.with_email}/${list.total} عنوان صالح</option>`).join('');
      if (state.lists.some(list => list.id === selected)) $('#mc-list').value = selected;
    }
    function renderLists() {
      renderListSelect();
      $('#mc-lists').innerHTML = state.lists.length ? state.lists.map(list => `<div class="mc-list-row"><div><b>${escape(list.name)}</b><span>${Number(list.total).toLocaleString('ar-AE')} جهة · ${Number(list.with_email).toLocaleString('ar-AE')} بريد جاهز للإرسال</span></div><div class="mc-inline" style="justify-content:flex-end"><span class="mc-badge">${new Date(list.created_at).toLocaleDateString('ar-AE')}</span><button class="light" type="button" data-list-review="${list.id}">مراجعة</button><button class="mc-danger" type="button" data-list-delete="${list.id}">حذف</button></div></div>`).join('') : '<div class="mc-empty">لا توجد قوائم محفوظة بعد. ارفع ملفًا أو احفظ الأسماء التي تكتبها بنفسك.</div>';
      document.querySelectorAll('[data-list-delete]').forEach(button => button.onclick = () => deleteList(button.dataset.listDelete));
      document.querySelectorAll('[data-list-review]').forEach(button => button.onclick = () => reviewList(button.dataset.listReview));
    }
    async function reviewList(id, page = 0) {
      const list = state.lists.find(item => item.id === id), target = $('#mc-list-detail'); if (!list) return;
      target.hidden = false; target.className = ''; target.innerHTML = '<div class="mc-divider"></div><div class="mc-muted">جارٍ تحميل جهات القائمة…</div>';
      try {
        const contacts = await call('/admin/message-lists/'+id+'/contacts?page='+page);
        target.innerHTML = `<div class="mc-divider"></div><h3 style="margin:0 0 5px;color:#103b70;font-size:16px">مراجعة قائمة: ${escape(list.name)}</h3><p class="mc-muted">أضف البريد الناقص بجانب الاسم ثم اضغط حفظ. الصفحة ${page+1} من ${Math.max(1,Math.ceil(list.total/100))}.</p><div class="mc-table"><table><thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th></th></tr></thead><tbody>${contacts.map(contact => `<tr data-contact-row="${contact.id}"><td><input data-contact-name value="${escape(contact.full_name)}" maxlength="160" placeholder="الاسم"></td><td><input data-contact-email dir="ltr" value="${escape(contact.email)}" maxlength="180" placeholder="name@example.com"></td><td><button class="light" type="button" data-contact-save="${contact.id}">حفظ</button></td></tr>`).join('')}</tbody></table></div>`;
        target.insertAdjacentHTML('beforeend', `<div class="mc-inline" style="margin-top:12px"><button class="light" type="button" id="mc-prev-contacts" ${page===0?'disabled':''}>الصفحة السابقة</button><button class="light" type="button" id="mc-next-contacts" ${(page+1)*100>=list.total?'disabled':''}>الصفحة التالية</button></div>`);
        $('#mc-prev-contacts').onclick = () => reviewList(id,page-1); $('#mc-next-contacts').onclick = () => reviewList(id,page+1);
        document.querySelectorAll('[data-contact-save]').forEach(button => button.onclick = () => saveContact(button));
      } catch (error) { target.innerHTML = `<div class="mc-divider"></div><div class="mc-empty">${escape(error.message)}</div>`; }
    }
    async function saveContact(button) {
      const row = button.closest('[data-contact-row]'), id = button.dataset.contactSave;
      setBusy(button, true, 'جارٍ الحفظ…');
      try { await call('/admin/message-contacts/'+id, { method:'PUT', body:JSON.stringify({ name: row.querySelector('[data-contact-name]').value.trim(), email: row.querySelector('[data-contact-email]').value.trim() }) }); await loadLists(); notify('تم تحديث جهة الاتصال.', true); }
      catch (error) { notify(error.message); } finally { setBusy(button, false); }
    }
    async function deleteList(id) {
      const list = state.lists.find(item => item.id === id); if (!list || !confirm(`حذف قائمة «${list.name}»؟ لن يحذف ذلك بيانات المسجلين.`)) return;
      try { await call('/admin/message-lists/'+id, { method:'DELETE' }); await loadLists(); }
      catch (error) { notify(error.message); }
    }
    async function loadCourses() {
      try { state.courses = await call('/admin/courses'); $('#mc-course').innerHTML = '<option value="">اختر الدورة</option>' + state.courses.map(course => `<option value="${course.id}">${escape(course.name)}</option>`).join(''); refreshPreview(); }
      catch (_error) { $('#mc-course').innerHTML = '<option value="">تعذر تحميل الدورات</option>'; }
    }
    async function loadReports() {
      const target = $('#mc-reports'); target.innerHTML = '<div class="mc-empty">جارٍ تحميل السجل…</div>';
      try {
        const rows = await call('/admin/campaigns');
        target.innerHTML = rows.length ? `<table><thead><tr><th>العنوان</th><th>الحالة</th><th>الموعد / الإرسال</th><th>العدد</th><th>مقبولة لدى المزود</th><th>تم التسليم</th><th>فُتح</th><th>فشل</th><th></th></tr></thead><tbody>${rows.map(row => { const status = row.status || 'sent'; const when = row.status === 'scheduled' && row.scheduled_at ? `مجدول: ${new Date(row.scheduled_at).toLocaleString('ar-AE')}` : new Date(row.sent_at || row.created_at).toLocaleString('ar-AE'); const action = status === 'scheduled' ? `<button class="mc-danger" type="button" data-campaign-cancel="${row.id}">إلغاء الجدولة</button>` : '—'; return `<tr><td>${escape(row.subject)}</td><td><span class="mc-status ${escape(status)}">${({sent:'مقبولة لدى المزود',partial:'إرسال جزئي',scheduled:'مجدول',queued:'بانتظار الإرسال',sending:'جارٍ الإرسال',failed:'تعذر الإرسال',cancelled:'أُلغي'}[status] || escape(status))}</span></td><td>${escape(when)}</td><td>${Number(row.total || row.total_recipients || 0)}</td><td>${Number(row.sent || 0)}</td><td>${Number(row.delivered || 0)}</td><td>${Number(row.opened || 0)}</td><td>${Number(row.failed || 0)}</td><td><button class="light" type="button" data-campaign-details="${row.id}">التفاصيل</button> ${action}</td></tr>`; }).join('')}</tbody></table>` : '<div class="mc-empty">لا توجد رسائل مرسلة أو مجدولة حتى الآن.</div>';
        document.querySelectorAll('[data-campaign-details]').forEach(button => button.onclick = async () => {
          const target = $('#mc-report-details');
          try { const deliveries = await call('/admin/campaigns/'+button.dataset.campaignDetails); target.innerHTML = '<h3 style="margin-top:24px">تفاصيل المستلمين</h3><table><thead><tr><th>الاسم</th><th>البريد</th><th>الحالة / سبب التعثر</th></tr></thead><tbody>'+deliveries.map(item => `<tr><td>${escape(item.recipient_name)}</td><td dir="ltr">${escape(item.email)}</td><td>${escape(item.error || ({queued:'بانتظار الإرسال',sent:'مقبولة لدى المزود',delivered:'وصل',opened:'فُتح',clicked:'نُقر',failed:'تعذر الإرسال',skipped:'مستبعد',cancelled:'أُلغي',bounced:'ارتد البريد',complained:'شكوى'}[item.status] || item.status))}</td></tr>`).join('')+'</tbody></table>'; } catch(error) { notify(error.message); }
        });
        document.querySelectorAll('[data-campaign-cancel]').forEach(button => button.onclick = async () => { if (!confirm('إلغاء هذه الرسالة المجدولة؟')) return; setBusy(button, true, 'جارٍ الإلغاء…'); try { await call('/admin/campaigns/'+button.dataset.campaignCancel+'/cancel', { method:'POST' }); await loadReports(); notify('تم إلغاء جدولة الرسالة.', true); } catch (error) { notify(error.message); } finally { setBusy(button, false); } });
      } catch (error) { target.innerHTML = `<div class="mc-empty">${escape(error.message)}</div>`; }
    }
    async function loadAll() {
      state.ready = false;
      const actions = ['mc-send','mc-send-test','mc-template-save','mc-save-manual-list','mc-import-list'];
      actions.forEach(id => $('#'+id).disabled = true);
      try {
        const templates = await call('/admin/message-templates');
        if (!Array.isArray(templates)) throw Error('استجابة الخدمة غير صالحة.');
        state.templates = templates; state.ready = true; renderTemplates();
        state.richTextReady = await call('/admin/message-capabilities').then(data => data.richText >= 1).catch(() => false);
        actions.forEach(id => $('#'+id).disabled = false);
        ['mc-send','mc-send-test','mc-template-save'].forEach(id => $('#'+id).disabled = !state.richTextReady);
        notify(state.richTextReady ? '' : 'يمكنك تجهيز النص ومعاينته. حدّث خدمة الرسائل على الخادم لتفعيل حفظ التنسيق والإرسال.');
        await Promise.all([loadLists(), loadCourses()]);
      } catch (error) { notify('مركز الرسائل ينتظر إكمال تحديث الخدمة على الخادم. '+error.message); }
    }
    function toggleAudience() { const choice = $('#mc-audience').value; $('#mc-course-wrap').hidden = choice !== 'course'; $('#mc-list-wrap').hidden = choice !== 'list'; $('#mc-custom-wrap').hidden = choice !== 'custom'; $('#mc-recipient-info').textContent = choice === 'selected' ? 'حدّد الأسماء من جدول التسجيلات أولًا، ثم ارجع إلى مركز الرسائل لفحصها.' : 'اضغط «فحص المستلمين» لتعرف العدد الفعلي قبل الإرسال.'; refreshPreview(); }
    async function checkRecipients() {
      const button = $('#mc-check-recipients'); setBusy(button, true, 'جارٍ الفحص…');
      try { const result = await call('/admin/messages/preview-recipients', { method:'POST', body:JSON.stringify(audiencePayload()) }); $('#mc-recipient-info').textContent = `المستلمون الجاهزون: ${result.ready} من أصل ${result.total}. ${result.skippedUnsubscribed ? `تم استبعاد ${result.skippedUnsubscribed} ممن ألغوا اشتراكهم.` : ''}`; notify('تم فحص المستلمين بنجاح.', true); }
      catch (error) { $('#mc-recipient-info').textContent = error.message; notify(error.message); }
      finally { setBusy(button, false); }
    }
    async function saveManualList() {
      const button = $('#mc-save-manual-list'), name = $('#mc-manual-list-name').value.trim(), rows = localRows($('#mc-recipients').value);
      if (!name || !rows.length) return notify('اكتب اسم القائمة وأضف اسمًا أو عنوانًا واحدًا على الأقل.');
      setBusy(button, true, 'جارٍ الحفظ…');
      try { const list = await call('/admin/message-lists', { method:'POST', body:JSON.stringify({ name, rows }) }); await loadLists(); $('#mc-list').value = list.id; $('#mc-audience').value = 'list'; toggleAudience(); notify(`تم حفظ القائمة: ${list.name}.`, true); }
      catch (error) { notify(error.message); } finally { setBusy(button, false); }
    }
    async function importList() {
      const button = $('#mc-import-list'), name = $('#mc-import-name').value.trim(), file = $('#mc-import-file').files[0];
      if (!name || !file) return notify('اكتب اسم القائمة واختر ملفًا أولًا.');
      if (file.size > 5 * 1024 * 1024) return notify('حجم الملف يتجاوز 5MB. قسّمه إلى ملفات أصغر.');
      if (!file.size) return notify('الملف فارغ. اختر ملفًا يحتوي على عناوين البريد.');
      notify('جارٍ قراءة الملف واستخراج البريد. قد تستغرق الصور وملفات PDF المصوّرة وقتًا أطول.', true);
      setBusy(button, true, 'جارٍ الاستخراج…');
      try { const data = new FormData(); data.append('name', name); data.append('file', file); const list = await call('/admin/message-lists/import-file', { method:'POST', body:data }); await loadLists(); $('#mc-list').value = list.id; $('#mc-audience').value = 'list'; toggleAudience(); $('#mc-import-file').value = ''; $('#mc-import-name').value = ''; notify(`تم حفظ ${list.imported} جهة في «${list.name}»، منها ${list.withEmail} عنوان بريد${list.needsEmail ? ` و${list.needsEmail} اسم يحتاج بريدًا.` : ''}`, true); }
      catch (error) { notify(error.message); } finally { setBusy(button, false); }
    }
    async function uploadAttachment() {
      const file = $('#mc-attachment').files[0];
      if (!file) return '';
      if (file.size > 10 * 1024 * 1024) throw Error('حجم المرفق يتجاوز 10MB.');
      if (state.uploadedAttachment && state.attachmentFile === file) return state.uploadedAttachment;
      $('#mc-attachment-info').textContent = 'جارٍ تجهيز المرفق…';
      const data = new FormData(); data.append('file', file); const saved = await call('/admin/message-attachments', { method:'POST', body:data }); state.uploadedAttachment = saved.attachmentPath; state.attachmentFile = file; $('#mc-attachment-info').dataset.file = file.name; $('#mc-attachment-info').textContent = `تم تجهيز المرفق: ${saved.fileName}`; return state.uploadedAttachment;
    }
    function messagePayload() {
      const schedule = $('#mc-schedule').value;
      return { ...audiencePayload(), subject: $('#mc-subject').value.trim(), message: $('#mc-body').value.trim(), ctaLabel: $('#mc-cta-label').value.trim(), ctaUrl: $('#mc-cta-url').value.trim(), templateId: $('#mc-template-select').value || null, attachmentPath: state.uploadedAttachment || '', scheduledAt: schedule ? new Date(schedule).toISOString() : '' };
    }
    async function sendTest() {
      const button = $('#mc-send-test'), payload = messagePayload();
      if (!$('#mc-test-email').value.trim()) return notify('اكتب بريد التجربة بنفسك أولًا.');
      setBusy(button, true, 'جارٍ إرسال التجربة…');
      try { await call('/admin/messages/test', { method:'POST', body:JSON.stringify({ email: $('#mc-test-email').value.trim(), name: $('#mc-test-name').value.trim(), subject: payload.subject, message: payload.message, ctaLabel: payload.ctaLabel, ctaUrl: payload.ctaUrl, courseName: $('#mc-course').value ? $('#mc-course option:checked').textContent : '' }) }); notify('أُرسلت رسالة تجريبية إلى البريد الذي كتبته.', true); }
      catch (error) { notify(error.message); } finally { setBusy(button, false); }
    }
    async function sendMessage() {
      const button = $('#mc-send'), payload = messagePayload();
      const fingerprint=JSON.stringify(payload);
      if(state.submitFingerprint!==fingerprint){state.submitFingerprint=fingerprint;state.submitKey=crypto.randomUUID();}
      payload.requestId=state.submitKey;
      if (!payload.subject || !payload.message) return notify('اكتب عنوان الرسالة ونصها أولًا.');
      setBusy(button, true, 'جارٍ تجهيز الرسالة…');
      try {
        const preview = await call('/admin/messages/preview-recipients', { method:'POST', body:JSON.stringify(audiencePayload()) });
        if (!preview.ready) throw Error('لا يوجد مستلم جاهز للإرسال.');
        const scheduleText = payload.scheduledAt ? `جدولة الإرسال إلى ${preview.ready} مستلمًا في الموعد المحدد؟` : `إرسال رسالتك الآن إلى ${preview.ready} مستلمًا؟`;
        if (!confirm(scheduleText)) return;
        payload.attachmentPath = await uploadAttachment();
        button.textContent = payload.scheduledAt ? 'جارٍ حفظ الجدولة…' : 'جارٍ الإرسال…';
        const result = await call('/admin/messages', { method:'POST', body:JSON.stringify(payload) });
        notify(result.status === 'scheduled' ? `تمت جدولة الرسالة لـ ${result.total} مستلمًا.` : `تم حفظ الرسالة في قائمة الإرسال لـ ${result.total} مستلمًا. تابع التقدم في سجل الإرسال.`, true);
        $('#mc-attachment').value = ''; state.uploadedAttachment = ''; $('#mc-attachment-info').textContent = 'حتى 10MB. يمنع النظام الملفات التنفيذية وغير الآمنة.'; loadReports();
      } catch (error) { notify(error.message); } finally { setBusy(button, false); }
    }

    $('#mc-audience').onchange = toggleAudience; $('#mc-course').onchange = refreshPreview;
    $('#mc-check-recipients').onclick = checkRecipients; $('#mc-save-manual-list').onclick = saveManualList; $('#mc-import-list').onclick = importList;
    $('#mc-send-test').onclick = sendTest; $('#mc-send').onclick = sendMessage; $('#mc-reload-lists').onclick = loadLists; $('#mc-reload-reports').onclick = loadReports;
    $('#mc-template-select').onchange = event => { if (event.target.value) applyTemplate(event.target.value); };
    $('#mc-save-as-template').onclick = () => { clearTemplateForm(); $('#mc-template-subject').value = $('#mc-subject').value; $('#mc-template-body').value = $('#mc-body').value; $('#mc-template-cta-label').value = $('#mc-cta-label').value; $('#mc-template-cta-url').value = $('#mc-cta-url').value; showSub('templates'); $('#mc-template-name').focus(); };
    $('#mc-template-clear').onclick = clearTemplateForm;
    $('#mc-template-save').onclick = async () => {
      const button = $('#mc-template-save'), id = $('#mc-template-id').value, payload = { name: $('#mc-template-name').value.trim(), subject: $('#mc-template-subject').value.trim(), body: $('#mc-template-body').value.trim(), ctaLabel: $('#mc-template-cta-label').value.trim(), ctaUrl: $('#mc-template-cta-url').value.trim() };
      setBusy(button, true, 'جارٍ الحفظ…');
      try { await call('/admin/message-templates'+(id ? '/'+id : ''), { method: id ? 'PUT' : 'POST', body:JSON.stringify(payload) }); clearTemplateForm(); await loadTemplates(); $('#mc-template-result').style.color = '#137b55'; $('#mc-template-result').textContent = 'تم حفظ القالب.'; }
      catch (error) { $('#mc-template-result').style.color = '#b02b3a'; $('#mc-template-result').textContent = error.message; } finally { setBusy(button, false); }
    };
    $('#mc-attachment').onchange = () => { state.uploadedAttachment = ''; state.attachmentFile = null; $('#mc-attachment-info').textContent = 'حتى 10MB. اختر PDF أو مستندًا أو صورة.'; };
    $('#mc-schedule').onchange = () => { $('#mc-send').textContent = $('#mc-schedule').value ? 'حفظ وجدولة الرسالة' : 'إرسال الرسالة الآن'; };
    document.querySelectorAll('#message-center label').forEach(label => { const field = label.nextElementSibling; if (field?.id && /^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName)) label.htmlFor = field.id; });
    toggleAudience(); refreshPreview();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
