/* إدارة تنبيهات الدورات — ملف مستقل للحفاظ على نظافة صفحة الإدارة. */
const inexcCourseAlertsStyle = document.createElement('style');
inexcCourseAlertsStyle.textContent = "\n#course-alerts .alerts-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}\n#course-alerts .alerts-count{font-size:13px;color:#52708f}#course-alerts .alerts-count b{font-size:24px;color:#0866c6;margin-left:5px}\n#course-alerts .alert-table{overflow:auto}.alert-table table{width:100%;border-collapse:collapse;min-width:620px}.alert-table th,.alert-table td{padding:12px 10px;text-align:right;border-bottom:1px solid #e8f1fb;font-size:11px}.alert-table th{background:#f8fbff;color:#52708f}.alert-state{font-weight:700;font-size:10px}.alert-state.active{color:#168865}.alert-state.off{color:#a16b16}\n";
document.head.appendChild(inexcCourseAlertsStyle);

(() => {
  const tab = document.querySelector('[data-view="course-alerts"]');
  const wrap = document.querySelector('.wrap');
  if (!tab || !wrap || document.getElementById('course-alerts')) return;
  const section = document.createElement('section');
  section.id = 'course-alerts';
  section.className = 'view';
  section.innerHTML = '<div class="panel" style="padding:22px"><div class="alerts-summary"><div><h2 style="margin:0;color:#103b70;font-size:20px">تنبيهات الدورات الجديدة</h2><p class="note" style="margin:5px 0 0">تحكم كامل في الإرسال الآلي للدورات الجديدة، دون التأثير في التسجيلات أو الدورات الحالية.</p></div><div class="alerts-count"><b id="alertsCount">0</b>مشترك</div></div><form id="alertSettingsForm" class="note" style="display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin:0 0 12px"><label class="check" style="margin:0"><input id="alertsEnabled" type="checkbox"> تفعيل الإرسال التلقائي</label><label style="margin:0">وقت الإرسال<select id="alertDelay" style="width:auto;margin:4px 0 0"><option value="0">فور النشر</option><option value="60">بعد ساعة</option><option value="180">بعد 3 ساعات</option><option value="1440">بعد 24 ساعة</option></select></label><label style="margin:0">طريقة الإرسال<select id="alertDeliveryMode" style="width:auto;margin:4px 0 0"><option value="auto">تلقائي</option><option value="manual">يدوي على دفعات</option></select></label><label style="margin:0">عدد كل دفعة<select id="alertBatchSize" style="width:auto;margin:4px 0 0"><option value="100">100</option><option value="200">200</option><option value="300">300</option><option value="400">400</option><option value="500">500</option></select></label><button class="primary" type="submit">حفظ الإعداد</button><span id="alertSettingsResult" style="font-size:10px"></span><label style="width:100%;margin:0">عنوان الرسالة<input id="alertSubject" maxlength="220" style="margin:4px 0 0" placeholder="دورة جديدة: {course_name} | INEXC Training"></label><label style="width:100%;margin:0">محتوى الرسالة<textarea id="alertMessage" maxlength="4000" style="min-height:150px;margin:4px 0 0"></textarea></label><small style="width:100%">استخدم: {course_name} {course_description} {course_date} {course_location} {course_hours}. زر رابط الدورة وإلغاء الاشتراك يضافان تلقائيًا.</small><small style="width:100%">عند التعطيل، تتوقف الرسائل المؤجلة ولا يتم إنشاء تنبيهات جديدة حتى تعيد التفعيل.</small></form><form id="alertReleaseForm" class="note" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 12px"><b style="color:#103b70">إرسال الدفعة التالية</b><span>في الوضع اليدوي فقط</span><button class="primary" type="submit">إرسال العدد المختار الآن</button><span id="alertReleaseResult" style="font-size:10px"></span><small style="width:100%">لن يرسل النظام إلا العناوين التي انتهى وقت انتظارها، ولن يعيد إرسال أي بريد وصلته الرسالة.</small></form><form id="alertTestForm" class="note" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 12px"><b style="color:#103b70">إرسال تجريبي</b><input id="alertTestEmail" type="email" required placeholder="ضع بريدك لمعاينة الرسالة" style="width:min(300px,100%);margin:0"><button class="light" type="submit">أرسل معاينة</button><span id="alertTestResult" style="font-size:10px"></span><details style="width:100%"><summary style="cursor:pointer;color:#0866c6;font-weight:700">معاينة محتوى الرسالة</summary><div style="margin-top:8px;background:#fff;border:1px solid #dcecff;border-radius:10px;padding:12px"><b style="color:#103b70">دورة جديدة بانتظارك</b><p style="margin:5px 0;color:#64778c">عنوان الدورة ووصفها المختصر وزر مباشر لاستعراض الدورة والتسجيل فيها.</p></div></details></form><form id="alertImportForm" class="note" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 14px"><b style="color:#103b70">إضافة إيميلات من ملف</b><input id="alertImportFile" type="file" accept=".csv,.txt,.xlsx" required style="width:auto;max-width:100%;margin:0"><button class="primary" type="submit">رفع وإضافة</button><span id="alertImportResult" style="font-size:10px"></span><small style="width:100%">الصيغ المدعومة: CSV أو TXT أو Excel بصيغة XLSX. تُضاف العناوين الجديدة فقط، ويحترم النظام من ألغى اشتراكه.</small></form><div id="alertsTable" class="alert-table"><p class="note">اضغط «تنبيهات الدورات» لعرض القائمة.</p></div></div>';
  wrap.appendChild(section);
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const date = value => value ? new Date(value).toLocaleDateString('ar-AE') : '—';
  async function loadAlertSettings() {
    try {
      const settings = await call('/admin/course-alerts/settings');
      section.querySelector('#alertsEnabled').checked = settings.enabled !== false;
      section.querySelector('#alertDelay').value = String(settings.delayMinutes || 60);
      section.querySelector('#alertDeliveryMode').value = settings.deliveryMode || 'auto';
      section.querySelector('#alertBatchSize').value = String(settings.batchSize || 100);
      section.querySelector('#alertSubject').value = settings.subject || '';
      section.querySelector('#alertMessage').value = settings.message || '';
    } catch (error) { section.querySelector('#alertSettingsResult').textContent = error.message; }
  }
  async function loadAlerts() {
    const host = document.getElementById('alertsTable');
    host.innerHTML = '<p class="note">جارٍ تحميل المشتركين…</p>';
    try {
      const rows = await call('/admin/course-alerts');
      document.getElementById('alertsCount').textContent = rows.length;
      host.innerHTML = rows.length ? '<table><thead><tr><th>البريد الإلكتروني</th><th>الحالة</th><th>تاريخ الاشتراك</th><th>تم الإرسال</th><th>بانتظار الإرسال</th><th>فشل</th><th>إجراء</th></tr></thead><tbody>' + rows.map(row => '<tr><td dir="ltr">' + escape(row.email) + '</td><td><span class="alert-state ' + (row.active ? 'active' : 'off') + '">' + (row.active ? 'مفعّل' : (row.suppressed ? 'إلغاء نهائي' : 'موقوف')) + '</span></td><td>' + date(row.createdAt) + '</td><td>' + Number(row.sent || 0) + '</td><td>' + Number(row.queued || 0) + '</td><td>' + Number(row.failed || 0) + '</td><td><button class="danger" type="button" data-delete-alert="' + row.id + '">إيقاف نهائي</button></td></tr>').join('') + '</tbody></table>' : '<p class="note">لا يوجد مشتركون حتى الآن.</p>';
    } catch (error) { host.innerHTML = '<p class="message">' + escape(error.message) + '</p>'; }
  }
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs button,.view').forEach(element => element.classList.remove('active'));
    tab.classList.add('active'); section.classList.add('active'); loadAlerts(); loadAlertSettings();
  });
  section.querySelector('#alertSettingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const output = section.querySelector('#alertSettingsResult');
    button.disabled = true; button.textContent = 'جارٍ الحفظ…'; output.textContent = '';
    try {
      const saved = await call('/admin/course-alerts/settings', { method:'POST', body:JSON.stringify({ enabled:section.querySelector('#alertsEnabled').checked, delayMinutes:Number(section.querySelector('#alertDelay').value), deliveryMode:section.querySelector('#alertDeliveryMode').value, batchSize:Number(section.querySelector('#alertBatchSize').value), subject:section.querySelector('#alertSubject').value.trim(), message:section.querySelector('#alertMessage').value.trim() }) });
      section.querySelector('#alertsEnabled').checked = saved.enabled !== false;
      section.querySelector('#alertDelay').value = String(saved.delayMinutes);
      output.style.color='#168865'; output.textContent = saved.enabled ? (saved.deliveryMode === 'manual' ? 'تم حفظ وضع الدفعات اليدوي والعدد المختار.' : 'تم حفظ الإرسال التلقائي والعدد المختار.') : 'تم تعطيل الإرسال التلقائي مؤقتًا.';
    } catch (error) { output.style.color='var(--bad)'; output.textContent=error.message; }
    finally { button.disabled=false; button.textContent='حفظ الإعداد'; }
  });
  section.querySelector('#alertReleaseForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const output = section.querySelector('#alertReleaseResult');
    button.disabled = true; button.textContent = 'جارٍ تجهيز الدفعة…'; output.textContent = '';
    try {
      const result = await call('/admin/course-alerts/release', { method:'POST', body:JSON.stringify({ count:Number(section.querySelector('#alertBatchSize').value) }) });
      output.style.color='#168865'; output.textContent = result.released ? 'تمت جدولة ' + result.released + ' رسالة للإرسال الآن.' : 'لا توجد رسائل جاهزة للإرسال حاليًا.';
      loadAlerts();
    } catch (error) { output.style.color='var(--bad)'; output.textContent=error.message; }
    finally { button.disabled=false; button.textContent='إرسال العدد المختار الآن'; }
  });
  section.querySelector('#alertTestForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const output = section.querySelector('#alertTestResult');
    button.disabled=true; button.textContent='جارٍ الإرسال…'; output.textContent='';
    try {
      const result = await call('/admin/course-alerts/test', { method:'POST', body:JSON.stringify({ email:section.querySelector('#alertTestEmail').value.trim() }) });
      output.style.color='#168865'; output.textContent='تم إرسال المعاينة التجريبية لدورة: '+result.courseName;
    } catch (error) { output.style.color='var(--bad)'; output.textContent=error.message; }
    finally { button.disabled=false; button.textContent='أرسل معاينة'; }
  });
  section.querySelector('#alertImportForm').addEventListener('submit', async event => {
    event.preventDefault();
    const file = section.querySelector('#alertImportFile').files[0];
    const output = section.querySelector('#alertImportResult');
    const button = section.querySelector('#alertImportForm button');
    if (!file) return;
    button.disabled = true; button.textContent = 'جارٍ الإضافة…'; output.textContent = '';
    try {
      const data = new FormData(); data.append('file', file);
      const result = await call('/admin/course-alerts/import', { method:'POST', body:data });
      output.style.color = '#168865';
      output.textContent = 'تمت إضافة ' + result.added + ' بريد جديد' + (result.existing ? '، و' + result.existing + ' موجود مسبقًا.' : '.');
      event.target.reset(); loadAlerts();
    } catch (error) { output.style.color = 'var(--bad)'; output.textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'رفع وإضافة'; }
  });
  section.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-alert]');
    if (!button) return;
    if (!confirm('سيتم إيقاف هذا البريد نهائيًا من تنبيهات الدورات، ولن يعاد تفعيله حتى لو ظهر في ملف استيراد لاحق. هل تريد المتابعة؟')) return;
    button.disabled = true;
    try { await call('/admin/course-alerts/' + button.dataset.deleteAlert, { method:'DELETE' }); loadAlerts(); }
    catch (error) { alert(error.message); button.disabled = false; }
  });
})();
