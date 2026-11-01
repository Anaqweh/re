import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import express from 'express';
const tick=()=>new Promise(r=>setImmediate(r));
test('delete is beside the registrant, confirms identity, uses the safe server and prevents repeated clicks',async t=>{
 const page=await fs.readFile(new URL('../../admin-portal.html',import.meta.url),'utf8');
 const dom=new JSDOM(page,{url:'https://local.invalid/admin-portal.html',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());await tick();
 const id='11111111-1111-4111-8111-111111111111',requests=[];let old=false,confirm=false,deleted=false,confirms=0;
 const row={id,course_id:id,name:'LOCAL <img src=x>',email:'local@example.invalid',phone:'0',course_name:'LOCAL COURSE',reference:'LOCAL-REF',created_at:'2026-10-18',certificate:'لا',total:0,payment_method:'membership',status:'مسجل بالبطاقة'};
 w.INEXC_REGISTRATION_ENDPOINT='https://local.invalid/api';w.sessionStorage.setItem('inexc_do_admin','LOCAL');w.INEXCAdminSession={valid:()=>true};w.INEXCAdminDrafts={restore(){}};
 w.confirm=message=>{assert.ok(message.includes(row.name)&&message.includes(row.course_name));confirms++;return confirm};
 w.fetch=async(url,opt={})=>{requests.push({url,opt});assert.equal(opt.headers.Authorization,'Bearer LOCAL');
  if(url.endsWith('/registration-capabilities'))return {ok:!old,json:async()=>old?{}:{safeDeletion:1}};
  if(opt.method==='DELETE'){deleted=true;await tick();return {ok:true,json:async()=>({ok:true,deleted:1,restoredUnits:2})};}
  return {ok:true,json:async()=>url.endsWith('/admin/registrations')&&!deleted?[row]:[]};
 };
 w.eval(await fs.readFile(new URL('../../admin-income.js',import.meta.url),'utf8'));
 w.eval([...w.document.querySelectorAll('script:not([src])')][0].textContent);await tick();await tick();
 const button=w.document.querySelector('.registration-person [data-delete-registration]');assert.ok(button);assert.equal(button.closest('td').querySelector('img'),null);
 await w.delReg(id);assert.equal(confirms,1);assert.equal(requests.some(r=>r.opt.method==='DELETE'),false);
 old=true;confirm=true;await w.delReg(id);assert.match(w.document.getElementById('registrationActionResult').textContent,/تحديث الخادم/);assert.equal(requests.some(r=>r.opt.method==='DELETE'),false);
 old=false;await Promise.all([w.delReg(id),w.delReg(id)]);assert.equal(requests.filter(r=>r.opt.method==='DELETE').length,1);
 assert.equal(w.document.querySelector('[data-delete-registration]'),null);assert.match(w.document.getElementById('registrationActionResult').textContent,/أُعيدت 2 وحدة/);
});
test('actual delete route and capability require administrator authorization',async t=>{
 const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8'),start=source.indexOf("app.get('/api/admin/registration-capabilities'");
 const snippet=source.slice(start,source.indexOf('\ninstallMessageSubscriptions',start));
 const app=express();let deleted=0;const auth=(req,res,next)=>req.headers.authorization==='Bearer LOCAL'?next():res.sendStatus(401);
 new Function('app','auth','pool','deleteRegistration',snippet)(app,auth,{},async()=>{deleted++;return {ok:true}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/admin/registration-capabilities')).status,401);
 assert.equal((await fetch(base+'/api/admin/registrations/local',{method:'DELETE'})).status,401);assert.equal(deleted,0);
 assert.equal((await fetch(base+'/api/admin/registrations/local',{method:'DELETE',headers:{Authorization:'Bearer LOCAL'}})).status,200);assert.equal(deleted,1);
});
