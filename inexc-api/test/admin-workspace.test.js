import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=await fs.readFile(new URL('../../admin-workspace.js',import.meta.url),'utf8');
const HOUR=3600000;
const markup=`<section id="login"><form id="loginForm"><input id="password" type="password"><div id="loginError"></div></form></section><section id="app"><header class="bar"><button id="logout"></button></header><div class="tabs"><button data-view="courses"></button></div><section class="view" id="courses"><form id="courseForm"><h2 id="courseTitle">إضافة دورة</h2><input id="courseId" type="hidden"><input id="courseName"><textarea id="courseAxes"></textarea><input id="coursePrice" type="number"><input id="payBank" type="checkbox"><input id="courseImage" type="file"><input id="secretKey"><input id="confirmAction" type="checkbox"></form></section></section>`;
async function browser(storage={},start=1000000,hash=""){
 const dom=new JSDOM(markup,{url:'https://example.test/admin-portal.html?v=local'+hash,runScripts:'outside-only'}),w=dom.window;
 await new Promise(r=>setImmediate(r));
 let now=start;const requests=[],timers=new Map();let timerId=0;
 w.Date.now=()=>now;w.setTimeout=(fn,delay)=>{timers.set(++timerId,{fn,at:now+delay});return timerId};w.clearTimeout=id=>timers.delete(id);
 w.INEXC_REGISTRATION_ENDPOINT='https://api.example.test/api';w.Response=Response;
 w.fetch=async(url,opt={})=>{requests.push({url:String(url),method:opt.method||'GET'});return new Response('{}',{status:200})};
 for(const [key,value]of Object.entries(storage))w.sessionStorage.setItem(key,value);
 w.eval(source);
 const $=id=>w.document.getElementById(id),input=(id,value)=>{const field=$(id);if(field.type==='checkbox')field.checked=value;else field.value=value;field.dispatchEvent(new w.Event('input',{bubbles:true}));};
 return{w,$,input,requests,advance:ms=>{now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn()}},storage:()=>Object.fromEntries(Object.entries(w.sessionStorage))};
}
test('60-minute absolute session survives refresh, expires on time, revokes only login and preserves edits',async()=>{
 const a=await browser();a.w.INEXCAdminSession.start('LOCAL-TOKEN-ONLY',28800);const deadline=a.w.INEXCAdminSession.expiresAt;
 a.input('courseId','course-a');a.input('courseName','دورة لم تكتمل');a.input('courseAxes','محور أول\nمحور ثان');a.input('coursePrice','0');a.input('payBank',true);
 a.input('password','never-store-me');a.input('secretKey','never-store-this-either');a.input('confirmAction',true);
 const saved=a.storage();assert.doesNotMatch(saved.inexc_admin_fields_v1,/never-store|confirmAction|courseImage/);
 a.advance(59*60000);assert.equal(a.w.INEXCAdminSession.valid(),true);
 const b=await browser(a.storage(),1000000+59*60000);a.w.close();
 assert.equal(b.w.INEXCAdminSession.expiresAt,deadline);assert.equal(b.$('courseName').value,'دورة لم تكتمل');assert.equal(b.$('courseAxes').value,'محور أول\nمحور ثان');assert.equal(b.$('coursePrice').value,'0');assert.equal(b.$('payBank').checked,true);assert.equal(b.$('password').value,'');assert.equal(b.$('confirmAction').checked,false);
 b.advance(60000);assert.equal(b.w.INEXCAdminSession.valid(),false);assert.equal(b.$('app').hidden,true);assert.equal(b.w.sessionStorage.getItem('inexc_do_admin'),null);assert.equal(b.$('courseName').value,'دورة لم تكتمل');
 assert.deepEqual(b.requests,[{url:'https://api.example.test/api/admin/logout',method:'POST'}]);
 const blocked=await b.w.fetch('https://api.example.test/api/admin/messages',{method:'POST'});assert.equal(blocked.status,401);assert.equal(b.requests.length,1);
 b.w.INEXCAdminSession.start('SECOND-LOCAL-TOKEN',28800);b.w.dispatchEvent(new b.w.CustomEvent('inexc:unlocked'));assert.equal(b.$('courseName').value,'دورة لم تكتمل');assert.equal(b.w.INEXCAdminSession.expiresAt,deadline+HOUR);
 b.w.close();
});
test('opening an already-expired page does not overwrite stored forms with blank defaults',async()=>{
 const a=await browser();a.w.INEXCAdminSession.start('LOCAL-TOKEN');a.input('courseName','آخر حرف محفوظ');const saved=a.storage();a.w.close();
 const b=await browser(saved,1000000+HOUR+1);assert.equal(b.$('app').hidden,true);assert.match(b.storage().inexc_admin_fields_v1,/آخر حرف محفوظ/);
 b.w.INEXCAdminSession.start('NEW-LOCAL-TOKEN');b.w.dispatchEvent(new b.w.CustomEvent('inexc:unlocked'));assert.equal(b.$('courseName').value,'آخر حرف محفوظ');b.w.close();
});
test('form reset and dynamic record scopes restore independently without submitting anything',async()=>{
 const a=await browser();a.w.INEXCAdminSession.start('LOCAL-TOKEN');let submitted=0;a.$('courseForm').onsubmit=()=>submitted++;
 a.input('courseName','مسودة قديمة');a.$('courseForm').reset();a.w.dispatchEvent(new a.w.Event('beforeunload'));
 assert.equal(JSON.parse(a.storage().inexc_admin_fields_v1)['id:courseForm'],undefined);
 a.$('app').insertAdjacentHTML('beforeend','<section class="view" id="memberships"><details data-membership-plan="one"><input data-k="name"></details><details data-membership-plan="two"><input data-k="name"></details></section>');
 for(const [id,value]of [['one','البطاقة الأولى'],['two','البطاقة الثانية']]){const field=a.w.document.querySelector(`[data-membership-plan="${id}"] input`);field.value=value;field.dispatchEvent(new a.w.Event('input',{bubbles:true}));}
 a.w.document.querySelector('#memberships').innerHTML='<details data-membership-plan="two"><input data-k="name"></details><details data-membership-plan="one"><input data-k="name"></details>';
 a.w.INEXCAdminDrafts.restore();assert.equal(a.w.document.querySelector('[data-membership-plan="one"] input').value,'البطاقة الأولى');assert.equal(a.w.document.querySelector('[data-membership-plan="two"] input').value,'البطاقة الثانية');assert.equal(submitted,0);assert.equal(a.requests.length,0);a.w.close();
});

const tick=()=>new Promise(r=>setImmediate(r));
function section(h,view,{delayed=false}={}){
 const w=h.w,tab=w.document.createElement('button');tab.dataset.view=view;tab.type='button';tab.textContent=view;
 const panel=w.document.createElement('section');panel.id=view;panel.className='view';h.$('app').append(panel);
 const activate=()=>{w.document.querySelectorAll('.tabs button,.view').forEach(n=>n.classList.remove('active'));tab.classList.add('active');panel.classList.add('active')};
 tab.onclick=delayed?()=>{}:activate;w.document.querySelector('.tabs').append(tab);return {tab,activate};
}
test('refresh restores the current section, replaces stale hashes and retains query, login deadline and drafts',async()=>{
 const a=await browser();a.w.INEXCAdminSession.start('LOCAL-TOKEN');a.input('courseName','مسودة محفوظة');
 const project=section(a,'course-projects'),certificate=section(a,'certificate-requests');project.tab.click();certificate.tab.click();await tick();
 assert.equal(a.w.location.hash,'#certificate-requests');assert.equal(a.w.location.search,'?v=local');
 a.w.dispatchEvent(new a.w.Event('beforeunload'));const saved=a.storage(),hash=a.w.location.hash;a.w.close();
 const b=await browser(saved,1000001,hash);const wrong=section(b,'course-projects'),right=section(b,'certificate-requests');await tick();
 assert.equal(right.tab.classList.contains('active'),true);assert.equal(wrong.tab.classList.contains('active'),false);
 assert.equal(b.$('courseName').value,'مسودة محفوظة');assert.equal(b.w.INEXCAdminSession.expiresAt,Number(saved.inexc_admin_deadline_v1));assert.equal(b.requests.length,0);b.w.close();
});
test('explicit section link takes priority over saved view, waits for late mount and supports hash navigation',async()=>{
 const h=await browser({inexc_do_admin:'LOCAL',inexc_admin_deadline_v1:'4600000',inexc_admin_view_v1:'courses'},1000000,'#course-projects');
 await tick();assert.equal(h.w.location.hash,'#course-projects');const project=section(h,'course-projects');await tick();assert.equal(project.tab.classList.contains('active'),true);
 const other=section(h,'certificate-requests');h.w.history.replaceState(null,'','#certificate-requests');h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));await tick();assert.equal(other.tab.classList.contains('active'),true);assert.equal(h.storage().inexc_admin_view_v1,'certificate-requests');h.w.close();
});
test('loading an asynchronous section cannot be overwritten by the previously active tab',async()=>{
 const h=await browser();h.w.INEXCAdminSession.start('LOCAL');const first=section(h,'registrations'),late=section(h,'message-center',{delayed:true});first.tab.click();await tick();late.tab.click();
 // Sidebar decoration happens before the message module finishes loading.
 first.tab.classList.add('decorated');await tick();h.w.dispatchEvent(new h.w.Event('beforeunload'));
 assert.equal(h.w.location.hash,'#message-center');assert.equal(h.storage().inexc_admin_view_v1,'message-center');
 late.activate();await tick();assert.equal(late.tab.classList.contains('active'),true);assert.equal(h.w.location.hash,'#message-center');
 // Programmatic navigation (e.g. show a course's registrations) is also saved.
 first.activate();await tick();assert.equal(h.w.location.hash,'#registrations');h.w.close();
});
