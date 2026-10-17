/* Formatting stays in featureLines so existing plan storage remains compatible. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(value) {
    return escape(value).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  }
  function list(lines) {
    return lines.map(line => '<li>' + inline(line) + '</li>').join('');
  }
  function preview(area) {
    const output = area.closest('.feature-editor')?.querySelector('.feature-preview');
    if (!output) return;
    const lines = area.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    output.innerHTML = lines.length ? '<ul class="features">' + list(lines) + '</ul>' : '<span>ستظهر معاينة المزايا هنا.</span>';
  }
  function mount() {
    if (!document?.documentElement) return;
    document.querySelectorAll('textarea[data-k="featureLines"]').forEach(area => {
      if (area.closest('.feature-editor')) return;
      const label = area.closest('label');
      const wrapper = document.createElement('div'); wrapper.className = 'feature-editor';
      label.before(wrapper); wrapper.append(label);
      const toolbar = document.createElement('div'); toolbar.className = 'feature-toolbar';
      toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','تنسيق المزايا');
      toolbar.innerHTML = '<button type="button" data-feature-format="bold">نص عريض</button><button type="button" data-feature-format="highlight">إبراز بلون</button><button type="button" data-feature-format="clear">إزالة التنسيق</button>';
      area.before(toolbar);
      const help = label.querySelector('small');
      help.textContent = 'حدّد النص ثم اختر التنسيق، أو ضع المؤشر لتنسيق السطر كاملًا. ميزة واحدة في كل سطر. ترك الحقل فارغًا يعرض المزايا الافتراضية.';
      const output = document.createElement('div'); output.className = 'feature-preview';
      output.setAttribute('aria-label','معاينة المزايا'); wrapper.append(output);
      area.addEventListener('input', () => preview(area));
      toolbar.addEventListener('mousedown', event => event.preventDefault());
      toolbar.addEventListener('click', event => {
        const button = event.target.closest('[data-feature-format]'); if (!button) return;
        let start = area.selectionStart, end = area.selectionEnd;
        if (start === end) { start = area.value.lastIndexOf('\n', start - 1) + 1; end = area.value.indexOf('\n', end); if (end < 0) end = area.value.length; }
        const selected = area.value.slice(start,end); if (!selected.trim()) { area.focus(); return; }
        const mode = button.dataset.featureFormat, marker = mode === 'bold' ? '**' : '==';
        const value = selected.split('\n').map(line => mode === 'clear' ? line.replace(/\*\*|==/g,'') : line.trim() ? marker + line + marker : line).join('\n');
        area.setRangeText(value,start,end,'select'); area.focus(); area.dispatchEvent(new Event('input',{bubbles:true}));
      });
      preview(area);
    });
  }
  window.INEXCMembershipFeatures = { inline, list, mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount); else mount();
  new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
})();
