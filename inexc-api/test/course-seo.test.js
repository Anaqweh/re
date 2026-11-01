import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source = await fs.readFile(new URL('../../inexc-course-page.js', import.meta.url), 'utf8');
const id = '072fd801-6c22-5b40-8963-c1e7022cc833';
const canonical = `https://www.inexctraining.com/course/?id=${id}`;

async function open(page, course, endpoint = 'https://api.inexctraining.com/api') {
  const html = await fs.readFile(new URL('../../' + page, import.meta.url), 'utf8');
  const dom = new JSDOM(html, {
    url: `https://www.inexctraining.com/${page}?id=${id}&utm_source=check`,
    runScripts: 'outside-only'
  });
  const w = dom.window;
  if (w.document.readyState !== 'complete') await new Promise(resolve => w.addEventListener('load', resolve, {once:true}));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.INEXC_REGISTRATION_ENDPOINT = endpoint;
  w.fetch = async (url, options = {}) => {
    assert.equal(options.method || 'GET', 'GET');
    if (url.endsWith('/testimonials')) throw new Error('Review service unavailable');
    assert.equal(url, endpoint + '/courses');
    return {ok:true, json:async () => [{id, name:'A course <with> & details', description:'Useful content </script>', axes:[], outcomes:[], ...course}]};
  };
  w.eval(source);
  w.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve => setImmediate(resolve));
  return dom;
}

for (const page of ['course/index.html', 'course.html']) {
  for (const price of [0, 249]) {
    test(`${page}: one course entity matches canonical, price and booking despite a review outage (${price})`, async () => {
      const dom = await open(page, {price, imageUrl:'/uploads/course.webp'});
      try {
        const d = dom.window.document;
        assert.equal(d.querySelectorAll('link[rel="canonical"]').length, 1);
        assert.equal(d.querySelector('link[rel="canonical"]').href, canonical);
        const schemas = [...d.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent));
        assert.equal(schemas.length, 1, 'Do not publish competing Course entities');
        const schema = schemas[0];
        assert.equal(schema['@id'], canonical + '#course');
        assert.equal(schema.url, canonical);
        assert.equal(schema.name, d.querySelector('h1').textContent);
        assert.equal(schema.offers.price, price);
        assert.equal(schema.offers.priceCurrency, 'AED');
        assert.equal(schema.image, 'https://api.inexctraining.com/uploads/course.webp');
        assert.equal(d.title, schema.name + ' | INEXC Training');
        assert.equal(d.querySelector('meta[name="robots"]'), null);
        for (const link of d.querySelectorAll('a[href^="/register/"]')) {
          assert.equal(new URL(link.href).searchParams.get('course_id'), id);
        }
        assert.equal(d.querySelectorAll('a[href^="/register/"]').length, 3);
        assert.ok(!d.getElementById('course').textContent.includes('تعذر تحميل'));
      } finally { dom.window.close(); }
    });
  }
}

test('unknown prices do not become free offers and a relative API endpoint still renders the course', async () => {
  for (const price of [undefined, null, '', 'unknown', -1]) {
    const dom = await open('course/index.html', {price, imageUrl:'/uploads/course.webp'}, '/api');
    try {
      const d = dom.window.document;
      const schema = JSON.parse(d.querySelector('#courseStructuredData').textContent);
      assert.equal(schema.offers, undefined);
      assert.equal(schema.image, 'https://www.inexctraining.com/uploads/course.webp');
      assert.ok(d.querySelector('h1'));
    } finally { dom.window.close(); }
  }
});
