/* روابط INEXC العامة بدون امتداد HTML. */
function normalizeLinks(root = document) {
  root.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || /^(https?:|mailto:|tel:|#)/.test(href)) return;
    if (href.startsWith('register.html')) link.setAttribute('href', '/register/' + href.slice('register.html'.length));
    if (href.startsWith('course.html')) link.setAttribute('href', '/course/' + href.slice('course.html'.length));
    if (href === 'index.html') link.setAttribute('href', '/');
  });
}
window.addEventListener('DOMContentLoaded', () => {
  normalizeLinks();
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1) normalizeLinks(node);
  }))).observe(document.body, { childList: true, subtree: true });
});
