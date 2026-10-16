// Public discovery is derived from current published data on every request.
// This makes pages discoverable; Google's crawl/index timing remains external.
export const PUBLIC_ORIGIN = 'https://www.inexctraining.com';
export const PUBLIC_PATHS = ['/', '/register/', '/cards/', '/services.html', '/subscribe.html'];
const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function publicSitemap(courses) {
  const urls = PUBLIC_PATHS.map(path => `<url><loc>${PUBLIC_ORIGIN}${path}</loc></url>`);
  const seen = new Set();
  for (const course of courses) {
    if (course.active !== true || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(course.id)) || seen.has(course.id)) continue;
    seen.add(course.id);
    const date = course.updated_at ? new Date(course.updated_at) : null;
    const modified = date && Number.isFinite(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>` : '';
    urls.push(`<url><loc>${xml(PUBLIC_ORIGIN+'/course.html?id='+encodeURIComponent(course.id))}</loc>${modified}</url>`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.join('')+'</urlset>';
}
export function installSeoSitemap(app, {pool}) {
  app.get('/api/sitemap.xml', async (_req, res, next) => {
    try {
      const {rows} = await pool.query('SELECT id,updated_at,active FROM courses WHERE active = true ORDER BY updated_at DESC');
      res.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
      res.set('X-INEXC-Sitemap-Version', '2');
      res.type('application/xml').send(publicSitemap(rows));
    } catch (error) { next(error); }
  });
}
