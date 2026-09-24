/* محرر مبسط وآمن: يحفظ العلامات كنص ويعرضها الموقع بتنسيق محدود فقط. */
(() => {
  const style = document.createElement('style');
  style.textContent = '.rich-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 3px;font-size:10px;color:#5d7690}.rich-tools button{padding:5px 8px;border:1px solid #cfe3f7;border-radius:7px;background:#f5faff;color:#0866c6;font-weight:700;cursor:pointer}.rich-tools small{width:100%;font-size:9px;color:#72879b}';
  document.head.appendChild(style);
  const mount = () => {
    const fields = [
      ['courseDescription', 'تنسيق الوصف'],
      ['courseAxes', 'تنسيق المحاور'],
      ['courseOutcomes', 'تنسيق المخرجات']
    ];
    let ready = true;
    fields.forEach(([id]) => { if (!document.getElementById(id)) ready = false; });
    if (!ready) return false;
    fields.forEach(([id, title]) => {
      const field = document.getElementById(id);
      if (document.querySelector(`[data-rich-for="${id}"]`)) return;
      const toolbar = document.createElement('div');
      toolbar.className = 'rich-tools'; toolbar.dataset.richFor = id;
      toolbar.innerHTML = `<span>${title}:</span><button type="button" data-action="bold">عريض B</button><button type="button" data-action="heading">عنوان بارز</button><small>حدد النص ثم اختر الأداة. يظهر العريض في صفحة الدورة فقط.</small>`;
      field.before(toolbar);
      toolbar.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        event.preventDefault(); const start = field.selectionStart, end = field.selectionEnd, selected = field.value.slice(start, end) || 'نص بارز';
        const insert = button.dataset.action === 'heading' ? `\n## ${selected}\n` : `**${selected}**`;
        field.value = field.value.slice(0, start) + insert + field.value.slice(end);
        field.focus(); field.setSelectionRange(start, start + insert.length); field.dispatchEvent(new Event('input', { bubbles:true }));
      });
    });
    return true;
  };
  const timer = setInterval(() => { if (mount()) clearInterval(timer); }, 250);
})();
