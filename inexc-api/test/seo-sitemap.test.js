import test from 'node:test';
import assert from 'node:assert/strict';
import {installSeoSitemap, publicSitemap, PUBLIC_ORIGIN} from '../seo-sitemap.js';
const id='11111111-1111-4111-8111-111111111111';
test('publishing, updating, unpublishing and deleting change discovery on the next request',async()=>{
  let rows=[], handler;
  installSeoSitemap({get(path,fn){assert.equal(path,'/api/sitemap.xml');handler=fn;}},{pool:{async query(sql){assert.match(sql,/WHERE active = true/);return {rows:rows.filter(r=>r.active)};}}});
  const get=async()=>{const out={headers:{}};const res={set(k,v){out.headers[k]=v;return this},type(v){out.type=v;return this},send(body){out.body=body;return this}};await handler({},res,e=>{throw e});return out};
  const empty=await get();assert(!empty.body.includes(id));
  rows=[{id,active:true,updated_at:'2026-10-17T00:00:01Z'}];
  const published=await get();assert(published.body.includes(PUBLIC_ORIGIN+'/course/?id='+id));assert(published.body.includes('2026-10-17T00:00:01.000Z'));
  assert.equal(published.headers['Cache-Control'],'no-cache, max-age=0, must-revalidate');
  rows[0].updated_at='2026-10-17T00:00:02Z';assert((await get()).body.includes('2026-10-17T00:00:02.000Z'));
  rows[0].active=false;assert(!(await get()).body.includes(id));
  rows[0].active=true;assert((await get()).body.includes(id));
  rows=[];assert(!(await get()).body.includes(id));
});
test('only canonical public URLs and valid published IDs are advertised',()=>{
 const body=publicSitemap([{id,active:true,updated_at:'invalid'},{id,active:true},{id:'private',active:false},{id:'<script>',active:true}]);
 assert.equal((body.match(/<url>/g)||[]).length,1);assert(!body.includes('/register/</loc>'));assert(!body.includes('register.html'));assert(!body.includes('Invalid Date'));assert(!body.includes('/admin'));assert(!body.includes('service-request'));assert(!body.includes('<script>'));
});
test('database failures propagate instead of claiming an empty sitemap',async()=>{
 let handler;const error=new Error('DB unavailable');installSeoSitemap({get(_,fn){handler=fn}},{pool:{async query(){throw error}}});let received;await handler({}, {},e=>received=e);assert.equal(received,error);
});
