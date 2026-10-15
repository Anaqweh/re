/* Browser session and local form recovery. No email or campaign operations. */
(() => {
  'use strict';
  const TOKEN = 'inexc_do_admin', DEADLINE = 'inexc_admin_deadline_v1';
  const DRAFTS = 'inexc_admin_fields_v1', VIEW = 'inexc_admin_view_v1';
  const HOUR = 60 * 60 * 1000, MAX_AGE = 7 * 24 * HOUR;
  const api = new URL(window.INEXC_REGISTRATION_ENDPOINT, location.href);
  const nativeFetch = window.fetch.bind(window);
  const read = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { sessionStorage.setItem(key, value); return true; } catch { return false; } };
  const remove = key => { try { sessionStorage.removeItem(key); } catch {} };
  const q = id => document.getElementById(id);
  let expiry = Number(read(DEADLINE)) || 0, timer, locked = false;
  let snapshots = {}, navigationRestored = false;
  try { snapshots = JSON.parse(read(DRAFTS) || '{}'); } catch {}
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) snapshots = {};
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!snapshot || !Number.isFinite(snapshot.at) || Date.now() - snapshot.at > MAX_AGE) delete snapshots[key];
  }

  function eligible(field) {
    return field.matches('input,textarea,select') && field.id !== 'allPick' && !field.closest('dialog,#login,#resetLogin') &&
      (!field.closest('#message-center') || !!field.closest('form[id]')) &&
      !['password','file','submit','button'].includes(field.type) &&
      !/password|token|secret|consent|confirm/i.test([field.id, field.name, field.autocomplete].join(' '));
  }
  function scopeOf(field) {
    return field.closest('[data-membership-plan],#membershipCourses tr[data-course],form[id],.view[id]');
  }
  function scopeKey(scope) {
    if (!scope) return '';
    if (scope.hasAttribute('data-membership-plan')) return 'plan:' + scope.dataset.membershipPlan;
    if (scope.matches('#membershipCourses tr[data-course]')) return 'member-course:' + scope.dataset.course;
    return scope.id ? 'id:' + scope.id : '';
  }
  function fieldKey(field) {
    if (field.id) return 'id:' + field.id;
    if (field.dataset.k) return 'field:' + field.dataset.k;
    if (field.dataset.payment) return 'payment:' + field.dataset.payment;
    if (field.name) return 'name:' + field.name + (field.type === 'radio' ? ':' + field.value : '');
    return '';
  }
  function persist() {
    if (!write(DRAFTS, JSON.stringify(snapshots))) {
      const note = q('admin-draft-status');
      if (note) note.textContent = 'تعذر الحفظ في هذا المتصفح؛ احفظ بياناتك قبل تحديث الصفحة.';
    }
  }
  function captureScope(scope) {
    const key = scopeKey(scope); if (!key) return;
    activeScopes.add(scope);
    const fields = {};
    scope.querySelectorAll('input,textarea,select').forEach(field => {
      const name = fieldKey(field);
      if (!name || !eligible(field) || scopeOf(field) !== scope) return;
      fields[name] = field.type === 'checkbox' || field.type === 'radio' ? {checked:field.checked} :
        field.multiple ? {values:[...field.selectedOptions].map(option => option.value)} : {value:field.value};
    });
    snapshots[key] = {at:Date.now(), fields}; persist();
  }
  const restored = new WeakMap(), activeScopes = new WeakSet();
  function restoreScope(scope, force = false) {
    const snapshot = snapshots[scopeKey(scope)]; if (!snapshot?.fields) return;
    activeScopes.add(scope);
    scope.querySelectorAll('input,textarea,select').forEach(field => {
      if (!eligible(field) || scopeOf(field) !== scope) return;
      const data = snapshot.fields[fieldKey(field)]; if (!data) return;
      if (!force && restored.get(field) === snapshot.at) return;
      if ('checked' in data) field.checked = data.checked === true;
      else if (data.values && field.multiple) [...field.options].forEach(option => { option.selected = data.values.includes(option.value); });
      else if ('value' in data) {
        if (field.tagName === 'SELECT' && ![...field.options].some(option => option.value === data.value)) return;
        field.value = data.value;
      }
      restored.set(field, snapshot.at);
    });
    if (scope.id === 'courseForm' && q('courseId')?.value) { if (q('courseTitle').textContent !== 'تعديل الدورة') q('courseTitle').textContent = 'تعديل الدورة'; }
    if (scope.id === 'registrations' && q('courseWrap')) q('courseWrap').hidden = q('audience').value !== 'course';
  }
  function clear(scope) { activeScopes.delete(scope); delete snapshots[scopeKey(scope)]; persist(); }
  function restore() {
    if (!read(TOKEN) || locked) return;
    document.querySelectorAll('#app form[id],#app .view[id],#app [data-membership-plan],#membershipCourses tr[data-course]').forEach(scope => restoreScope(scope));
  }
  function capture() {
    // Capture only scopes the administrator has actually edited or restored.
    document.querySelectorAll('#app form[id],#app .view[id],#app [data-membership-plan],#membershipCourses tr[data-course]').forEach(scope => {
      if (activeScopes.has(scope)) captureScope(scope);
    });
  }
  function restoreNavigation() {
    if (navigationRestored || !read(TOKEN) || locked) return;
    const view = read(VIEW); if (!view) { navigationRestored = true; return; }
    const tab = [...document.querySelectorAll('.tabs button[data-view]')].find(button => button.dataset.view === view);
    if (tab) { navigationRestored = true; tab.click(); }
  }
  window.INEXCAdminDrafts = {capture, captureScope, restore, restoreScope, clear, restoreNavigation,
    get lastView() { return read(VIEW) || ''; }};

  function displayLock(reason) {
    const app = q('app'), login = q('login');
    if (app) { app.hidden = true; app.style.display = 'none'; app.setAttribute('inert',''); }
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if (login && !new URLSearchParams(location.hash.replace(/^#/, '')).has('reset')) { login.hidden = false; login.style.display = ''; }
    if (q('password')) q('password').value = '';
    if (q('loginError')) q('loginError').textContent = reason === 'expired' ?
      'انتهت مدة الدخول (60 دقيقة). سجّل الدخول للمتابعة؛ كتابتك محفوظة في هذا المتصفح.' :
      reason === 'unauthorized' ? 'انتهت الجلسة. سجّل الدخول للمتابعة؛ كتابتك محفوظة.' : 'تم تسجيل الخروج. كتابتك محفوظة للمتابعة بعد الدخول.';
  }
  function lock(reason = 'expired') {
    if (locked) return;
    capture(); window.dispatchEvent(new CustomEvent('inexc:before-lock'));
    const token = read(TOKEN);
    locked = true; expiry = 0; clearTimeout(timer); remove(TOKEN); remove(DEADLINE);
    displayLock(reason); window.dispatchEvent(new CustomEvent('inexc:locked'));
    // Revoke this login only. This endpoint does not touch the email worker or schedules.
    if (token && reason !== 'unauthorized') nativeFetch(api.href + '/admin/logout', {
      method:'POST', headers:{Authorization:'Bearer ' + token}, keepalive:true
    }).catch(() => {});
  }
  function valid() {
    if (!read(TOKEN)) return false;
    if (!expiry || Date.now() >= expiry) { lock('expired'); return false; }
    return !locked;
  }
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!valid()) return; arm(); }, Math.max(1, expiry - Date.now()));
  }
  function start(token, expiresIn = 3600) {
    // Reloading never calls start, so it cannot extend the absolute deadline.
    expiry = Date.now() + Math.min(HOUR, Math.max(1, Number(expiresIn) || 3600) * 1000);
    if (!write(TOKEN, token) || !write(DEADLINE, String(expiry))) throw Error('تعذر حفظ جلسة الدخول في المتصفح.');
    locked = false; arm();
  }
  window.INEXCAdminSession = {start, lock, valid, get expiresAt() { return expiry; }};
  if (read(TOKEN)) {
    // An already-open login gets one deadline on its first visit after this update.
    if (!expiry) { expiry = Date.now() + HOUR; write(DEADLINE, String(expiry)); }
    if (Date.now() >= expiry) lock('expired'); else arm();
  }
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    const protectedRequest = url.origin === api.origin && url.pathname.startsWith(api.pathname.replace(/\/$/,'') + '/admin/') &&
      !/\/admin\/(login|password-recovery|password-reset)$/.test(url.pathname);
    if (protectedRequest && !valid()) return new Response(JSON.stringify({error:'انتهت جلسة الإدارة. سجّل الدخول مجددًا.'}), {status:401,headers:{'Content-Type':'application/json'}});
    const requestToken = protectedRequest ? read(TOKEN) : null;
    const response = await nativeFetch(input, options);
    // A late response from an old login must not lock a newly signed-in session.
    if (protectedRequest && response.status === 401 && requestToken === read(TOKEN)) lock('unauthorized');
    return response;
  };
  document.addEventListener('input', event => {
    if (event.target.closest?.('#app') && eligible(event.target)) captureScope(scopeOf(event.target));
  });
  document.addEventListener('change', event => {
    if (event.target.closest?.('#app') && eligible(event.target)) captureScope(scopeOf(event.target));
  });
  document.addEventListener('reset', event => { if (event.target.closest?.('#app')) clear(event.target); });
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('.tabs button[data-view]');
    if (tab && read(TOKEN)) { write(VIEW, tab.dataset.view); navigationRestored = true; }
  }, true);
  window.addEventListener('pagehide', capture);
  window.addEventListener('beforeunload', capture);
  window.addEventListener('focus', () => { if (read(TOKEN)) valid(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && read(TOKEN)) valid(); });
  window.addEventListener('inexc:unlocked', () => { restore(); restoreNavigation(); });
  function mount() {
    if (locked) displayLock('expired');
    const bar = document.querySelector('#app .bar');
    if (bar && !q('admin-draft-status')) {
      const note = document.createElement('small'); note.id = 'admin-draft-status';
      note.style.cssText = 'font-size:11px;color:#64778c;line-height:1.8';
      note.textContent = 'قفل تلقائي بعد 60 دقيقة من الدخول · تُستعاد الكتابة بعد تحديث الصفحة';
      bar.insertBefore(note, q('logout'));
    }
    restore(); restoreNavigation();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return; queued = true;
      queueMicrotask(() => { queued = false; restore(); restoreNavigation(); });
    }).observe(q('app') || document.body, {childList:true,subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
