import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';

const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
const catalogue = JSON.parse(await fs.readFile(new URL('../course-catalog-20261016.json', import.meta.url), 'utf8')).courses;
const routes = source.match(/app\.get\('\/:shareSlug', async \(req, res, next\) => \{[\s\S]*?\n\}\);/g);
const helpers = source.slice(source.indexOf('function publicRichText(value)'), source.indexOf("app.get('/:shareSlug'"));

test('public share routes serve imported catalogue slugs and exclude deleted, inactive and invalid slugs', async () => {
  assert.equal(routes.length, 2);
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE courses(id text, share_slug text, active boolean);');
    for (const course of catalogue) await db.query('INSERT INTO courses VALUES ($1,$2,true)', [course.id, 'catalog-' + course.slug]);
    await db.query("INSERT INTO courses VALUES ('legacy','course-abc123',true),('hidden','catalog-hidden',false)");
    const courseFor = row => ({...row, name:'Example course', description:'Public content', axes:[], outcomes:[], certificate:{mode:'none'}, price:249, hours:6});
    for (const route of routes) {
      let handler;
      vm.runInNewContext(helpers + '\n' + route, {
        app:{get:(_,fn) => {handler=fn;}}, pool:db, publicCourse:courseFor,
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
        publicUrl:(_req,path) => new URL(path, 'https://courses.inexctraining.com').href
      });
      for (const [slug, expectedId] of [...catalogue.map(c => ['catalog-' + c.slug, c.id]), ['course-abc123','legacy']]) {
        const result = {code:200, body:'', status(n){this.code=n;return this;}, type(){return this;}, send(body){this.body=body;return this;}};
        await handler({params:{shareSlug:slug}, originalUrl:'/' + slug}, result, err => {throw err;});
        assert.equal(result.code, 200, slug);
        const dom = new JSDOM(result.body);
        assert.equal(dom.window.document.querySelector('link[rel="canonical"]').href, `https://www.inexctraining.com/course/?id=${expectedId}`);
        assert.equal(dom.window.document.querySelector('h1').textContent, 'Example course');
        dom.window.close();
      }
      for (const slug of ['catalog-hidden', 'catalog-deleted', 'course-missing', 'admin', 'catalog-../private', 'catalog--broken']) {
        const result = {code:200, status(n){this.code=n;return this;}, send(){return this;}};
        await handler({params:{shareSlug:slug}, originalUrl:'/' + slug}, result, err => {throw err;});
        assert.equal(result.code, 404, slug);
      }
    }
  } finally { await db.close(); }
});
